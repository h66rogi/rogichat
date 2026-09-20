import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { DatabaseModule } from '../../dist/infrastructure/database/database.module.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { LifecycleState } from '../../dist/common/lifecycle/lifecycle-state.js';
import { PurgeWorkerModule } from '../../dist/modules/deletion/purge-worker.module.js';
import { PurgeWorkerService } from '../../dist/modules/deletion/purge-worker.service.js';
import { AccountCleanupService } from '../../dist/modules/deletion/account-cleanup.service.js';
import { DeletionModule } from '../../dist/modules/deletion/deletion.module.js';
import { DeletionApplyService } from '../../dist/modules/deletion/deletion-apply.service.js';
import { accountDeletionId } from '../../dist/modules/deletion/deletion-ledger.js';
import { Jobs } from '../../dist/modules/jobs/jobs.service.js';
import { JobsRepository } from '../../dist/modules/jobs/jobs.repository.js';
import { JobsCoreService } from '../../dist/modules/jobs/jobs-core.service.js';
import { purgeDedupe } from '../../dist/modules/jobs/jobs.policy.js';
import { MediaWorkerRepository } from '../../dist/modules/media/media-worker.repository.js';
import { MediaWorkerService } from '../../dist/modules/media/media-worker.service.js';
import { deletionFixture } from '../support/deletion-fixture.mjs';
import { createUser, createRoom, joinRoom, assignRoomOwner } from '../support/domain-fixture.mjs';

async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api')), { ledger } = deletionFixture();
  const infrastructure = DatabaseModule.register({ database: db, lifecycle: new LifecycleState(), externallyOwned: true });
  let context;
  const restart = async () => {
    if (context) await context.close();
    context = await NestFactory.createApplicationContext({ module: class Fixture {}, imports: [
      PurgeWorkerModule.register(infrastructure, { ledger }), DeletionModule.register(infrastructure, { ledger }),
    ] }, { logger: false, abortOnError: false });
  };
  await restart(); t.after(async () => { await context.close(); await db.close(); });
  const state = await db.transactions.write(async tx => {
    const user = await createUser(tx, 'owned'), peer = await createUser(tx, 'independent');
    const rooms = [];
    for (let i = 0; i < 2; i++) {
      const id = await createRoom(tx, 'owned content fixture', 'GROUP');
      const member = await joinRoom(tx, id, user), other = await joinRoom(tx, id, peer);
      await assignRoomOwner(tx, id, other);
      const stream = await tx.prisma.message_streams.findFirstOrThrow({ where: { room_id: id, kind: 'ROOM_SHARED' }, select: { id: true } });
      rooms.push({ id, member, other, stream: stream.id });
    }
    return { user, peer, rooms };
  });
  const intent = { schemaVersion: 2, environment: 'qa', requestId: accountDeletionId('qa', state.user), actorUserId: state.user,
    targetId: state.user, scope: 'ACCOUNT', roomId: null, subjectGuard: null, requestedAt: (await db.transactions.read(tx => tx.now())).toISOString() };
  const admit = async () => {
    await context.get(DeletionApplyService).apply(await ledger.ensureIntent(intent));
    await db.transactions.write(tx => context.get(JobsCoreService).enqueue(tx, { purpose: 'PURGE', resourceId: intent.requestId, dedupeKey: purgeDedupe(intent.requestId) }));
  };
  const core = () => context.get(JobsCoreService);
  const queue = () => new Jobs(db.transactions, 'worker', new JobsRepository(), core());
  const lease = async (purpose, resource) => {
    await db.transactions.write(async tx => {
      await tx.prisma.jobs.updateMany({ where: { purpose, state: 'PENDING' }, data: { available_at: new Date(Date.now() + 86400000) } });
      await tx.prisma.jobs.updateMany({ where: { purpose, resource_id: resource, state: 'PENDING' }, data: { available_at: new Date(0), max_attempts: 1 } });
    });
    const [result] = await queue().claim({ purposes: [purpose], limit: 1 }); assert.ok(result); assert.equal(result.resourceId, resource); return result;
  };
  const step = async () => context.get(PurgeWorkerService).process(await lease('PURGE', intent.requestId));
  const drain = async (max = 100) => { for (let i = 0; i < max; i++) if (await step() === 'subset_drained') return; assert.fail('did not drain'); };
  const message = async (room = state.rooms[0], owner = state.user, root = null, kind = 'TEXT') => db.transactions.write(async tx => {
    const id = randomUUID(); await tx.prisma.messages.create({ data: { id, room_id: room.id, stream_id: room.stream,
      sender_member_id: room.other, content_owner_user_id: owner, deletion_root_id: root, content_kind: kind, text_content: kind === 'TEXT' ? 'fixture body' : null, created_order: 1n } }); return id;
  });
  const asset = async (owner = state.user, room = state.rooms[0].id, count = 1, unknown = false) => db.transactions.write(async tx => {
    const id = randomUUID(); await tx.prisma.media_assets.create({ data: { id, owner_user_id: owner, room_id: room,
      kind: room ? 'PHOTO' : 'AVATAR', content_type: 'image/png', state: 'READY', declared_bytes: 1n, reserved_bytes: BigInt(count), expires_at: new Date(Date.now() + 86400000) } });
    await tx.prisma.media_budget.upsert({ where: { id: 'global' }, create: { id: 'global', limit_bytes: 1000000n, reserved_bytes: BigInt(count) }, update: { reserved_bytes: { increment: BigInt(count) } } });
    await tx.prisma.media_objects.createMany({ data: Array.from({ length: count }, (_, i) => ({ id: randomUUID(), asset_id: id, attempt_id: randomUUID(), variant: 'image',
      object_key: `test/${id}/${i}`, state: unknown && i === 0 ? 'ALLOCATED' : 'READY', byte_length: unknown && i === 0 ? null : 1n, sha256: unknown && i === 0 ? null : 'a'.repeat(64) })) }); return id;
  });
  return { db, ledger, intent, ...state, restart, admit, step, drain, message, asset, lease, core,
    apply: receipt => context.get(DeletionApplyService).apply(receipt), service: () => context.get(PurgeWorkerService), cleanup: () => context.get(AccountCleanupService) };
}

test('ACCOUNT runtime owns roots/copies across rooms, not publisher membership, and survives restart', { timeout: 30000 }, async t => {
  const f = await fixture(t), root = await f.message(), copy = await f.message(f.rooms[0], f.user, root), second = await f.message(f.rooms[1]);
  const independent = await f.message(f.rooms[0], f.peer);
  await f.db.transactions.write(tx => tx.prisma.messages.update({ where: { id: independent }, data: { quote_id: root } }));
  const before = await f.db.transactions.read(tx => tx.prisma.rooms.findMany({ where: { id: { in: f.rooms.map(r => r.id) } }, select: { content_epoch: true } }));
  await f.admit(); await f.step(); await f.restart(); await f.drain();
  await f.db.transactions.read(async tx => {
    assert.equal(await tx.prisma.messages.count({ where: { id: { in: [root, copy, second] } } }), 0);
    const other = await tx.prisma.messages.findUniqueOrThrow({ where: { id: independent } }); assert.equal(other.text_content, 'fixture body'); assert.equal(other.quote_id, null);
    const proofs = await tx.prisma.account_content_checkpoints.findMany({ where: { request_id: f.intent.requestId } });
    assert.equal(proofs.length, 3); assert.ok(proofs.every(p => p.rows_purged_at && p.content_owner_user_id === f.user && p.requested_at.toISOString() === f.intent.requestedAt));
    assert.equal(proofs.find(p => p.message_id === copy).deletion_root_id, root);
    assert.equal(await tx.prisma.deletion_requests.count({ where: { actor_user_id: f.user } }), 0);
    const obligation = await tx.prisma.account_deletion_obligations.findUniqueOrThrow({ where: { user_id: f.user } }); assert.equal(obligation.live_purged_at, null);
    const rooms = await tx.prisma.rooms.findMany({ where: { id: { in: f.rooms.map(r => r.id) } }, select: { content_epoch: true } });
    assert.ok(rooms.every((r, i) => r.content_epoch > before[i].content_epoch));
  });
  const job = await f.db.transactions.read(tx => tx.prisma.jobs.findUniqueOrThrow({ where: { purpose_dedupe_key: { purpose: 'PURGE', dedupe_key: purgeDedupe(f.intent.requestId) } } }));
  assert.equal(job.state, 'PENDING'); assert.equal(job.attempts, 1); assert.ok(job.generation > 5n);
});

test('avatar and publication-derived assets retain provenance before detach, shared/service assets survive', { timeout: 30000 }, async t => {
  const f = await fixture(t), root = await f.message(f.rooms[0], f.user, null, 'PHOTO');
  const owned = await f.asset(), shared = await f.asset(), derived = await f.asset(f.peer), avatar = await f.asset(f.user, null), service = await f.asset(f.user, null);
  const independent = await f.message(f.rooms[0], f.peer, null, 'PHOTO');
  await f.db.transactions.write(async tx => {
    for (const [message_id, asset_id, position] of [[root, owned, 0], [root, shared, 1], [independent, shared, 0]]) await tx.prisma.message_attachments.create({ data: { id: randomUUID(), room_id: f.rooms[0].id, message_id, asset_id, position } });
    await tx.prisma.user_profiles.update({ where: { user_id: f.user }, data: { avatar_asset_id: avatar } });
    await tx.prisma.sticker_catalog.create({ data: { id: randomUUID(), asset_id: service, status: 'ACTIVE', label: 'service', registered_by_user_id: f.user, approved_at: await tx.now() } });
    const sourceObject = await tx.prisma.media_objects.findFirstOrThrow({ where: { asset_id: owned }, select: { id: true } });
    const publication = randomUUID(); await tx.prisma.message_publications.create({ data: { id: publication, room_id: f.rooms[0].id, source_message_id: root, source_version: 1n, publisher_member_id: f.rooms[0].other } });
    await tx.prisma.publication_media.create({ data: { id: randomUUID(), room_id: f.rooms[0].id, publication_id: publication, position: 0,
      source_asset_id: owned, source_object_id: sourceObject.id, destination_asset_id: derived } });
  });
  await f.admit(); await f.drain();
  await f.db.transactions.read(async tx => {
    for (const id of [owned, derived, avatar]) {
      assert.equal((await tx.prisma.media_assets.findUniqueOrThrow({ where: { id } })).state, 'DELETING');
      assert.ok(await tx.prisma.account_media_provenance.findFirst({ where: { request_id: f.intent.requestId, asset_id: id, disposition: 'REVOKED' } }));
    }
    for (const id of [shared, service]) assert.equal((await tx.prisma.media_assets.findUniqueOrThrow({ where: { id } })).state, 'READY');
    assert.equal(await tx.prisma.message_attachments.count({ where: { message_id: independent, asset_id: shared } }), 1);
    assert.equal(await tx.prisma.publication_media.count({ where: { destination_asset_id: derived } }), 0);
    assert.equal(await tx.prisma.user_profiles.count({ where: { user_id: f.user } }), 0);
  });
});

for (const unknown of [false, true]) test(`durable media pages beyond500 and stable continuation; unknown=${unknown}`, { timeout: 60000 }, async t => {
  const f = await fixture(t), assetId = await f.asset(f.user, null, 501, unknown);
  await f.admit(); await f.drain();
  const repository = new MediaWorkerRepository(); let removes = 0;
  const worker = () => new MediaWorkerService(f.db.transactions, { async remove() { removes++; } }, {}, 'test', repository, f.core(), {}, { async invalidateRevokedSticker() { return false; } });
  await f.db.transactions.write(tx => worker().recoverMedia(tx));
  for (let i = 0; i < 8; i++) {
    const row = await f.db.transactions.read(tx => tx.prisma.media_assets.findUniqueOrThrow({ where: { id: assetId } }));
    if (row.state === 'DELETED') break;
    await worker().processMedia(await f.lease('MEDIA', assetId));
    if (i === 1) await f.restart();
  }
  await f.db.transactions.read(async tx => {
    const row = await tx.prisma.media_assets.findUniqueOrThrow({ where: { id: assetId } });
    assert.equal(row.state, unknown ? 'DELETING' : 'DELETED'); assert.equal(row.reserved_bytes, unknown ? 501n : 0n);
    assert.equal(await tx.prisma.media_cleanup_attempts.count({ where: { asset_id: assetId } }), 501);
    assert.equal(await tx.prisma.jobs.count({ where: { purpose: 'MEDIA', resource_id: assetId } }), 1);
    if (unknown) assert.equal(await tx.prisma.media_cleanup_attempts.count({ where: { asset_id: assetId, writer_acknowledged: false } }), 1);
  });
  assert.ok(removes >= 501);
});

for (const mode of ['lease-loss', 'unknown-commit']) test(`content/provenance atomicity on ${mode}`, { timeout: 30000 }, async t => {
  const f = await fixture(t), message = await f.message(); await f.admit();
  // Drain only the pre-content phases; stop before the first message mutation.
  for (let i = 0; i < 20; i++) {
    const row = await f.db.transactions.read(tx => tx.prisma.room_members.findFirst({ where: { user_id: f.user, OR: [{ status: { not: 'LEFT' } }, { periods: { some: {} } }] } }));
    if (!row && !await f.db.transactions.read(tx => tx.prisma.user_profiles.findUnique({ where: { user_id: f.user } }))) break;
    await f.step();
  }
  const lease = await f.lease('PURGE', f.intent.requestId);
  if (mode === 'lease-loss') {
    await f.db.transactions.write(tx => tx.prisma.jobs.update({ where: { id: lease.id }, data: { lease_until: new Date(0) } }));
    await assert.rejects(f.service().process(lease), /lease_lost/);
    assert.equal(await f.db.transactions.read(tx => tx.prisma.account_content_checkpoints.count({ where: { request_id: f.intent.requestId } })), 0);
    assert.equal((await f.db.transactions.read(tx => tx.prisma.messages.findUniqueOrThrow({ where: { id: message } }))).deleted_at, null);
  } else {
    const service = f.cleanup(), original = service.transactions; let executions = 0;
    service.transactions = { async write(operation) { executions++; await original.write(operation); throw new Error('commit_outcome_unknown'); } };
    try { await assert.rejects(f.service().process(lease), /commit_outcome_unknown/); } finally { service.transactions = original; }
    assert.equal(executions, 1);
    assert.equal(await f.db.transactions.read(tx => tx.prisma.account_content_checkpoints.count({ where: { request_id: f.intent.requestId } })), 1);
    await f.restart(); await f.drain();
    assert.equal(await f.db.transactions.read(tx => tx.prisma.messages.count({ where: { id: message } })), 0);
  }
});

for (const concurrent of [false, true]) test(`ACCOUNT and MESSAGE exact checkpoints converge across scope; concurrent=${concurrent}`, { timeout: 30000 }, async t => {
  const f = await fixture(t), root = await f.message(), copy = await f.message(f.rooms[0], f.user, root);
  const messageIntent = { schemaVersion: 1, environment: 'qa', requestId: randomUUID(), actorUserId: f.peer, scope: 'MESSAGE', roomId: f.rooms[0].id,
    targetId: root, requestedAt: (await f.db.transactions.read(tx => tx.now())).toISOString() };
  await f.apply(await f.ledger.ensureIntent(messageIntent));
  await f.db.transactions.write(tx => f.core().enqueue(tx, { purpose: 'PURGE', resourceId: messageIntent.requestId, roomId: messageIntent.roomId, dedupeKey: purgeDedupe(messageIntent.requestId) }));
  await f.admit();
  if (!concurrent) await f.drain();
  let accountDone = !concurrent, messageDone = false;
  for (let i = 0; i < 30 && (!accountDone || !messageDone); i++) {
    const account = accountDone ? null : await f.lease('PURGE', f.intent.requestId);
    const message = messageDone ? null : await f.lease('PURGE', messageIntent.requestId);
    const results = await Promise.all([account ? f.service().process(account) : 'subset_drained', message ? f.service().process(message) : 'subset_drained']);
    accountDone = results[0] === 'subset_drained'; messageDone = results[1] === 'subset_drained';
    if (i === 1) await f.restart();
  }
  assert.ok(accountDone && messageDone);
  await f.db.transactions.read(async tx => {
    assert.equal(await tx.prisma.messages.count({ where: { id: { in: [root, copy] } } }), 0);
    assert.ok(await tx.prisma.message_purge_checkpoints.findUnique({ where: { request_id: messageIntent.requestId } }));
    assert.equal(await tx.prisma.deletion_requests.count({ where: { actor_user_id: f.user } }), 0);
    assert.equal(await tx.prisma.jobs.count({ where: { purpose: 'PURGE', resource_id: { in: [messageIntent.requestId, f.intent.requestId] } } }), 2);
  });
});

test('restart reopens restored owned rows and scrubs orphan receipts using original ACCOUNT evidence', { timeout: 30000 }, async t => {
  const f = await fixture(t), root = await f.message(); await f.admit(); await f.drain();
  const original = await f.db.transactions.read(tx => tx.prisma.account_content_checkpoints.findUniqueOrThrow({ where: { request_id_message_id: { request_id: f.intent.requestId, message_id: root } } }));
  const receiptId = randomUUID();
  await f.db.transactions.write(async tx => {
    await tx.prisma.command_receipts.create({ data: { id: receiptId, room_id: f.rooms[0].id, actor_id: f.rooms[0].other,
      client_message_id: randomUUID(), message_id: root, payload_digest: Buffer.alloc(32, 7) } });
  });
  await f.restart(); await f.drain();
  const scrubbed = await f.db.transactions.read(tx => tx.prisma.command_receipts.findUniqueOrThrow({ where: { id: receiptId } }));
  assert.equal(scrubbed.deleted, true); assert.equal(scrubbed.payload_digest, null);
  await f.db.transactions.write(tx => tx.prisma.messages.create({ data: { id: root, room_id: f.rooms[0].id, stream_id: f.rooms[0].stream,
    sender_member_id: f.rooms[0].other, content_owner_user_id: f.user, content_kind: 'TEXT', text_content: 'restored private body', created_order: 1n } }));
  await f.restart(); await f.drain();
  const replayed = await f.db.transactions.read(tx => tx.prisma.account_content_checkpoints.findUniqueOrThrow({ where: { request_id_message_id: { request_id: f.intent.requestId, message_id: root } } }));
  assert.equal(replayed.requested_at.getTime(), original.requested_at.getTime()); assert.deepEqual(replayed.ledger_sha256, original.ledger_sha256);
  assert.ok(replayed.rows_purged_at >= original.rows_purged_at);
  assert.equal(await f.db.transactions.read(tx => tx.prisma.messages.count({ where: { id: root } })), 0);
});
