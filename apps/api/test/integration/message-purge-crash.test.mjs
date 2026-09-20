import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaDatabase } from '../../dist/infrastructure/database/database.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MessagePurgeModule } from '../../dist/modules/deletion/message-purge.module.js';
import { MessagePurgeService } from '../../dist/modules/deletion/message-purge.service.js';
import { MessagesCoreModule } from '../../dist/modules/messages/messages-core.module.js';
import { MessagesCoreService } from '../../dist/modules/messages/messages-core.service.js';
import { DeletionApplyService } from '../../dist/modules/deletion/deletion-apply.service.js';
import { DeletionRepository } from '../../dist/modules/deletion/deletion.repository.js';
import { AccountDeletionRepository } from '../../dist/modules/deletion/account-deletion.repository.js';
import { IdentityGuardService } from '../../dist/modules/auth/identity-guard.service.js';
import { IdentityGuardRepository } from '../../dist/modules/auth/identity-guard.repository.js';
import { deletionFixture } from '../support/deletion-fixture.mjs';
import { createUser, createRoom, joinRoom, assignRoomOwner, sendMessage, sendInput } from '../support/domain-fixture.mjs';
import { requirePurgeCrashDatabase, purgeCrashChild } from '../support/message-purge-crash-process.mjs';

class FixtureModule {}
Module({ imports: [MessagePurgeModule, MessagesCoreModule] })(FixtureModule);

async function fixture(t) {
  requirePurgeCrashDatabase();
  const db = new PrismaDatabase(readConfig('api')), children = [];
  let context;
  t.after(async () => {
    try { await Promise.all(children.map(child => child.stop())); }
    finally { try { await context?.close(); } finally { await db.close(); } }
  });
  context = await NestFactory.createApplicationContext(FixtureModule, { logger: false, abortOnError: false });
  const key = randomBytes(32);
  const { user, room } = await db.transactions.write(async tx => {
    const user = await createUser(tx, '합성 충돌 테스트');
    await tx.prisma.platform_soop.create({ data: { id: randomUUID(), user_id: user, provider_subject: randomBytes(24), verified_at: await tx.now() }, select: { id: true } });
    const room = await createRoom(tx, '합성 삭제 복구', 'GROUP');
    await assignRoomOwner(tx, room, await joinRoom(tx, room, user));
    return { user, room };
  });
  const input = sendInput({ clientMessageId: randomUUID(), intent: 'SHARED', content: { type: 'TEXT', text: '합성 삭제 본문' } });
  const source = await db.transactions.write(tx => sendMessage(tx, room, user, input, key));
  const intent = await db.transactions.write(tx => context.get(MessagesCoreService).authorizeDeletion(tx, room, user, source.messageId, 'qa'));
  // Isolated external-ledger adapter, outside the database transaction. The
  // production admission writes the immutable checkpoint consumed by children.
  const { ledger } = deletionFixture();
  const receipt = await ledger.ensureIntent(intent);
  const apply = new DeletionApplyService(db.transactions, context.get(MessagesCoreService), new DeletionRepository(), new AccountDeletionRepository(), new IdentityGuardService(new IdentityGuardRepository()));
  assert.equal((await apply.apply(receipt)).status, 'blocked');
  const lease = await db.transactions.write(async tx => {
    const job = await tx.prisma.jobs.findFirstOrThrow({ where: { purpose: 'PURGE', resource_id: intent.requestId }, select: { id: true, generation: true, max_attempts: true } });
    const generation = job.generation + 1n, leaseOwner = randomUUID(), leaseToken = randomUUID();
    await tx.prisma.jobs.update({ where: { id: job.id }, data: { state: 'RUNNING', generation, lease_owner: leaseOwner, lease_token: leaseToken, lease_until: new Date((await tx.now()).getTime() + 300000) }, select: { id: true } });
    return { id: job.id, purpose: 'PURGE', roomId: room, resourceId: intent.requestId, generation, leaseOwner, leaseToken, attempts: 1, maxAttempts: job.max_attempts };
  });
  // This fixture has only the root, its receipt, events and notification jobs.
  // Drain dependency pages with the real service; leave final root TX to child.
  for (let n = 0; ; n++) {
    assert.ok(n < 20, 'fixture dependency pages must converge');
    const pending = await db.transactions.read(async tx =>
      await tx.prisma.room_events.count({ where: { message_id: source.messageId } }) +
      await tx.prisma.jobs.count({ where: { purpose: 'PUSH', resource_id: source.messageId } }) +
      await tx.prisma.command_receipts.count({ where: { message_id: source.messageId, OR: [{ deleted: false }, { payload_digest: { not: null } }] } }));
    if (!pending) break;
    assert.deepEqual(await context.get(MessagePurgeService).step(db.transactions, 'qa', lease, 1), { status: 'progress', changed: 1 });
  }
  const snapshot = () => db.transactions.write(async tx => {
    // Current lock waits for killed connection rollback before taking a view.
    await tx.rows('SELECT id FROM rooms WHERE id=? FOR UPDATE', [room]);
    return {
      root: await tx.prisma.messages.findUnique({ where: { id: source.messageId }, select: { id: true } }),
      proof: await tx.prisma.message_purge_checkpoints.findUnique({ where: { request_id: intent.requestId } }),
      proofCount: await tx.prisma.message_purge_checkpoints.count({ where: { request_id: intent.requestId } }),
      receipts: await tx.prisma.command_receipts.findMany({ where: { message_id: source.messageId }, select: { deleted: true, payload_digest: true, message_id: true } }),
      request: await tx.prisma.deletion_requests.findUniqueOrThrow({ where: { id: intent.requestId }, select: { state: true, message_id: true } }),
      checkpoint: await tx.prisma.deletion_intents.findUniqueOrThrow({ where: { request_id: intent.requestId } }),
      epoch: (await tx.prisma.rooms.findUniqueOrThrow({ where: { id: room }, select: { content_epoch: true } })).content_epoch,
    };
  });
  const child = () => { const value = purgeCrashChild(); children.push(value); return value; };
  const assertPurged = state => {
    assert.equal(state.root, null); assert.equal(state.proofCount, 1);
    assert.deepEqual(state.receipts, [{ deleted: true, payload_digest: null, message_id: source.messageId }]);
    assert.deepEqual(state.request, { state: 'BLOCKED', message_id: source.messageId });
    const { rows_purged_at, ...proof } = state.proof;
    assert.ok(rows_purged_at instanceof Date);
    assert.deepEqual(proof, { request_id: intent.requestId, environment: 'qa', actor_user_id: user, room_id: room, target_id: source.messageId,
      requested_at: state.checkpoint.requested_at, ledger_sha256: state.checkpoint.ledger_sha256 });
  };
  const recover = async changed => {
    const fresh = child(); await fresh.start('recover', lease);
    assert.deepEqual((await fresh.wait('result')).result, { status: 'rows_purged', changed });
    assert.deepEqual(await fresh.waitExit(), { code: 0, signal: null }); fresh.assertSilent();
    // Retrying the original command must observe its terminal receipt.
    assert.equal((await db.transactions.write(tx => sendMessage(tx, room, user, input, key))).status, 'deleted');
  };
  return { child, lease, snapshot, assertPurged, recover };
}

test('physical MESSAGE purge SIGKILL before final COMMIT rolls back root/proof and a fresh process recovers', { timeout: 30000 }, async t => {
  const f = await fixture(t), before = await f.snapshot();
  assert.ok(before.root); assert.equal(before.proof, null);
  const child = f.child(); await child.start('pre-commit', f.lease);
  const barrier = await child.wait('pre-commit');
  assert.ok(barrier.elapsedMs < 3000); assert.ok(Date.now() - barrier.at < 1000, 'kill must precede production transaction timeout');
  assert.equal(child.hasResult(), false); child.kill();
  assert.deepEqual(await child.waitExit(), { code: null, signal: 'SIGKILL' }); child.assertSilent();
  assert.deepEqual(await f.snapshot(), before);
  await f.recover(1);
  const after = await f.snapshot(); f.assertPurged(after);
  assert.equal(after.epoch, before.epoch + 1n); assert.deepEqual(after.checkpoint, before.checkpoint);
});

test('physical MESSAGE purge lost caller result after successful COMMIT and SIGKILL replays exact proof in a fresh process', { timeout: 30000 }, async t => {
  const f = await fixture(t), before = await f.snapshot();
  assert.ok(before.root); assert.equal(before.proof, null);
  const child = f.child(); await child.start('post-commit', f.lease); await child.wait('post-commit');
  assert.equal(child.hasResult(), false);
  const committed = await f.snapshot(); f.assertPurged(committed);
  assert.equal(committed.epoch, before.epoch + 1n); assert.deepEqual(committed.checkpoint, before.checkpoint);
  child.kill(); assert.deepEqual(await child.waitExit(), { code: null, signal: 'SIGKILL' }); child.assertSilent();
  assert.equal(child.hasResult(), false);
  await f.recover(0);
  assert.deepEqual(await f.snapshot(), committed);
});
