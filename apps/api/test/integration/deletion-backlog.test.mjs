import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { DatabaseModule } from '../../dist/infrastructure/database/database.module.js';
import { LifecycleState } from '../../dist/common/lifecycle/lifecycle-state.js';
import { DeletionBacklogModule } from '../../dist/modules/deletion/deletion-backlog.module.js';
import { DeletionBacklogService } from '../../dist/modules/deletion/deletion-backlog.service.js';

test('read-only backlog reports real stored original deadlines and unresolved errors without mutation', async t => {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const database = new MysqlDatabase(readConfig('worker'));
  const app = await NestFactory.createApplicationContext(DeletionBacklogModule.register(DatabaseModule.register({
    database, lifecycle: new LifecycleState(), externallyOwned: true,
  })), { logger: false, abortOnError: false });
  const userId = randomUUID(), requestId = randomUUID(), jobId = randomUUID();
  const sourceId = createHash('sha256').update(randomUUID()).digest('hex');
  const keySha = createHash('sha256').update(randomUUID()).digest('hex');
  t.after(async () => {
    await app.close();
    try {
      await database.transactions.write(async tx => {
        await tx.prisma.jobs.deleteMany({ where: { id: jobId } });
        await tx.prisma.deletion_intents.deleteMany({ where: { request_id: requestId } });
        await tx.prisma.account_deletion_obligations.deleteMany({ where: { user_id: userId } });
        await tx.prisma.deletion_replay_entries.deleteMany({ where: { source_id: sourceId } });
        await tx.prisma.deletion_replay_sources.deleteMany({ where: { source_id: sourceId } });
      });
    } finally { await database.close(); }
  });
  const service = app.get(DeletionBacklogService);
  const baseline = await service.inspect();
  const requested = await database.transactions.write(async tx => {
    const now = await tx.now(), requestedAt = new Date(now.getTime() - 25 * 3600000);
    await tx.prisma.account_deletion_obligations.create({ data: { user_id: userId, request_id: requestId,
      requested_at: requestedAt, auth_not_before: requestedAt, guard_coverage: false } });
    await tx.prisma.deletion_intents.create({ data: { request_id: requestId, actor_user_id: userId,
      target_id: userId, scope: 'ACCOUNT', environment: 'qa', requested_at: requestedAt, ledger_sha256: new Uint8Array(32) } });
    await tx.prisma.jobs.create({ data: { id: jobId, purpose: 'PURGE', resource_id: requestId, state: 'FAILED',
      attempts: 5, max_attempts: 5, last_error_code: 'ATTEMPTS_EXHAUSTED', available_at: now } });
    return requestedAt;
  });
  const before = await database.transactions.read(tx => tx.prisma.jobs.findUnique({ where: { id: jobId } }));
  const report = await service.inspect();
  assert.equal(report.accounts.count, baseline.accounts.count + 1);
  assert.equal(report.unapplied.count, baseline.unapplied.count + 1);
  assert.equal(report.errors.failedPurgeJobs, baseline.errors.failedPurgeJobs + 1);
  assert.equal(report.errors.uncoveredAccounts, baseline.errors.uncoveredAccounts + 1);
  assert.ok(report.accounts.oldestAgeSeconds >= 25 * 3600);
  assert.equal(report.level, 'breach');
  assert.equal(report.requiresAttention, true);
  assert.equal(report.completionVerified, false);
  for (const id of [userId, requestId, jobId]) assert.equal(JSON.stringify(report).includes(id), false);
  assert.deepEqual(await database.transactions.read(tx => tx.prisma.jobs.findUnique({ where: { id: jobId } })), before);
  assert.equal((await database.transactions.read(tx => tx.prisma.deletion_intents.findUnique({ where: { request_id: requestId } }))).requested_at.toISOString(), requested.toISOString());

  // A new retry's timestamp must not restart the original deletion clock.
  await database.transactions.write(tx => tx.prisma.jobs.update({ where: { id: jobId }, data: { available_at: new Date(), attempts: 0 } }));
  assert.equal((await service.inspect()).accounts.level, 'breach');
  // This probe observes states, and deliberately does not certify their truth.
  await database.transactions.write(tx => tx.prisma.account_deletion_obligations.update({ where: { user_id: userId }, data: { state: 'LIVE_PURGED' } }));
  const excluded = await service.inspect();
  assert.equal(excluded.accounts.count, baseline.accounts.count);
  assert.equal(excluded.unapplied.count, baseline.unapplied.count + 1);
  assert.equal(excluded.completionVerified, false);
  // Actual persisted failure -> recovery -> routine rediscovery. Retained
  // last_failure_code is not evidence that the new replay attempt has failed.
  await database.transactions.write(async tx => {
    await tx.prisma.deletion_replay_sources.create({ data: { source_id: sourceId, environment: 'qa' } });
    await tx.prisma.deletion_replay_entries.create({ data: { source_id: sourceId, key_sha256: keySha,
      object_key: `qa/${requestId}/intent.json`, classification: 'VALID', state: 'RETRY', discovered_generation: 1n,
      next_attempt_at: await tx.now(), last_failure_code: 'LEDGER_UNAVAILABLE', last_failure_at: await tx.now() } });
  });
  assert.equal((await service.inspect()).replayRetryWithFailureHistory, baseline.replayRetryWithFailureHistory + 1);
  await database.transactions.write(tx => tx.prisma.deletion_replay_entries.update({
    where: { source_id_key_sha256: { source_id: sourceId, key_sha256: keySha } }, data: { state: 'OBSERVED', processed_generation: 1n },
  }));
  assert.equal((await service.inspect()).replayRetryWithFailureHistory, baseline.replayRetryWithFailureHistory);
  await database.transactions.write(tx => tx.prisma.deletion_replay_entries.update({
    where: { source_id_key_sha256: { source_id: sourceId, key_sha256: keySha } }, data: { state: 'RETRY', discovered_generation: 2n },
  }));
  const rediscovered = await service.inspect();
  assert.equal(rediscovered.replayRetryWithFailureHistory, baseline.replayRetryWithFailureHistory + 1);
  assert.equal(rediscovered.errors.replayErrors, baseline.errors.replayErrors);
});
