import 'reflect-metadata';
import { MembershipScopeService } from '../../dist/modules/membership-scope/membership-scope.service.js';
import { MembershipScopeRepository } from '../../dist/modules/membership-scope/membership-scope.repository.js';
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
import { MessagesQueryService } from '../../dist/modules/messages/messages-query.service.js';
import { UsersCoreModule } from '../../dist/modules/users/users-core.module.js';
import { UsersCoreService } from '../../dist/modules/users/users-core.service.js';
import { AccessService } from '../../dist/modules/access/access.service.js';
import { DeletionApplyService } from '../../dist/modules/deletion/deletion-apply.service.js';
import { DeletionRepository } from '../../dist/modules/deletion/deletion.repository.js';
import { AccountDeletionRepository } from '../../dist/modules/deletion/account-deletion.repository.js';
import { IdentityGuardService } from '../../dist/modules/auth/identity-guard.service.js';
import { IdentityGuardRepository } from '../../dist/modules/auth/identity-guard.repository.js';
import { SyncCoreService } from '../../dist/modules/sync/sync-core.service.js';
import { SyncRepository } from '../../dist/modules/sync/sync.repository.js';
import { deletionFixture } from '../support/deletion-fixture.mjs';
import { createUser, createRoom, joinRoom, assignRoomOwner, sendMessage, sendInput, getMessage, nextOrder } from '../support/domain-fixture.mjs';

class FixtureModule {}
Module({ imports: [MessagePurgeModule, MessagesCoreModule, UsersCoreModule] })(FixtureModule);
async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new PrismaDatabase(readConfig('api'));
  const open = () => NestFactory.createApplicationContext(FixtureModule, { logger: false, abortOnError: false });
  let context = await open();
  t.after(async () => { await context.close(); await db.close(); });
  const key = randomBytes(32), { ledger } = deletionFixture();
  const state = await db.transactions.write(async tx => {
    const owner = await createUser(tx, '합성 방장'), author = await createUser(tx, '합성 작성자'), peer = await createUser(tx, '독립 작성자');
    for (const id of [owner, author, peer]) await tx.prisma.platform_soop.create({ data: { id: randomUUID(), user_id: id, provider_subject: randomBytes(24), verified_at: await tx.now() }, select: { id: true } });
    const room = await createRoom(tx, '합성 물리 삭제', 'GROUP');
    const ownerActor = await joinRoom(tx, room, owner), authorActor = await joinRoom(tx, room, author), peerActor = await joinRoom(tx, room, peer);
    await assignRoomOwner(tx, room, ownerActor);
    return { room, owner, author, peer, ownerActor, authorActor, peerActor };
  });
  const body = sendInput({ clientMessageId: randomUUID(), intent: 'SHARED', content: { type: 'TEXT', text: '삭제 대상' } });
  const source = await db.transactions.write(tx => sendMessage(tx, state.room, state.author, body, key));
  const apply = () => new DeletionApplyService(db.transactions, context.get(MessagesCoreService), new DeletionRepository(), new AccountDeletionRepository(), new IdentityGuardService(new IdentityGuardRepository()));
  let receipt, lease;
  const block = async (targetId = source.messageId, actorId = state.author) => {
    const intent = await db.transactions.write(tx => context.get(MessagesCoreService).authorizeDeletion(tx, state.room, actorId, targetId, 'qa'));
    receipt = await ledger.ensureIntent(intent);
    assert.equal((await apply().apply(receipt)).status, 'blocked');
    lease = await db.transactions.write(async tx => {
      const job = await tx.prisma.jobs.findFirstOrThrow({ where: { purpose: 'PURGE', resource_id: intent.requestId }, select: { id: true, generation: true, max_attempts: true } });
      const generation = job.generation + 1n, leaseOwner = randomUUID(), leaseToken = randomUUID();
      await tx.prisma.jobs.update({ where: { id: job.id }, data: { state: 'RUNNING', generation, lease_owner: leaseOwner, lease_token: leaseToken, lease_until: new Date((await tx.now()).getTime() + 300000) }, select: { id: true } });
      return { id: job.id, purpose: 'PURGE', roomId: state.room, resourceId: intent.requestId, generation, leaseOwner, leaseToken, attempts: 1, maxAttempts: job.max_attempts };
    });
  };
  const step = (limit = 2, useLease = lease) => context.get(MessagePurgeService).step(db.transactions, 'qa', useLease, limit);
  const finish = async (limit = 2, useLease = lease) => {
    for (let n = 0; n < 100; n++) {
      const result = await step(limit, useLease); assert.ok(result.changed <= limit);
      if (result.status !== 'progress') return result;
    }
    assert.fail('bounded purge did not converge');
  };
  const sync = new SyncCoreService(key, 'purge-test', new SyncRepository(), context.get(AccessService), context.get(MessagesQueryService), context.get(UsersCoreService), new MembershipScopeService({ key, audience: 'purge-test' }, new MembershipScopeRepository()));
  const principal = { userId: state.peer, sessionId: randomUUID() }, input = { deviceId: randomUUID(), cacheId: randomUUID(), limit: 1 };
  const roomSync = (method, cursor) => db.transactions.read(tx => sync[method](tx, principal, state.room, { ...input, ...(cursor ? { cursor } : {}) }));
  return { db, ...state, body, source, block, step, finish, roomSync,
    get lease() { return lease; }, get receipt() { return receipt; }, replay: (useReceipt = receipt) => apply().apply(useReceipt),
    restart: async () => { await context.close(); context = await open(); },
    quote: () => db.transactions.write(tx => sendMessage(tx, state.room, state.peer, sendInput({ clientMessageId: randomUUID(), intent: 'SHARED', quoteId: source.messageId, content: { type: 'TEXT', text: '독립 본문 유지' } }), key)),
    retry: () => db.transactions.write(tx => sendMessage(tx, state.room, state.author, body, key)),
  };
}

const rootRow = f => f.db.transactions.read(tx => tx.prisma.messages.findUnique({ where: { id: f.source.messageId }, select: { id: true } }));

test('bounded physical MESSAGE purge survives restart, preserves dedupe/replay and invalidates event/history/derived caches', { timeout: 20000 }, async t => {
  const f = await fixture(t), quotes = [];
  for (let i = 0; i < 5; i++) quotes.push(await f.quote());
  const snapshot = await f.roomSync('snapshot'); assert.ok(snapshot.historyCursor);
  const profiles = await f.roomSync('profiles'); assert.ok(profiles.nextCursor);
  await f.block();
  await assert.rejects(f.quote(), { code: 'NOT_FOUND' });
  const checkpoint = await f.db.transactions.read(tx => tx.prisma.deletion_intents.findUnique({ where: { request_id: f.receipt.intent.requestId } }));
  assert.equal((await f.step()).status, 'progress');
  await f.restart();
  assert.equal((await f.finish()).status, 'rows_purged');
  assert.equal(await rootRow(f), null);
  assert.equal((await f.roomSync('events', snapshot.nextCursor)).resetRequired, true);
  assert.equal((await f.roomSync('history', snapshot.historyCursor)).resetRequired, true);
  assert.equal((await f.roomSync('profiles', profiles.nextCursor)).resetRequired, true);
  const fresh = await f.roomSync('snapshot');
  assert.equal(fresh.resetRequired, false);
  assert.equal(fresh.membershipScope, snapshot.membershipScope);
  assert.notEqual(fresh.authorizationRevision, snapshot.authorizationRevision); assert.ok(fresh.messages.every(message => message.quote === null));
  for (const quote of quotes) {
    const view = await f.db.transactions.read(tx => getMessage(tx, f.room, f.peer, quote.messageId));
    assert.equal(view.content.text, '독립 본문 유지'); assert.equal(view.quote, null);
  }
  assert.equal((await f.retry()).status, 'deleted');
  assert.equal((await f.replay()).status, 'blocked');
  assert.deepEqual(await f.db.transactions.read(tx => tx.prisma.deletion_intents.findUnique({ where: { request_id: f.receipt.intent.requestId } })), checkpoint);
  const retained = await f.db.transactions.read(async tx => ({
    receipt: await tx.prisma.command_receipts.findFirstOrThrow({ where: { message_id: f.source.messageId }, select: { deleted: true, payload_digest: true, message_id: true } }),
    request: await tx.prisma.deletion_requests.findUniqueOrThrow({ where: { id: f.receipt.intent.requestId }, select: { state: true, message_id: true, requested_at: true } }),
    proof: await tx.prisma.message_purge_checkpoints.findUniqueOrThrow({ where: { request_id: f.receipt.intent.requestId } }),
    events: await tx.prisma.room_events.count({ where: { message_id: f.source.messageId } }),
  }));
  assert.deepEqual(retained.receipt, { deleted: true, payload_digest: null, message_id: f.source.messageId });
  assert.equal(retained.request.state, 'BLOCKED'); assert.equal(retained.events, 0);
  assert.equal(retained.proof.target_id, f.source.messageId); assert.ok(retained.proof.rows_purged_at);
  assert.deepEqual(await f.step(), { status: 'rows_purged', changed: 0 });
});

test('stale/expired leases roll back page mutations and invalid scopes cannot select arbitrary messages', { timeout: 15000 }, async t => {
  const f = await fixture(t); await f.block();
  const before = await f.db.transactions.read(tx => tx.prisma.jobs.count({ where: { purpose: 'PUSH', resource_id: f.source.messageId } }));
  await assert.rejects(f.step(2, { ...f.lease, leaseToken: randomUUID() }), /lease_lost/);
  assert.equal(await f.db.transactions.read(tx => tx.prisma.jobs.count({ where: { purpose: 'PUSH', resource_id: f.source.messageId } })), before);
  await f.db.transactions.write(tx => tx.prisma.jobs.update({ where: { id: f.lease.id }, data: { lease_until: new Date(0) }, select: { id: true } }));
  await assert.rejects(f.step(), /lease_lost/);
  await assert.rejects(f.step(2, { ...f.lease, roomId: randomUUID() }), /invalid_message_purge_intent/);
  await assert.rejects(f.step(501), /invalid_message_purge_input/);
  assert.ok(await rootRow(f));
});

test('missing root without exact atomic proof remains deferred and never downgrades a prior block', { timeout: 15000 }, async t => {
  const f = await fixture(t); await f.block(); await f.finish();
  await f.db.transactions.write(tx => tx.prisma.message_purge_checkpoints.delete({ where: { request_id: f.receipt.intent.requestId }, select: { request_id: true } }));
  assert.deepEqual(await f.step(), { status: 'deferred', changed: 0 });
  assert.equal((await f.replay()).status, 'blocked');
  const checkpoint = await f.db.transactions.read(tx => tx.prisma.deletion_intents.findUniqueOrThrow({ where: { request_id: f.receipt.intent.requestId } }));
  assert.ok(checkpoint.blocked_at);
  await f.db.transactions.write(tx => tx.prisma.message_purge_checkpoints.create({ data: { request_id: checkpoint.request_id, environment: 'qa', actor_user_id: checkpoint.actor_user_id, room_id: checkpoint.room_id,
    target_id: randomUUID(), requested_at: checkpoint.requested_at, ledger_sha256: checkpoint.ledger_sha256, rows_purged_at: new Date() } }));
  await assert.rejects(f.step(), /checkpoint_conflict/);
});

test('media attachments defer the complete target with provenance, queue and quota intact', { timeout: 15000 }, async t => {
  const f = await fixture(t), assetId = randomUUID();
  await f.db.transactions.write(async tx => {
    await tx.prisma.media_assets.create({ data: { id: assetId, room_id: f.room, owner_user_id: f.author, kind: 'PHOTO', content_type: 'image/jpeg', state: 'READY', declared_bytes: 10n, reserved_bytes: 20n, expires_at: new Date(Date.now() + 60000) } });
    await tx.prisma.message_attachments.create({ data: { id: randomUUID(), room_id: f.room, message_id: f.source.messageId, asset_id: assetId, position: 0 } });
  });
  await f.block();
  const before = await f.db.transactions.read(tx => tx.prisma.jobs.count({ where: { room_id: f.room } }));
  assert.deepEqual(await f.step(), { status: 'deferred', changed: 0 });
  assert.ok(await rootRow(f));
  assert.equal(await f.db.transactions.read(tx => tx.prisma.jobs.count({ where: { room_id: f.room } })), before);
  const asset = await f.db.transactions.read(tx => tx.prisma.media_assets.findUniqueOrThrow({ where: { id: assetId }, select: { reserved_bytes: true, attachments: { select: { id: true } } } }));
  assert.equal(asset.reserved_bytes, 20n); assert.equal(asset.attachments.length, 1);
});

test('publication copies purge before source, scoped jobs disappear and unrelated rows survive', { timeout: 15000 }, async t => {
  const f = await fixture(t), copyId = randomUUID(), publicationId = randomUUID(), unrelatedJob = randomUUID();
  await f.db.transactions.write(async tx => {
    const source = await tx.prisma.messages.findUniqueOrThrow({ where: { id: f.source.messageId }, select: { stream_id: true } });
    await tx.prisma.messages.create({ data: { id: copyId, room_id: f.room, stream_id: source.stream_id, sender_member_id: f.ownerActor, content_owner_user_id: f.author, deletion_root_id: f.source.messageId, text_content: '합성 공개 복사본', created_order: await nextOrder(tx, f.room) } });
    await tx.prisma.message_publications.create({ data: { id: publicationId, room_id: f.room, source_message_id: f.source.messageId, source_version: 1n, publisher_member_id: f.ownerActor, published_message_id: copyId, state: 'PUBLISHED' } });
    await tx.prisma.jobs.createMany({ data: [
      { id: randomUUID(), purpose: 'PUBLICATION', room_id: f.room, resource_id: publicationId },
      { id: randomUUID(), purpose: 'PUSH', room_id: null, resource_id: copyId },
      { id: unrelatedJob, purpose: 'PUBLICATION', room_id: f.room, resource_id: randomUUID(), available_at: new Date((await tx.now()).getTime() + 3600000) },
    ] });
  });
  try {
    await f.block(); assert.equal((await f.finish(1)).status, 'rows_purged');
    const remaining = await f.db.transactions.read(async tx => ({
      copy: await tx.prisma.messages.findUnique({ where: { id: copyId } }),
      publication: await tx.prisma.message_publications.findUnique({ where: { id: publicationId } }),
      job: await tx.prisma.jobs.findUnique({ where: { id: unrelatedJob } }),
    }));
    assert.equal(remaining.copy, null); assert.equal(remaining.publication, null); assert.ok(remaining.job);
  } finally {
    // Preserve the assertion above without leaking this owned sentinel into
    // later tests that claim PUBLICATION jobs from the shared disposable queue.
    await f.db.transactions.write(tx => tx.prisma.jobs.deleteMany({ where: { id: unrelatedJob } }));
  }
});

test('approved service sticker asset and catalog survive message-link purge', { timeout: 15000 }, async t => {
  const f = await fixture(t), assetId = randomUUID(), stickerId = randomUUID();
  await f.db.transactions.write(async tx => {
    await tx.prisma.media_assets.create({ data: { id: assetId, owner_user_id: f.author, kind: 'STICKER', content_type: 'image/webp', state: 'READY', declared_bytes: 10n, reserved_bytes: 20n, expires_at: new Date(Date.now() + 60000) } });
    await tx.prisma.sticker_catalog.create({ data: { id: stickerId, asset_id: assetId, status: 'APPROVED', label: '합성 스티커', registered_by_user_id: f.author } });
    await tx.prisma.message_stickers.create({ data: { room_id: f.room, message_id: f.source.messageId, sticker_id: stickerId } });
    await tx.prisma.messages.update({ where: { id: f.source.messageId }, data: { content_kind: 'STICKER', text_content: null } });
  });
  await f.block(); assert.equal((await f.finish()).status, 'rows_purged');
  assert.equal(await f.db.transactions.read(tx => tx.prisma.message_stickers.count({ where: { message_id: f.source.messageId } })), 0);
  assert.ok(await f.db.transactions.read(tx => tx.prisma.sticker_catalog.findUnique({ where: { id: stickerId } })));
  assert.equal((await f.db.transactions.read(tx => tx.prisma.media_assets.findUniqueOrThrow({ where: { id: assetId } }))).reserved_bytes, 20n);
});

test('lease expiry during a real second-connection job lock wait rolls back the whole page', { timeout: 15000 }, async t => {
  const f = await fixture(t); await f.block();
  const other = new PrismaDatabase(readConfig('api')); t.after(() => other.close());
  const held = Promise.withResolvers(), release = Promise.withResolvers();
  const blocker = other.transactions.write(async tx => {
    await tx.rows('SELECT id FROM jobs WHERE id=? FOR UPDATE', [f.lease.id]);
    await tx.prisma.jobs.update({ where: { id: f.lease.id }, data: { lease_until: new Date((await tx.now()).getTime() + 250) }, select: { id: true } });
    held.resolve(); await release.promise;
  });
  await held.promise;
  let settled = false;
  const step = assert.rejects(f.step(), /lease_lost/).finally(() => { settled = true; });
  try { await new Promise(resolve => setTimeout(resolve, 1100)); assert.equal(settled, false); }
  finally { release.resolve(); }
  await Promise.all([blocker, step]);
  assert.equal(await f.db.transactions.read(tx => tx.prisma.jobs.count({ where: { purpose: 'PUSH', room_id: null, resource_id: f.source.messageId } })), 1);
  assert.ok(await rootRow(f));
});

test('message-scope notification cleanup removes deliveries before provenance without touching subscriber state', { timeout: 15000 }, async t => {
  const f = await fixture(t), subscriptionId = randomUUID(), sessionId = randomUUID(), deliveryId = randomUUID(), jobId = randomUUID();
  await f.db.transactions.write(async tx => {
    await tx.prisma.auth_sessions.create({ data: { id: sessionId, user_id: f.peer, audience: 'purge-test', token_digest: randomBytes(32), csrf_digest: randomBytes(32), expires_at: new Date(Date.now() + 60000) } });
    await tx.prisma.notification_preferences.create({ data: { user_id: f.peer, push_enabled: true } });
    await tx.prisma.push_subscriptions.create({ data: { id: subscriptionId, user_id: f.peer, session_id: sessionId, audience: 'purge-test', endpoint: `https://example.test/${subscriptionId}`, endpoint_digest: randomBytes(32), p256dh: 'synthetic-key', auth_secret: 'synthetic-auth', account_generation: 1n } });
    await tx.prisma.push_deliveries.create({ data: { id: deliveryId, subscription_id: subscriptionId, room_id: f.room, message_id: f.source.messageId, subscription_generation: 1n, account_generation: 1n, preference_generation: 1n } });
    await tx.prisma.jobs.create({ data: { id: jobId, purpose: 'PUSH', room_id: f.room, resource_id: deliveryId } });
  });
  await f.block(); assert.equal((await f.finish(1)).status, 'rows_purged');
  const state = await f.db.transactions.read(async tx => ({
    delivery: await tx.prisma.push_deliveries.findUnique({ where: { id: deliveryId } }),
    job: await tx.prisma.jobs.findUnique({ where: { id: jobId } }),
    subscription: await tx.prisma.push_subscriptions.findUnique({ where: { id: subscriptionId } }),
    preference: await tx.prisma.notification_preferences.findUnique({ where: { user_id: f.peer } }),
  }));
  assert.equal(state.delivery, null); assert.equal(state.job, null);
  assert.ok(state.subscription); assert.equal(state.preference.push_enabled, true);
});

test('unpublished photo-copy provenance defers even a text root with no message attachments', { timeout: 15000 }, async t => {
  const f = await fixture(t), sourceAsset = randomUUID(), destinationAsset = randomUUID(), objectId = randomUUID(), publicationId = randomUUID();
  await f.db.transactions.write(async tx => {
    for (const id of [sourceAsset, destinationAsset]) await tx.prisma.media_assets.create({ data: { id, room_id: f.room, owner_user_id: f.author, kind: 'PHOTO', content_type: 'image/jpeg', state: 'PROCESSING', declared_bytes: 10n, reserved_bytes: 20n, expires_at: new Date(Date.now() + 60000) } });
    await tx.prisma.media_objects.create({ data: { id: objectId, asset_id: sourceAsset, attempt_id: randomUUID(), variant: 'image', object_key: `test/${objectId}`, state: 'ALLOCATED' } });
    await tx.prisma.message_publications.create({ data: { id: publicationId, room_id: f.room, source_message_id: f.source.messageId, source_version: 1n, publisher_member_id: f.ownerActor } });
    await tx.prisma.publication_media.create({ data: { id: randomUUID(), room_id: f.room, publication_id: publicationId, position: 0, source_asset_id: sourceAsset, source_object_id: objectId, destination_asset_id: destinationAsset } });
  });
  await f.block(); assert.deepEqual(await f.step(), { status: 'deferred', changed: 0 });
  assert.ok(await rootRow(f));
  assert.equal(await f.db.transactions.read(tx => tx.prisma.publication_media.count({ where: { publication_id: publicationId } })), 1);
  assert.ok(await f.db.transactions.read(tx => tx.prisma.media_objects.findUnique({ where: { id: objectId } })));
});

test('a prior row-purge proof does not bless a restored live root; replay blocks and purges it again', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const saved = await f.db.transactions.read(tx => tx.prisma.messages.findUniqueOrThrow({ where: { id: f.source.messageId } }));
  await f.block(); await f.finish();
  await f.db.transactions.write(tx => tx.prisma.messages.create({ data: saved }));
  assert.deepEqual(await f.step(), { status: 'deferred', changed: 0 });
  assert.equal((await f.replay()).status, 'blocked');
  assert.equal((await f.finish()).status, 'rows_purged'); assert.equal(await rootRow(f), null);
  assert.equal((await f.retry()).status, 'deleted');
});

test('publisher can purge an authored publication copy without deleting the independent fan source', { timeout: 15000 }, async t => {
  const f = await fixture(t), copyId = randomUUID(), publicationId = randomUUID();
  await f.db.transactions.write(async tx => {
    const source = await tx.prisma.messages.findUniqueOrThrow({ where: { id: f.source.messageId }, select: { stream_id: true } });
    await tx.prisma.messages.create({ data: { id: copyId, room_id: f.room, stream_id: source.stream_id, sender_member_id: f.ownerActor, content_owner_user_id: f.author,
      deletion_root_id: f.source.messageId, text_content: '합성 공개본', created_order: await nextOrder(tx, f.room) } });
    await tx.prisma.message_publications.create({ data: { id: publicationId, room_id: f.room, source_message_id: f.source.messageId, source_version: 1n,
      publisher_member_id: f.ownerActor, published_message_id: copyId, state: 'PUBLISHED' } });
  });
  await f.block(copyId, f.owner);
  assert.equal((await f.finish()).status, 'rows_purged');
  assert.equal(await f.db.transactions.read(tx => tx.prisma.messages.findUnique({ where: { id: copyId } })), null);
  const source = await f.db.transactions.read(tx => getMessage(tx, f.room, f.author, f.source.messageId));
  assert.equal(source.content.text, f.body.content.text);
  assert.equal((await f.retry()).status, 'committed');
  assert.equal((await f.replay()).status, 'blocked');
});

test('replay does not preserve blocked success for a conflicting restored sender', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const saved = await f.db.transactions.read(tx => tx.prisma.messages.findUniqueOrThrow({ where: { id: f.source.messageId } }));
  await f.block(); await f.finish();
  await f.db.transactions.write(tx => tx.prisma.messages.create({ data: { ...saved, sender_member_id: f.peerActor, content_owner_user_id: f.peer } }));
  assert.equal((await f.replay()).status, 'pending');
  assert.equal((await f.step()).status, 'deferred');
  const row = await f.db.transactions.read(tx => tx.prisma.messages.findUniqueOrThrow({ where: { id: f.source.messageId } }));
  assert.equal(row.deleted_at, null); assert.equal(row.sender_member_id, f.peerActor);
});

test('final root removal and durable proof both roll back when the final lease fence fails', { timeout: 15000 }, async t => {
  const f = await fixture(t); await f.block();
  for (let n = 0; n < 20; n++) {
    const pending = await f.db.transactions.read(async tx =>
      await tx.prisma.room_events.count({ where: { message_id: f.source.messageId } }) +
      await tx.prisma.jobs.count({ where: { purpose: 'PUSH', resource_id: f.source.messageId } }));
    if (!pending) break;
    assert.equal((await f.step(1)).status, 'progress');
  }
  assert.ok(await rootRow(f));
  const epoch = await f.db.transactions.read(tx => tx.prisma.rooms.findUniqueOrThrow({ where: { id: f.room }, select: { content_epoch: true } }));
  await assert.rejects(f.step(1, { ...f.lease, leaseToken: randomUUID() }), /lease_lost/);
  assert.ok(await rootRow(f));
  assert.equal(await f.db.transactions.read(tx => tx.prisma.message_purge_checkpoints.findUnique({ where: { request_id: f.receipt.intent.requestId } })), null);
  assert.deepEqual(await f.db.transactions.read(tx => tx.prisma.rooms.findUniqueOrThrow({ where: { id: f.room }, select: { content_epoch: true } })), epoch);
  assert.equal((await f.finish()).status, 'rows_purged');
});

test('matching proof cleans restored detached receipt and fanout residue before reporting rows purged', { timeout: 15000 }, async t => {
  const f = await fixture(t); await f.block(); await f.finish();
  const unrelated = randomUUID(), restoredJob = randomUUID();
  await f.db.transactions.write(async tx => {
    await tx.prisma.command_receipts.updateMany({ where: { message_id: f.source.messageId }, data: { deleted: false, payload_digest: randomBytes(32) } });
    await tx.prisma.jobs.createMany({ data: [
      { id: restoredJob, purpose: 'PUSH', room_id: null, resource_id: f.source.messageId },
      { id: unrelated, purpose: 'PUSH', room_id: null, resource_id: randomUUID() },
    ] });
  });
  assert.equal((await f.step(1)).status, 'progress');
  assert.equal((await f.step(1)).status, 'progress');
  assert.deepEqual(await f.step(1), { status: 'rows_purged', changed: 0 });
  assert.equal((await f.retry()).status, 'deleted');
  const state = await f.db.transactions.read(async tx => ({
    receipt: await tx.prisma.command_receipts.findFirstOrThrow({ where: { message_id: f.source.messageId }, select: { deleted: true, payload_digest: true } }),
    restored: await tx.prisma.jobs.findUnique({ where: { id: restoredJob } }),
    unrelated: await tx.prisma.jobs.findUnique({ where: { id: unrelated } }),
  }));
  assert.deepEqual(state.receipt, { deleted: true, payload_digest: null });
  assert.equal(state.restored, null); assert.ok(state.unrelated);
});

test('independently admitted copy and source purges converge in source-first scheduling', { timeout: 15000 }, async t => {
  const f = await fixture(t), copyId = randomUUID(), publicationId = randomUUID(), quote = await f.quote();
  await f.db.transactions.write(async tx => {
    const source = await tx.prisma.messages.findUniqueOrThrow({ where: { id: f.source.messageId }, select: { stream_id: true } });
    await tx.prisma.messages.create({ data: { id: copyId, room_id: f.room, stream_id: source.stream_id, sender_member_id: f.ownerActor, content_owner_user_id: f.author,
      deletion_root_id: f.source.messageId, text_content: '합성 중첩 요청 공개본', created_order: await nextOrder(tx, f.room) } });
    await tx.prisma.message_publications.create({ data: { id: publicationId, room_id: f.room, source_message_id: f.source.messageId, source_version: 1n,
      publisher_member_id: f.ownerActor, published_message_id: copyId, state: 'PUBLISHED' } });
  });
  await f.block(copyId, f.owner); const copyLease = f.lease, copyReceipt = f.receipt;
  await f.block(); const sourceLease = f.lease;
  assert.deepEqual(await f.step(1, sourceLease), { status: 'deferred', changed: 0 });
  assert.ok(await f.db.transactions.read(tx => tx.prisma.messages.findUnique({ where: { id: copyId } })));
  assert.equal((await f.finish(1, copyLease)).status, 'rows_purged');
  assert.equal((await f.finish(1, sourceLease)).status, 'rows_purged');
  assert.equal((await f.step(1, copyLease)).status, 'rows_purged');
  assert.equal((await f.replay(copyReceipt)).status, 'blocked');
  assert.equal((await f.replay()).status, 'blocked');
  const independent = await f.db.transactions.read(tx => getMessage(tx, f.room, f.peer, quote.messageId));
  assert.equal(independent.content.text, '독립 본문 유지');
  assert.equal(await f.db.transactions.read(tx => tx.prisma.command_receipts.count({ where: { message_id: quote.messageId, deleted: false } })), 1);
  assert.equal((await f.retry()).status, 'deleted');
});
