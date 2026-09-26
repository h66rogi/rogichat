import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { DatabaseModule } from '../../dist/infrastructure/database/database.module.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { LifecycleState } from '../../dist/common/lifecycle/lifecycle-state.js';
import { SafeLogger } from '../../dist/infrastructure/observability/logging.js';
import { createApi } from '../../dist/application.js';
import { AccountCleanupModule } from '../../dist/modules/deletion/account-cleanup.module.js';
import { AccountCleanupService } from '../../dist/modules/deletion/account-cleanup.service.js';
import { AccountCleanupRepository } from '../../dist/modules/deletion/account-cleanup.repository.js';
import { DeletionModule } from '../../dist/modules/deletion/deletion.module.js';
import { DeletionApplyService } from '../../dist/modules/deletion/deletion-apply.service.js';
import { accountDeletionId } from '../../dist/modules/deletion/deletion-ledger.js';
import { IdentityGuardService } from '../../dist/modules/auth/identity-guard.service.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { deletionFixture } from '../support/deletion-fixture.mjs';
import { createUser, createRoom, joinRoom, assignRoomOwner, authorizedMediaObject, getMessage, sendMessage, sendInput } from '../support/domain-fixture.mjs';

const key = randomBytes(32); // Shared only across this isolated test file.
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(t, elapsedAuthGrace = true) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api'));
  const { ledger, store } = deletionFixture();
  const infrastructure = DatabaseModule.register({ database: db, lifecycle: new LifecycleState(), externallyOwned: true });
  let context;
  const restart = async () => {
    if (context) await context.close();
    context = await NestFactory.createApplicationContext({ module: class CleanupFixture {}, imports: [
      AccountCleanupModule.register(infrastructure, { ledger }), DeletionModule.register(infrastructure, { ledger }),
    ] }, { logger: false, abortOnError: false });
  };
  await restart();
  const userId = randomUUID(), otherId = randomUUID(), identityId = randomUUID(), subject = Buffer.from(randomUUID());
  const config = { key: randomBytes(32), identityGuardKey: key, audience: 'rogi-qa', secure: false,
    origin: 'http://localhost:3001', callback: 'http://127.0.0.1:3000/v1/auth/soop/callback' };
  const sessions = new SessionService(new SessionRepository(), config.audience, config.key);
  const people = await db.transactions.write(async tx => {
    for (const id of [userId, otherId]) {
      await tx.prisma.users.create({ data: { id, profile: { create: { nickname: id === userId ? 'private cleanup name' : 'independent name',
        birthday_month: 2, birthday_day: 3, birthday_visible_to_streamers: true } } } });
      await tx.prisma.platform_soop.create({ data: { id: id === userId ? identityId : randomUUID(), user_id: id,
        provider_subject: id === userId ? subject : Buffer.from(randomUUID()), verified_at: await tx.now() } });
    }
    await tx.prisma.creator_accounts.create({ data: { user_id: userId, enabled: true } });
    await tx.prisma.admin_capabilities.create({ data: { user_id: userId, manage_rooms: true, manage_users: true, manage_stickers: true } });
    return { session: await sessions.issue(tx, userId), other: await sessions.issue(tx, otherId) };
  });
  const requestId = accountDeletionId('qa', userId);
  const intent = { schemaVersion: 2, environment: 'qa', scope: 'ACCOUNT', roomId: null, actorUserId: userId, targetId: userId,
    requestId, requestedAt: new Date((await db.transactions.read(tx => tx.now())).getTime() - (elapsedAuthGrace ? 1200000 : 0)).toISOString(),
    subjectGuard: context.get(IdentityGuardService).evidence(subject, identityId, key) };
  const admit = async () => {
    const receipt = await ledger.ensureIntent(intent);
    await context.get(DeletionApplyService).apply(receipt);
    return receipt;
  };
  const step = limit => context.get(AccountCleanupService).step(requestId, limit);
  const drain = async () => {
    const results = [];
    for (let i = 0; i < 60; i++) { const result = await step(); results.push(result); if (!result.hasMore) return results; }
    assert.fail('bounded cleanup failed to converge');
  };
  const room = () => db.transactions.write(async tx => {
    const roomId = await createRoom(tx, 'isolated cleanup room', 'GROUP');
    const memberId = await joinRoom(tx, roomId, userId), otherMemberId = await joinRoom(tx, roomId, otherId);
    await assignRoomOwner(tx, roomId, memberId);
    const stream = await tx.prisma.message_streams.findFirstOrThrow({ where: { room_id: roomId, kind: 'ROOM_SHARED' }, select: { id: true } });
    const member = await tx.prisma.room_members.findUniqueOrThrow({ where: { id: memberId }, select: { active_period_id: true } });
    return { roomId, memberId, otherMemberId, streamId: stream.id, periodId: member.active_period_id };
  });
  t.after(async () => {
    await context.close();
    await db.transactions.write(async tx => {
      await tx.prisma.account_deletion_obligations.deleteMany({ where: { user_id: userId } });
      await tx.prisma.deletion_intents.deleteMany({ where: { target_id: userId } });
      await tx.prisma.identity_subject_guards.deleteMany({ where: { user_id: userId } });
      await tx.prisma.identity_guard_keys.deleteMany({ where: { version: 1 } });
    });
    await db.close();
  });
  return { db, ledger, store, intent, requestId, userId, otherId, identityId, config, ...people, admit, step, drain, restart, room };
}

test('cleanup requires immutable external evidence, matching admitted checkpoint/obligation and current blocked account', async t => {
  const f = await fixture(t);
  await assert.rejects(f.step());
  const receipt = await f.ledger.ensureIntent(f.intent);
  await assert.rejects(f.step(), /not_admitted/);
  await f.admit();
  f.store.fail = true; await assert.rejects(f.step()); f.store.fail = false;
  for (const [table, where, data, restore, reason] of [
    ['users', { id: f.userId }, { status: 'ACTIVE' }, { status: 'DELETING' }, /not_blocked/],
    ['deletion_intents', { request_id: f.requestId }, { ledger_sha256: randomBytes(32) }, { ledger_sha256: Buffer.from(receipt.sha256, 'hex') }, /not_admitted/],
    ['account_deletion_obligations', { user_id: f.userId }, { guard_coverage: false }, { guard_coverage: true }, /obligation_unavailable/],
    ['account_deletion_obligations', { user_id: f.userId }, { state: 'LIVE_PURGED' }, { state: 'BLOCKED' }, /obligation_unavailable/],
  ]) {
    await f.db.transactions.write(tx => tx.prisma[table].update({ where, data }));
    await assert.rejects(f.step(), reason);
    await f.db.transactions.write(tx => tx.prisma[table].update({ where, data: restore }));
  }
  assert.equal(await f.db.transactions.read(tx => tx.prisma.creator_accounts.count({ where: { user_id: f.userId } })), 1);
  await assert.rejects(f.step(101), /invalid_account_cleanup_limit/);
});

test('first remaining pages drain over 100 reactions/grants/read states/periods and skip retained members after restart', async t => {
  const f = await fixture(t); const r = await f.room(); const later = await f.room();
  const messages = Array.from({ length: 101 }, () => randomUUID());
  const streams = Array.from({ length: 101 }, () => randomUUID());
  await f.db.transactions.write(async tx => {
    await tx.prisma.message_streams.createMany({ data: streams.map(id => ({ id, room_id: r.roomId, kind: 'RESTRICTED' })) });
    await tx.prisma.messages.createMany({ data: messages.map((id, i) => ({ id, room_id: r.roomId, stream_id: r.streamId,
      sender_member_id: r.otherMemberId, content_owner_user_id: f.otherId, text_content: 'independent content', created_order: BigInt(i + 10) })) });
    await tx.prisma.message_reactions.createMany({ data: messages.map(message_id => ({ id: randomUUID(), room_id: r.roomId, message_id, member_id: r.memberId, emoji: '👍' })) });
    await tx.prisma.message_reactions.create({ data: { id: randomUUID(), room_id: r.roomId, message_id: messages[0], member_id: r.otherMemberId, emoji: '👍' } });
    await tx.prisma.stream_grants.createMany({ data: streams.map(stream_id => ({ id: randomUUID(), room_id: r.roomId, stream_id, member_id: r.memberId, can_read: true, can_send: true })) });
    await tx.prisma.own_read_states.createMany({ data: streams.map(stream_id => ({ room_id: r.roomId, stream_id, member_id: r.memberId, period_id: r.periodId, last_read_order: 10n })) });
    await tx.prisma.membership_periods.createMany({ data: Array.from({ length: 100 }, () => ({ id: randomUUID(), room_id: r.roomId, member_id: r.memberId,
      policy_version: 1, history_policy: 'SINCE_JOIN', visible_from_order: 0n, left_at: new Date() })) });
  });
  await f.admit();
  assert.equal((await f.step()).phase, 'private-fields');
  assert.deepEqual(await f.step(), { phase: 'read-state', changed: 100, hasMore: true });
  assert.equal(await f.db.transactions.read(tx => tx.prisma.membership_periods.count({ where: { member_id: r.memberId } })), 101);
  await f.restart();
  assert.deepEqual(await f.step(), { phase: 'read-state', changed: 1, hasMore: true });
  const results = await f.drain();
  for (const phase of ['reactions', 'grants', 'periods']) assert.ok(results.some(result => result.phase === phase && result.changed === 100));
  assert.ok(results.every(result => result.changed <= 100));
  await f.db.transactions.read(async tx => {
    for (const member of [r, later]) {
      const row = await tx.prisma.room_members.findUniqueOrThrow({ where: { id: member.memberId } });
      assert.equal(row.status, 'LEFT'); assert.equal(row.active_period_id, null);
      assert.equal((await tx.prisma.rooms.findUniqueOrThrow({ where: { id: member.roomId } })).owner_member_id, member.memberId);
    }
    assert.equal(await tx.prisma.message_reactions.count({ where: { member_id: r.memberId } }), 0);
    assert.equal(await tx.prisma.message_reactions.count({ where: { member_id: r.otherMemberId } }), 1);
    assert.equal(await tx.prisma.messages.count({ where: { id: { in: messages }, text_content: 'independent content' } }), 0);
    assert.equal((await tx.prisma.room_members.findUniqueOrThrow({ where: { id: r.otherMemberId } })).status, 'LEFT');
    assert.equal((await tx.prisma.rooms.findUniqueOrThrow({ where: { id: r.roomId } })).status, 'CLOSED');
  });
  await f.restart(); assert.deepEqual(await f.step(), { phase: 'subset-drained', changed: 0, hasMore: false });
});

test('retained avatar/identity/sticker evidence never becomes a scrubbed profile success and replay coverage is unchanged', async t => {
  const f = await fixture(t); const r = await f.room(); const avatar = randomUUID(), asset = randomUUID(), sticker = randomUUID();
  await f.db.transactions.write(async tx => {
    for (const [id, kind] of [[avatar, 'AVATAR'], [asset, 'STICKER']]) await tx.prisma.media_assets.create({ data: {
      id, owner_user_id: f.userId, kind, content_type: 'image/png', state: 'READY', declared_bytes: 8n, reserved_bytes: 8n, expires_at: new Date(Date.now() + 86400000),
    } });
    await tx.prisma.user_profiles.update({ where: { user_id: f.userId }, data: { avatar_asset_id: avatar } });
    await tx.prisma.sticker_catalog.create({ data: { id: sticker, asset_id: asset, status: 'APPROVED', label: 'service owned fixture',
      registered_by_user_id: f.userId, approved_by_user_id: f.otherId, approved_at: await tx.now() } });
  });
  await f.admit();
  const before = await f.db.transactions.read(tx => tx.prisma.account_deletion_obligations.findUniqueOrThrow({ where: { user_id: f.userId } }));
  assert.equal((await f.step()).phase, 'private-fields');
  // Membership and auth session rows deliberately still exist: the account status
  // fence itself must prevent a successful scrubbed/retained profile response.
  assert.equal(await f.db.transactions.read(tx => tx.prisma.auth_sessions.count({ where: { user_id: f.userId } })), 1);
  assert.equal((await f.db.transactions.read(tx => tx.prisma.room_members.findUniqueOrThrow({ where: { id: r.memberId } }))).status, 'ACTIVE');
  await f.admit(); // Same original identity UUID must still establish coverage on replay.
  const after = await f.db.transactions.read(tx => tx.prisma.account_deletion_obligations.findUniqueOrThrow({ where: { user_id: f.userId } }));
  assert.deepEqual(after, before); assert.equal(after.state, 'BLOCKED'); assert.equal(after.live_purged_at, null);
  await f.db.transactions.read(async tx => {
    const profile = await tx.prisma.user_profiles.findUniqueOrThrow({ where: { user_id: f.userId } });
    assert.equal(profile.nickname, ''); assert.equal(profile.birthday_month, null); assert.equal(profile.birthday_day, null);
    assert.equal(profile.birthday_visible_to_streamers, false); assert.equal(profile.avatar_asset_id, avatar);
    assert.equal(await tx.prisma.media_assets.count({ where: { id: { in: [avatar, asset] } } }), 2);
    assert.equal((await tx.prisma.sticker_catalog.findUniqueOrThrow({ where: { id: sticker } })).status, 'APPROVED');
    assert.equal((await tx.prisma.platform_soop.findUniqueOrThrow({ where: { user_id: f.userId } })).id, f.identityId);
    assert.equal(await tx.prisma.creator_accounts.count({ where: { user_id: f.userId } }), 0);
    assert.equal(await tx.prisma.admin_capabilities.count({ where: { user_id: f.userId } }), 0);
  });
  const app = await createApi(f.db, new SafeLogger('api', () => {}), undefined, { config: f.config });
  await app.listen(0, '127.0.0.1');
  try {
    for (const [path, token, status] of [
      ['/v1/me/profile', f.session.token, 401],
      [`/v1/rooms/${r.roomId}/actors/${r.memberId}/profile`, f.other.token, 404],
    ]) {
      const response = await fetch(`${await app.getUrl()}${path}`, { headers: { Cookie: `rogi_session=${token}` } });
      assert.equal(response.status, status); const body = await response.json();
      assert.deepEqual(Object.keys(body), ['error']); assert.ok(!JSON.stringify(body).includes(avatar));
    }
  } finally { await app.close(); }
  await assert.rejects(f.db.transactions.read(tx => authorizedMediaObject(tx, f.otherId, avatar,
    { roomId: r.roomId, actorId: r.memberId, variant: 'image' })), error => error.getStatus?.() === 404);
  await f.drain();
});

test('owner account cleanup removes room push work before bounded session deletion', async t => {
  const f = await fixture(t); const r = await f.room(); const message = randomUUID(), delivery = randomUUID(), job = randomUUID(), otherJob = randomUUID();
  const subscriptions = Array.from({ length: 101 }, () => randomUUID());
  await f.db.transactions.write(async tx => {
    const session = await tx.prisma.auth_sessions.findFirstOrThrow({ where: { user_id: f.userId }, select: { id: true } });
    await tx.prisma.auth_sessions.createMany({ data: Array.from({ length: 100 }, () => ({ id: randomUUID(), user_id: f.userId,
      token_digest: randomBytes(32), csrf_digest: randomBytes(32), audience: f.config.audience, expires_at: new Date(Date.now() + 86400000) })) });
    await tx.prisma.push_subscriptions.createMany({ data: subscriptions.map(id => ({ id, user_id: f.userId, session_id: session.id,
      audience: f.config.audience, endpoint: `https://push.example.invalid/${id}`, endpoint_digest: randomBytes(32),
      p256dh: 'isolated-key', auth_secret: 'isolated-auth', account_generation: 0n })) });
    await tx.prisma.messages.create({ data: { id: message, room_id: r.roomId, stream_id: r.streamId, sender_member_id: r.otherMemberId,
      content_owner_user_id: f.otherId, created_order: 10n, text_content: 'unrelated author survives' } });
    await tx.prisma.push_deliveries.create({ data: { id: delivery, subscription_id: subscriptions[0], room_id: r.roomId, message_id: message,
      subscription_generation: 1n, account_generation: 0n, preference_generation: 1n } });
    await tx.prisma.jobs.createMany({ data: [
      { id: job, purpose: 'PUSH', room_id: r.roomId, resource_id: delivery },
      { id: otherJob, purpose: 'PUSH', room_id: null, resource_id: message },
    ] });
  });
  await f.admit();
  const results = [];
  for (let i = 0; i < 30; i++) {
    const result = await f.step(); results.push(result);
    if (result.phase === 'sessions') {
      assert.equal(await f.db.transactions.read(tx => tx.prisma.push_subscriptions.count({ where: { user_id: f.userId } })), 0);
    } else if (!results.some(row => row.phase === 'sessions')) {
      assert.equal(await f.db.transactions.read(tx => tx.prisma.auth_sessions.count({ where: { user_id: f.userId } })), 101);
    }
    if (!result.hasMore) break;
  }
  assert.equal(results.at(-1).phase, 'subset-drained');
  assert.deepEqual(results.filter(row => row.phase === 'sessions').map(row => row.changed), [100, 1]);
  await f.db.transactions.read(async tx => {
    assert.equal(await tx.prisma.jobs.count({ where: { id: job } }), 0);
    assert.equal(await tx.prisma.jobs.count({ where: { id: otherJob } }), 0);
    assert.equal(await tx.prisma.messages.count({ where: { id: message } }), 1);
    assert.equal(await tx.prisma.messages.count({ where: { id: message, text_content: { not: null } } }), 0);
    assert.equal(await tx.prisma.auth_sessions.count({ where: { user_id: f.otherId } }), 1);
  });
});

test('two connections: a prior RR snapshot cannot authorize cleanup after the account returns to ACTIVE', async t => {
  const f = await fixture(t); const receipt = await f.admit(); const started = deferred(), resume = deferred();
  const pending = f.db.transactions.write(async tx => {
    assert.equal((await tx.prisma.users.findUniqueOrThrow({ where: { id: f.userId } })).status, 'DELETING');
    started.resolve(); await resume.promise;
    await new AccountCleanupRepository().authorize(tx, receipt);
  });
  const rejected = assert.rejects(pending, /not_blocked/);
  await started.promise;
  await f.db.transactions.write(tx => tx.prisma.users.update({ where: { id: f.userId }, data: { status: 'ACTIVE' } }));
  resume.resolve(); await rejected;
  assert.equal(await f.db.transactions.read(tx => tx.prisma.creator_accounts.count({ where: { user_id: f.userId } })), 1);
});

test('retained private pairs are history, not authoritative counterpart hints or permission to send', async t => {
  const f = await fixture(t); const r = await f.room(); const stream = randomUUID(), message = randomUUID();
  await f.db.transactions.write(async tx => {
    await assignRoomOwner(tx, r.roomId, r.otherMemberId);
    await tx.prisma.message_streams.create({ data: { id: stream, room_id: r.roomId, kind: 'RESTRICTED' } });
    const [left, right] = [r.memberId, r.otherMemberId].sort();
    await tx.prisma.stream_pairs.create({ data: { id: randomUUID(), room_id: r.roomId, stream_id: stream, left_member_id: left, right_member_id: right } });
    await tx.prisma.stream_grants.createMany({ data: [left, right].map(member_id => ({ id: randomUUID(), room_id: r.roomId,
      stream_id: stream, member_id, can_read: true, can_send: true })) });
    await tx.prisma.messages.create({ data: { id: message, room_id: r.roomId, stream_id: stream, sender_member_id: r.otherMemberId,
      content_owner_user_id: f.otherId, text_content: 'other author private history', created_order: 10n } });
  });
  const project = () => f.db.transactions.read(tx => getMessage(tx, r.roomId, f.otherId, message));
  assert.deepEqual((await project()).counterpart, { actorId: r.memberId });
  await f.admit(); await f.drain();
  const projected = await project(); assert.equal(projected.counterpart, null); assert.equal(projected.allowedActions.reply, false);
  assert.equal(projected.content.text, 'other author private history');
  await assert.rejects(f.db.transactions.write(tx => sendMessage(tx, r.roomId, f.otherId,
    sendInput({ clientMessageId: randomUUID(), intent: 'PRIVATE', recipientActorId: r.memberId, content: { type: 'TEXT', text: 'stale hint attempt' } }), f.config.key)),
  error => error.getStatus?.() === 404);
});

test('owner account cleanup closes the room and revokes other participants before later bounded cleanup', async t => {
  const f = await fixture(t); const r = await f.room();
  // Keep two unchanged visible profiles after admission, so reaction cleanup
  // isolates the epoch binding from profile-content/generation changes.
  await f.db.transactions.write(async tx => {
    const third = await createUser(tx, 'independent profile');
    await tx.prisma.platform_soop.create({ data: { id: randomUUID(), user_id: third,
      provider_subject: Buffer.from(randomUUID()), verified_at: await tx.now() } });
    await joinRoom(tx, r.roomId, third);
  });
  const messages = [];
  for (let i = 0; i < 2; i++) messages.push(await f.db.transactions.write(tx => sendMessage(tx, r.roomId, f.otherId,
    sendInput({ clientMessageId: randomUUID(), intent: 'SHARED', content: { type: 'TEXT', text: 'independent surviving body' } }), f.config.key)));
  await f.db.transactions.write(tx => tx.prisma.message_reactions.create({ data: { id: randomUUID(), room_id: r.roomId,
    message_id: messages[1].messageId, member_id: r.memberId, emoji: '👍' } }));
  const app = await createApi(f.db, new SafeLogger('api', () => {}), undefined, { config: f.config });
  await app.listen(0, '127.0.0.1');
  try {
    const query = { deviceId: randomUUID(), cacheId: randomUUID(), limit: '1' };
    const sync = async (path, cursor) => {
      const params = new globalThis.URLSearchParams({ ...query, ...(cursor ? { cursor } : {}) });
      const response = await fetch(`${await app.getUrl()}/v1/rooms/${r.roomId}/${path}?${params}`, {
        headers: { Cookie: `rogi_session=${f.other.token}` },
      });
      assert.equal(response.status, 200); return response.json();
    };
    const epoch = () => f.db.transactions.read(async tx => (await tx.prisma.rooms.findUniqueOrThrow({
      where: { id: r.roomId }, select: { content_epoch: true },
    })).content_epoch);
    const before = await epoch(), snapshot = await sync('snapshot'), profiles = await sync('profile-sync');
    assert.ok(snapshot.historyCursor); assert.ok(profiles.nextCursor);
    const receipt = await f.admit();
    assert.equal((await f.step()).phase, 'private-fields');
    assert.equal(await epoch(), before); // Admission is not a synchronous all-room cache purge.
    await assert.rejects(f.db.transactions.write(async tx => {
      const repository = new AccountCleanupRepository();
      await repository.authorize(tx, receipt);
      await repository.memberPage(tx, f.userId, 100);
      throw new Error('isolated_rollback');
    }), /isolated_rollback/);
    assert.equal(await epoch(), before);
    assert.equal((await f.db.transactions.read(tx => tx.prisma.room_members.findUniqueOrThrow({ where: { id: r.memberId } }))).status, 'ACTIVE');
    assert.equal((await f.step()).phase, 'membership');
    assert.equal(await epoch(), before + 1n);
    for (const [path, cursor] of [['events', snapshot.nextCursor], ['history', snapshot.historyCursor], ['profile-sync', profiles.nextCursor], ['snapshot', null]]) {
      const params = new globalThis.URLSearchParams({ deviceId: randomUUID(), cacheId: randomUUID(), limit: '1', ...(cursor ? { cursor } : {}) });
      const response = await fetch(`${await app.getUrl()}/v1/rooms/${r.roomId}/${path}?${params}`,
        { headers: { Cookie: `rogi_session=${f.other.token}` } });
      assert.equal(response.status, 404);
    }
    assert.equal((await f.step()).phase, 'reactions');
    assert.equal(await epoch(), before + 2n);
    await f.drain();
    const drained = await epoch();
    assert.deepEqual(await f.step(), { phase: 'subset-drained', changed: 0, hasMore: false });
    assert.equal(await epoch(), drained);
    assert.equal(await f.db.transactions.read(tx => tx.prisma.messages.count({ where: { id: { in: messages.map(row => row.messageId) },
      text_content: 'independent surviving body' } })), 0);
    assert.equal(await f.db.transactions.read(tx => tx.prisma.message_reactions.count({ where: { member_id: r.memberId } })), 0);
  } finally { await app.close(); }
});

test('unelapsed original auth grace allows independent private-field cleanup but prevents auth subset closure', async t => {
  const f = await fixture(t, false); await f.admit();
  assert.equal((await f.step()).phase, 'private-fields');
  let result;
  for (let i = 0; i < 20; i++) { result = await f.step(); if (result.phase === 'auth') break; }
  assert.deepEqual(result, { phase: 'auth', changed: 0, hasMore: true });
  const obligation = await f.db.transactions.read(tx => tx.prisma.account_deletion_obligations.findUniqueOrThrow({ where: { user_id: f.userId } }));
  assert.equal(obligation.requested_at.toISOString(), f.intent.requestedAt);
  assert.equal(obligation.auth_not_before.getTime(), Date.parse(f.intent.requestedAt) + 600000);
  assert.equal(obligation.live_purged_at, null);
});
