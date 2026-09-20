import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { DatabaseModule } from '../../dist/infrastructure/database/database.module.js';
import { LifecycleState } from '../../dist/common/lifecycle/lifecycle-state.js';
import { PurgeWorkerModule } from '../../dist/modules/deletion/purge-worker.module.js';
import { PurgeWorkerService } from '../../dist/modules/deletion/purge-worker.service.js';
import { PurgeWorkerRepository } from '../../dist/modules/deletion/purge-worker.repository.js';
import { DeletionModule } from '../../dist/modules/deletion/deletion.module.js';
import { DeletionApplyService } from '../../dist/modules/deletion/deletion-apply.service.js';
import { accountDeletionId } from '../../dist/modules/deletion/deletion-ledger.js';
import { MessagesCoreService } from '../../dist/modules/messages/messages-core.service.js';
import { Jobs } from '../../dist/modules/jobs/jobs.service.js';
import { JobsRepository } from '../../dist/modules/jobs/jobs.repository.js';
import { JobsCoreService } from '../../dist/modules/jobs/jobs-core.service.js';
import { purgeDedupe } from '../../dist/modules/jobs/jobs.policy.js';
import { WorkerLoop } from '../../dist/modules/jobs/worker-loop.js';
import { deletionFixture } from '../support/deletion-fixture.mjs';
import { createUser, createRoom, joinRoom, assignRoomOwner, sendMessage, sendInput } from '../support/domain-fixture.mjs';

async function fixture(t, sticker = false) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api')), { ledger, store } = deletionFixture();
  // Suite-owned disposable database only; previous tests have already settled.
  await db.transactions.write(tx => tx.prisma.jobs.deleteMany({ where: { purpose: 'PURGE' } }));
  const infrastructure = DatabaseModule.register({ database: db, lifecycle: new LifecycleState(), externallyOwned: true });
  let contexts = [];
  const restart = async () => {
    for (const context of contexts) await context.close();
    contexts = await Promise.all([0, 1].map(() => NestFactory.createApplicationContext({ module: class RuntimeFixture {}, imports: [
      PurgeWorkerModule.register(infrastructure, { ledger }), DeletionModule.register(infrastructure, { ledger }),
    ] }, { logger: false, abortOnError: false })));
  };
  await restart();
  t.after(async () => { for (const context of contexts) await context.close(); await db.close(); });
  const state = await db.transactions.write(async tx => {
    const account = await createUser(tx, 'private account'), author = await createUser(tx, 'message author'), peer = await createUser(tx, 'observer');
    for (const user_id of [author, peer]) await tx.prisma.platform_soop.create({ data: { id: randomUUID(), user_id, provider_subject: randomBytes(24), verified_at: await tx.now() } });
    const room = await createRoom(tx, 'runtime fixture room', 'GROUP');
    const member = await joinRoom(tx, room, author); await joinRoom(tx, room, peer); await joinRoom(tx, room, account); await assignRoomOwner(tx, room, member);
    await tx.prisma.creator_accounts.create({ data: { user_id: account, enabled: true } });
    const source = await sendMessage(tx, room, author, sendInput({ clientMessageId: randomUUID(), intent: 'SHARED', content: { type: 'TEXT', text: 'selected row' } }), randomBytes(32));
    const observer = await sendMessage(tx, room, peer, sendInput({ clientMessageId: randomUUID(), intent: 'SHARED', quoteId: source.messageId, content: { type: 'TEXT', text: 'observer content remains' } }), randomBytes(32));
    let stickerId;
    if (sticker) {
      const assetId = randomUUID(); stickerId = randomUUID();
      await tx.prisma.media_assets.create({ data: { id: assetId, owner_user_id: author, kind: 'STICKER', content_type: 'image/webp', state: 'READY', declared_bytes: 10n, reserved_bytes: 20n, expires_at: new Date((await tx.now()).getTime() + 60000) } });
      await tx.prisma.sticker_catalog.create({ data: { id: stickerId, asset_id: assetId, status: 'APPROVED', label: 'test sticker', registered_by_user_id: author } });
      await tx.prisma.message_stickers.create({ data: { room_id: room, message_id: source.messageId, sticker_id: stickerId } });
      await tx.prisma.messages.update({ where: { id: source.messageId }, data: { content_kind: 'STICKER', text_content: null } });
    }
    return { account, author, peer, room, source: source.messageId, observer: observer.messageId, stickerId };
  });
  const messageIntent = await db.transactions.write(tx => contexts[0].get(MessagesCoreService).authorizeDeletion(tx, state.room, state.author, state.source, 'qa'));
  const accountIntent = { schemaVersion: 2, environment: 'qa', scope: 'ACCOUNT', roomId: null, actorUserId: state.account, targetId: state.account,
    requestId: accountDeletionId('qa', state.account), requestedAt: (await db.transactions.read(tx => tx.now())).toISOString(), subjectGuard: null };
  for (const intent of [messageIntent, accountIntent]) await contexts[0].get(DeletionApplyService).apply(await ledger.ensureIntent(intent));
  const queues = () => contexts.map(context => new Jobs(db.transactions, 'worker', new JobsRepository(), context.get(JobsCoreService)));
  const recover = () => contexts[0].get(PurgeWorkerService).recover();
  const recoverAll = async () => {
    // Force a complete bounded discovery pass without wall-clock sleeps.
    await db.transactions.write(tx => tx.prisma.deletion_purge_discovery.deleteMany({ where: { source_id: ledger.sourceId } }));
    for (let i = 0; i < 100; i++) {
      await recover();
      const cursor = await db.transactions.read(tx => tx.prisma.deletion_purge_discovery.findUniqueOrThrow({ where: { source_id_environment: { source_id: ledger.sourceId, environment: 'qa' } } }));
      if (cursor.cursor === null) break;
      await db.transactions.write(tx => tx.prisma.deletion_purge_discovery.update({ where: { source_id_environment: { source_id: ledger.sourceId, environment: 'qa' } }, data: { next_scan_at: new Date(0) } }));
    }
    // Other completed tests' durable intents can be rediscovered. Restrict only
    // this fixture's scheduling window; production discovery has no test filter.
    await db.transactions.write(tx => tx.prisma.jobs.updateMany({ where: { purpose: 'PURGE', resource_id: { notIn: [messageIntent.requestId, accountIntent.requestId] } }, data: { available_at: new Date(Date.now() + 86400000) } }));
  };
  await recoverAll();
  const due = async (ids = [messageIntent.requestId, accountIntent.requestId]) => db.transactions.write(async tx => {
    await tx.prisma.jobs.updateMany({ where: { purpose: 'PURGE', resource_id: { in: [messageIntent.requestId, accountIntent.requestId] }, state: 'PENDING' }, data: { available_at: new Date(Date.now() + 86400000) } });
    await tx.prisma.jobs.updateMany({ where: { purpose: 'PURGE', resource_id: { in: ids }, state: 'PENDING' }, data: { available_at: await tx.now(), max_attempts: 1 } });
  });
  return { db, ledger, store, ...state, messageIntent, accountIntent, restart, recover, recoverAll, due, queues,
    service: (index = 0) => contexts[index].get(PurgeWorkerService), core: () => contexts[0].get(JobsCoreService),
    job: requestId => db.transactions.read(tx => tx.prisma.jobs.findUniqueOrThrow({ where: { purpose_dedupe_key: { purpose: 'PURGE', dedupe_key: purgeDedupe(requestId) } } })),
  };
}

for (const sticker of [false, true]) test(`real two-worker runtime makes bounded exact progress beyond maxAttempts and restart: sticker=${sticker}`, { timeout: 30000 }, async t => {
  const f = await fixture(t, sticker), counts = { progress: 0, subsetDrained: 0, completed: 0 };
  const originalDeadline = f.accountIntent.requestedAt;
  for (let i = 0; i < 16; i++) {
    await f.due();
    const loops = f.queues().map((queue, index) => new WorkerLoop(queue, new LifecycleState(), { PURGE: lease => f.service(index).process(lease) }, { ready: async () => true, maxPerTick: 1 }));
    const results = await Promise.all(loops.map(loop => loop.tick()));
    for (const result of results) for (const key of Object.keys(counts)) counts[key] += result[key];
    await Promise.all(loops.map(loop => loop.stop()));
    if (i === 1) await f.restart();
    const rows = await Promise.all([f.job(f.messageIntent.requestId), f.job(f.accountIntent.requestId)]);
    if (rows.every(row => row.last_error_code === 'PURGE_SUBSET_DRAINED')) break;
  }
  assert.equal(counts.completed, 0); assert.ok(counts.progress > 2); assert.ok(counts.subsetDrained >= 2);
  const result = await f.db.transactions.read(async tx => ({
    root: await tx.prisma.messages.findUnique({ where: { id: f.source } }),
    observer: await tx.prisma.messages.findUniqueOrThrow({ where: { id: f.observer } }),
    profile: await tx.prisma.user_profiles.findUnique({ where: { user_id: f.account } }),
    peer: await tx.prisma.user_profiles.findUniqueOrThrow({ where: { user_id: f.peer } }),
    obligation: await tx.prisma.account_deletion_obligations.findUniqueOrThrow({ where: { user_id: f.account } }),
    proof: await tx.prisma.message_purge_checkpoints.findUniqueOrThrow({ where: { request_id: f.messageIntent.requestId } }),
    jobCount: await tx.prisma.jobs.count({ where: { purpose: 'PURGE', resource_id: { in: [f.messageIntent.requestId, f.accountIntent.requestId] } } }),
  }));
  assert.equal(result.root, null); assert.equal(result.profile, null); assert.equal(result.observer.text_content, 'observer content remains'); assert.equal(result.observer.quote_id, null);
  assert.equal(result.peer.nickname, 'observer'); assert.equal(result.obligation.live_purged_at, null); assert.equal(result.obligation.state, 'BLOCKED');
  assert.equal(result.obligation.requested_at.toISOString(), originalDeadline); assert.equal(result.proof.target_id, f.source); assert.equal(result.jobCount, 2);
  for (const id of [f.messageIntent.requestId, f.accountIntent.requestId]) { const job = await f.job(id); assert.equal(job.state, 'PENDING'); assert.equal(job.attempts, 1); assert.ok(job.generation > 1n); }
  if (sticker) assert.ok(await f.db.transactions.read(tx => tx.prisma.sticker_catalog.findUnique({ where: { id: f.stickerId } })));
});

test('recovery finds crash-before-enqueue and cooldown failures without resetting history or stealing a lease', { timeout: 20000 }, async t => {
  const f = await fixture(t), unrelated = randomUUID();
  const first = await f.job(f.accountIntent.requestId);
  await f.db.transactions.write(async tx => {
    await tx.prisma.jobs.delete({ where: { id: first.id } });
    await tx.prisma.jobs.create({ data: { id: unrelated, purpose: 'PURGE', resource_id: randomUUID(), dedupe_key: randomBytes(32), state: 'FAILED', attempts: 5, last_error_code: 'ATTEMPTS_EXHAUSTED' } });
  });
  await f.restart(); await f.recoverAll();
  const recreated = await f.job(f.accountIntent.requestId); assert.notEqual(recreated.id, first.id);
  await f.db.transactions.write(tx => tx.prisma.jobs.update({ where: { id: recreated.id }, data: { state: 'FAILED', attempts: 5, last_error_code: 'TEMPORARY_UNAVAILABLE', available_at: new Date(0) } }));
  await f.recoverAll();
  const recovered = await f.job(f.accountIntent.requestId); assert.equal(recovered.state, 'PENDING'); assert.equal(recovered.attempts, 5); assert.equal(recovered.last_error_code, 'TEMPORARY_UNAVAILABLE');
  await f.due([f.accountIntent.requestId]); const [lease] = await f.queues()[0].claim({ purposes: ['PURGE'], limit: 1 });
  assert.equal(lease.resourceId, f.accountIntent.requestId); const running = await f.job(f.accountIntent.requestId);
  await f.recoverAll(); assert.deepEqual(await f.job(f.accountIntent.requestId), running);
  assert.equal((await f.db.transactions.read(tx => tx.prisma.jobs.findUniqueOrThrow({ where: { id: unrelated } }))).state, 'FAILED');
});

for (const kind of ['expired', 'superseded', 'owner', 'token', 'resource', 'room', 'purpose']) test(`ACCOUNT page rolls back on ${kind} same-TX fence`, { timeout: 15000 }, async t => {
  const f = await fixture(t); await f.due([f.accountIntent.requestId]); const [lease] = await f.queues()[0].claim({ purposes: ['PURGE'], limit: 1 });
  let forged = lease;
  if (kind === 'expired') await f.db.transactions.write(tx => tx.prisma.jobs.update({ where: { id: lease.id }, data: { lease_until: new Date(0) } }));
  if (kind === 'superseded') await f.db.transactions.write(tx => tx.prisma.jobs.update({ where: { id: lease.id }, data: { generation: { increment: 1n } } }));
  if (kind === 'owner') forged = { ...lease, leaseOwner: randomUUID() };
  if (kind === 'token') forged = { ...lease, leaseToken: randomUUID() };
  if (kind === 'resource') forged = { ...lease, resourceId: randomUUID() };
  if (kind === 'room') forged = { ...lease, roomId: f.room };
  if (kind === 'purpose') forged = { ...lease, purpose: 'MEDIA' };
  await assert.rejects(f.service().process(forged));
  assert.equal((await f.db.transactions.read(tx => tx.prisma.user_profiles.findUniqueOrThrow({ where: { user_id: f.account } }))).nickname, 'private account');
  assert.ok(await f.db.transactions.read(tx => tx.prisma.creator_accounts.findUnique({ where: { user_id: f.account } })));
});

test('unsupported MESSAGE and missing external evidence defer with durable visible obligations', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  await f.db.transactions.write(tx => tx.prisma.messages.update({ where: { id: f.source }, data: { content_kind: 'PHOTO', text_content: null } }));
  await f.due([f.messageIntent.requestId]); let [lease] = await f.queues()[0].claim({ purposes: ['PURGE'], limit: 1 });
  assert.equal(await f.service().process(lease), 'deferred'); assert.equal((await f.job(f.messageIntent.requestId)).last_error_code, 'PURGE_DEFERRED');
  await f.due([f.accountIntent.requestId]); [lease] = await f.queues()[0].claim({ purposes: ['PURGE'], limit: 1 }); f.store.fail = true;
  assert.equal(await f.service().process(lease), 'deferred'); assert.equal((await f.job(f.accountIntent.requestId)).last_error_code, 'PURGE_EVIDENCE_UNAVAILABLE');
  assert.ok(await f.db.transactions.read(tx => tx.prisma.messages.findUnique({ where: { id: f.source } })));
  assert.ok(await f.db.transactions.read(tx => tx.prisma.user_profiles.findUnique({ where: { user_id: f.account } })));
});

test('durable discovery cursor progresses across restarts and revisits a skipped page after a full pass', { timeout: 20000 }, async t => {
  const f = await fixture(t), repository = new PurgeWorkerRepository();
  await f.db.transactions.write(tx => tx.prisma.deletion_purge_discovery.deleteMany({ where: { source_id: f.ledger.sourceId } }));
  const skipped = f.accountIntent.requestId;
  let discovered = false;
  for (let i = 0; i < 100; i++) {
    const page = await f.db.transactions.write(tx => repository.discover(tx, f.ledger.sourceId, 'qa'));
    if (page.includes(skipped)) { discovered = true; break; }
    await f.db.transactions.write(tx => tx.prisma.deletion_purge_discovery.update({ where: { source_id_environment: { source_id: f.ledger.sourceId, environment: 'qa' } }, data: { next_scan_at: new Date(0) } }));
  }
  assert.equal(discovered, true); // Crash after discovery COMMIT, before job creation.
  await f.db.transactions.write(tx => tx.prisma.jobs.deleteMany({ where: { purpose: 'PURGE', resource_id: skipped } }));
  await f.restart();
  let found = false;
  for (let i = 0; i < 100; i++) {
    await f.db.transactions.write(tx => tx.prisma.deletion_purge_discovery.update({ where: { source_id_environment: { source_id: f.ledger.sourceId, environment: 'qa' } }, data: { next_scan_at: new Date(0) } }));
    await f.recover();
    if (await f.db.transactions.read(tx => tx.prisma.jobs.count({ where: { purpose: 'PURGE', resource_id: skipped } }))) { found = true; break; }
  }
  assert.equal(found, true);
});

test('ACCOUNT fresh DB time after a competing job lock wait rejects expired cleanup atomically', { timeout: 15000 }, async t => {
  const f = await fixture(t); await f.due([f.accountIntent.requestId]); const [lease] = await f.queues()[0].claim({ purposes: ['PURGE'], limit: 1 });
  const held = Promise.withResolvers(), release = Promise.withResolvers();
  const blocker = f.db.transactions.write(async tx => {
    await tx.rows('SELECT id FROM jobs WHERE id=? FOR UPDATE', [lease.id]);
    await tx.prisma.jobs.update({ where: { id: lease.id }, data: { lease_until: new Date((await tx.now()).getTime() + 250) } });
    held.resolve(); await release.promise;
  });
  await held.promise;
  let settled = false;
  const process = assert.rejects(f.service().process(lease), /lease_lost/).finally(() => { settled = true; });
  try { await new Promise(resolve => setTimeout(resolve, 1100)); assert.equal(settled, false); }
  finally { release.resolve(); }
  await Promise.all([blocker, process]);
  assert.ok(await f.db.transactions.read(tx => tx.prisma.creator_accounts.findUnique({ where: { user_id: f.account } })));
  assert.ok(await f.db.transactions.read(tx => tx.prisma.user_profiles.findUnique({ where: { user_id: f.account } })));
});

test('unknown MESSAGE COMMIT acknowledgement does not re-execute a committed page or mark it completed', { timeout: 15000 }, async t => {
  const f = await fixture(t); await f.due([f.messageIntent.requestId]);
  const service = f.service(), original = service.transactions; let executed = 0;
  service.transactions = { rollbackConfirmed: () => false, write: async operation => {
    executed++; await original.write(operation); throw new Error('commit_outcome_unknown');
  } };
  const loop = new WorkerLoop(f.queues()[0], new LifecycleState(), { PURGE: lease => service.process(lease) }, { ready: async () => true, maxPerTick: 1 });
  const result = await loop.tick(); await loop.stop();
  assert.equal(executed, 1); assert.equal(result.completed, 0); assert.equal(result.leaseLost, 1); assert.equal(result.retried, 0);
  const job = await f.job(f.messageIntent.requestId); assert.equal(job.state, 'PENDING'); assert.equal(job.last_error_code, 'PURGE_PROGRESS');
});

test('a foreign MESSAGE resource or forged DB hash cannot delete an observer target', { timeout: 15000 }, async t => {
  const f = await fixture(t); await f.due([f.messageIntent.requestId]); const [lease] = await f.queues()[0].claim({ purposes: ['PURGE'], limit: 1 });
  await assert.rejects(f.service().process({ ...lease, roomId: randomUUID() }));
  await f.db.transactions.write(tx => tx.prisma.deletion_intents.update({ where: { request_id: f.messageIntent.requestId }, data: { target_id: f.observer } }));
  await assert.rejects(f.service().process(lease), /invalid_message_purge_intent/);
  assert.equal((await f.db.transactions.read(tx => tx.prisma.messages.findUniqueOrThrow({ where: { id: f.observer } }))).text_content, 'observer content remains');
  assert.ok(await f.db.transactions.read(tx => tx.prisma.messages.findUnique({ where: { id: f.source } })));
});
