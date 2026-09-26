import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { createUser, createRoom, joinRoom, nextOrder } from '../support/domain-fixture.mjs';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { AuthService } from '../../dist/modules/auth/auth.service.js';
import { NotificationsRepository } from '../../dist/modules/notifications/notifications.repository.js';
import { NotificationsCoreService } from '../../dist/modules/notifications/notifications-core.service.js';
import { NotificationsService } from '../../dist/modules/notifications/notifications.service.js';

const subscription = () => { const key = createECDH('prime256v1'); key.generateKeys(); return { endpoint: `https://fcm.googleapis.com/send/${randomUUID()}`, keys: { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }; };
async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api')); t.after(() => db.close());
  const config = { audience: 'rogi-test', key: randomBytes(32) };
  const sessionRepository = new SessionRepository(); const sessions = new SessionService(sessionRepository, config.audience, config.key);
  const auth = new AuthService(sessions, null, db.transactions, sessionRepository, config);
  const core = new NotificationsCoreService(new NotificationsRepository());
  // Only provider availability/DNS are isolated; session/auth, core and MySQL are real.
  const service = new NotificationsService(db.transactions, auth, config, core, { assertAvailable() {} }, { async validate() {} });
  const user = () => db.transactions.write(async tx => {
    const id = await createUser(tx, '알림 합성 계정');
    await tx.prisma.platform_soop.create({ data: { id: randomUUID(), user_id: id, provider_subject: new Uint8Array(Buffer.from(randomUUID())), verified_at: await tx.now() }, select: { id: true } });
    return { id, ...await sessions.issue(tx, id) };
  });
  const a = await user(), b = await user();
  const a2 = { id: a.id, ...await db.transactions.write(tx => sessions.issue(tx, a.id)) };
  const admit = id => db.transactions.write(tx => core.authorizeSubscription(tx, id));
  const setPreferences = async (person, value) => service.setPreferences(person, { ...value, expectedGeneration: value.expectedGeneration ?? (await service.preferences(person)).generation });
  const actor = person => db.transactions.read(tx => auth.require(tx, person));
  return { db, config, sessionRepository, sessions, auth, core, service, a, b, a2, admit, actor, setPreferences };
}

test('preferences persist opt-out defaults and monotonic disable/re-enable fences without reviving an old intent', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.service.preferences(f.a), { pushEnabled: false, generation: '1' });
  assert.deepEqual(await f.service.preferences(f.b), { pushEnabled: false, generation: '1' });
  assert.deepEqual(await f.setPreferences(f.a, { pushEnabled: false }), { pushEnabled: false, generation: '1' });
  const registered = await f.service.register(f.a, subscription());
  assert.equal(await f.admit(registered.id), null);
  assert.deepEqual(await f.setPreferences(f.a, { pushEnabled: true }), { pushEnabled: true, generation: '2' });
  const old = await f.admit(registered.id); assert.equal(old.preferenceGeneration, 2n);
  const unchangedAt = await f.db.transactions.read(tx => tx.prisma.notification_preferences.findUnique({ where: { user_id: f.a.id }, select: { updated_at: true } }));
  assert.deepEqual(await f.setPreferences(f.a2, { pushEnabled: true }), { pushEnabled: true, generation: '2' });
  assert.deepEqual(await f.db.transactions.read(tx => tx.prisma.notification_preferences.findUnique({ where: { user_id: f.a.id }, select: { updated_at: true } })), unchangedAt);
  await f.setPreferences(f.a, { pushEnabled: false }); assert.equal(await f.admit(registered.id), null);
  const enabled = await f.setPreferences(f.a, { pushEnabled: true }); assert.equal(enabled.generation, '4');
  const current = await f.admit(registered.id); assert.notEqual(current.preferenceGeneration, old.preferenceGeneration);
  const fresh = new NotificationsCoreService(new NotificationsRepository());
  assert.deepEqual(await f.db.transactions.read(tx => fresh.preferences(tx, f.a.id)), enabled);
});

test('session-bound ownership, cross-account secrecy and registration/removal CAS prevent ABA', async t => {
  const f = await fixture(t); const input = subscription();
  const initial = await f.service.register(f.a, input);
  assert.deepEqual(Object.keys(initial).sort(), ['generation', 'id']);
  assert.deepEqual(await f.service.register(f.a, input), initial);
  await assert.rejects(f.service.register(f.a, { ...input, keys: subscription().keys }), { code: 'CONFLICT' });
  await assert.rejects(f.service.register(f.b, { ...input, generation: initial.generation }), { code: 'NOT_FOUND' });
  await assert.rejects(f.service.remove(f.b, initial.id, { generation: initial.generation }), { code: 'NOT_FOUND' });
  await assert.rejects(f.service.remove(f.a2, initial.id, { generation: initial.generation }), { code: 'NOT_FOUND' });
  const rotated = await f.service.register(f.a2, { ...input, generation: initial.generation });
  assert.equal(rotated.id, initial.id); assert.equal(rotated.generation, '2');
  await assert.rejects(f.service.remove(f.a, rotated.id, { generation: rotated.generation }), { code: 'NOT_FOUND' });
  await assert.rejects(f.service.remove(f.a2, rotated.id, { generation: initial.generation }), { code: 'CONFLICT' });
  assert.equal(await f.db.transactions.write(tx => f.core.invalidateSubscription(tx, initial.id, 1n)), 0);
  await f.service.remove(f.a2, rotated.id, { generation: rotated.generation });
  await f.service.remove(f.a2, rotated.id, { generation: rotated.generation });
  await assert.rejects(f.service.register(f.a2, input), { code: 'CONFLICT' });
  await assert.rejects(f.service.register(f.a2, { ...input, generation: rotated.generation }), { code: 'CONFLICT' });
  const renewed = await f.service.register(f.a2, { ...input, generation: '3' });
  assert.equal(renewed.generation, '4');
  await assert.rejects(f.service.remove(f.a2, rotated.id, { generation: rotated.generation }), { code: 'CONFLICT' });
  await assert.rejects(f.service.register(f.b, { ...input, generation: '4' }), { code: 'NOT_FOUND' });
  const wire = JSON.stringify([initial, rotated, renewed, await f.service.preferences(f.a)]);
  for (const secret of [input.endpoint, input.keys.auth, input.keys.p256dh, f.a.id, f.a.token]) assert.ok(!wire.includes(secret));
});

test('remote logout revokes the selected session and its push token in one commit', async t => {
  const f = await fixture(t);
  const registered = await f.service.register(f.a2, subscription());
  await f.setPreferences(f.a, { pushEnabled: true });
  assert.ok(await f.admit(registered.id));
  const target = await f.actor(f.a2);
  await f.auth.revokeSession(f.a, target.sessionId);
  assert.equal(await f.admit(registered.id), null);
  const row = await f.db.transactions.read(tx => tx.prisma.push_subscriptions.findUnique({ where: { id: registered.id }, select: { revoked_at: true } }));
  assert.ok(row.revoked_at);
  await assert.rejects(f.actor(f.a2), { code: 'UNAUTHENTICATED' });
  assert.equal((await f.actor(f.a)).userId, f.a.id);
});

test('concurrent registration and stale removal serialize on real MySQL with exactly one CAS winner', async t => {
  const f = await fixture(t); const input = subscription(); const first = await f.service.register(f.a, input);
  const attempts = await Promise.allSettled([f.a, f.a2].map(person => f.service.register(person, { ...input, generation: first.generation })));
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(result => result.status === 'rejected').reason.code, 'CONFLICT');
  const winningPerson = attempts[0].status === 'fulfilled' ? f.a : f.a2;
  const race = await Promise.allSettled([
    f.service.register(winningPerson, { ...input, generation: '2' }),
    f.service.remove(winningPerson, first.id, { generation: '2' }),
  ]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(race.find(result => result.status === 'rejected').reason.code, 'CONFLICT');
});

test('logout, expired sessions, platform revocation and account generation fence admission and protected writes', async t => {
  const f = await fixture(t); const input = subscription(); const registered = await f.service.register(f.a, input);
  await f.setPreferences(f.a, { pushEnabled: true }); const actor = await f.actor(f.a);
  await f.db.transactions.write(tx => tx.prisma.users.update({ where: { id: f.a.id }, data: { membership_generation: { increment: 1n } }, select: { id: true } }));
  assert.equal(await f.admit(registered.id), null);
  const renewed = await f.service.register(f.a, { ...input, generation: registered.generation }); assert.ok(await f.admit(renewed.id));
  await f.db.transactions.write(tx => tx.prisma.platform_soop.updateMany({ where: { user_id: f.a.id }, data: { status: 'REVOKED' } }));
  assert.equal(await f.admit(renewed.id), null);
  await f.db.transactions.write(tx => tx.prisma.platform_soop.updateMany({ where: { user_id: f.a.id }, data: { status: 'VERIFIED' } }));
  await f.db.transactions.write(tx => tx.prisma.auth_sessions.update({ where: { id: actor.sessionId }, data: { expires_at: new Date(0) }, select: { id: true } }));
  assert.equal(await f.admit(renewed.id), null);
  await assert.rejects(f.setPreferences(f.a, { pushEnabled: false }), { code: 'UNAUTHENTICATED' });
  const a2actor = await f.actor(f.a2);
  const rebound = await f.service.register(f.a2, { ...input, generation: renewed.generation });
  await f.db.transactions.write(async tx => { await f.auth.require(tx, f.a2); await f.sessionRepository.revoke(tx, a2actor.sessionId); await f.core.revokeSession(tx, a2actor.sessionId); });
  assert.equal(await f.admit(rebound.id), null);
  await assert.rejects(f.service.register(f.a2, { ...input, generation: rebound.generation }), { code: 'UNAUTHENTICATED' });
  await f.db.transactions.write(tx => tx.prisma.users.update({ where: { id: f.b.id }, data: { status: 'DELETING' }, select: { id: true } }));
  await assert.rejects(f.service.preferences(f.b), { code: 'UNAUTHENTICATED' });
});

test('logout racing registration cannot leave an authorized binding after revocation commits', async t => {
  const f = await fixture(t); const input = subscription(); const actor = await f.actor(f.a);
  const results = await Promise.allSettled([
    f.service.register(f.a, input),
    f.db.transactions.write(async tx => { await f.auth.require(tx, f.a); await f.sessionRepository.revoke(tx, actor.sessionId); await f.core.revokeSession(tx, actor.sessionId); }),
  ]);
  assert.equal(results[1].status, 'fulfilled');
  if (results[0].status === 'fulfilled') assert.equal(await f.admit(results[0].value.id), null);
  else assert.equal(results[0].reason.code, 'UNAUTHENTICATED');
});

// Owned content can have notifications addressed to a different account. Purge
// must remove both, including fanout jobs created before any delivery exists.
test('bounded restartable account purge removes fanout and all job states before content/root deliveries and subscriptions', async t => {
  const f = await fixture(t); const own = await f.service.register(f.a, subscription()); const other = await f.service.register(f.b, subscription());
  await f.setPreferences(f.a, { pushEnabled: false });
  const ids = await f.db.transactions.write(async tx => {
    const room = await createRoom(tx, '알림 정리 합성방', 'GROUP'); const member = await joinRoom(tx, room, f.a.id);
    const [stream] = await tx.rows("SELECT id FROM message_streams WHERE room_id=? AND kind='ROOM_SHARED'", [room]);
    const root = randomUUID(), publication = randomUUID();
    for (const [id, owner, source] of [[root, f.a.id, null], [publication, f.b.id, root]]) await tx.prisma.messages.create({ data: { id, room_id: room, stream_id: stream.id, sender_member_id: member, content_owner_user_id: owner, deletion_root_id: source, created_order: await nextOrder(tx, room) }, select: { id: true } });
    const deliveryIds = [];
    for (const [sub, message] of [[own.id, root], [other.id, publication]]) {
      const id = randomUUID(); deliveryIds.push(id);
      await tx.prisma.push_deliveries.create({ data: { id, subscription_id: sub, room_id: room, message_id: message, subscription_generation: 1n, account_generation: 1n, preference_generation: 1n }, select: { id: true } });
      for (const state of ['PENDING', 'RUNNING', 'FAILED', 'COMPLETED']) await tx.prisma.jobs.create({ data: { id: randomUUID(), purpose: 'PUSH', room_id: room, resource_id: id, state }, select: { id: true } });
    }
    await tx.prisma.jobs.create({ data: { id: randomUUID(), purpose: 'PUSH', resource_id: publication }, select: { id: true } });
    await tx.prisma.users.update({ where: { id: f.a.id }, data: { status: 'DELETING' }, select: { id: true } });
    return { deliveryIds, publication };
  });
  let done = false; let count = 0;
  for (; count < 30 && !done; count++) { const progress = await f.db.transactions.write(tx => f.core.purgeAccount(tx, f.a.id, 1)); assert.ok(progress.deleted <= 1); done = progress.done; }
  assert.equal(done, true); assert.ok(count > 8);
  await f.db.transactions.read(async tx => {
    assert.equal(await tx.prisma.push_deliveries.count({ where: { id: { in: ids.deliveryIds } } }), 0);
    assert.equal(await tx.prisma.jobs.count({ where: { purpose: 'PUSH', resource_id: { in: [...ids.deliveryIds, ids.publication] } } }), 0);
    assert.equal(await tx.prisma.push_subscriptions.count({ where: { id: own.id } }), 0);
    assert.equal(await tx.prisma.push_subscriptions.count({ where: { id: other.id } }), 1);
    assert.equal(await tx.prisma.notification_preferences.count({ where: { user_id: f.a.id } }), 0);
  });
});

test('preference CAS rejects delayed enable after newer opt-out and same-generation races have one winner', async t => {
  const f = await fixture(t);
  const enabled = await f.service.setPreferences(f.a, { pushEnabled: true, expectedGeneration: '1' });
  const disabled = await f.service.setPreferences(f.a2, { pushEnabled: false, expectedGeneration: enabled.generation });
  await assert.rejects(f.service.setPreferences(f.a, { pushEnabled: true, expectedGeneration: enabled.generation }), { code: 'CONFLICT' });
  assert.deepEqual(await f.service.preferences(f.a), disabled);
  const race = await Promise.allSettled([f.a, f.a2].map(person => f.service.setPreferences(person, { pushEnabled: true, expectedGeneration: disabled.generation })));
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(race.find(result => result.status === 'rejected').reason.code, 'CONFLICT');
  await assert.rejects(f.service.setPreferences({ ...f.a, csrf: randomBytes(32).toString('base64url') }, { pushEnabled: false, expectedGeneration: '4' }), { code: 'FORBIDDEN' });
});

test('preference/subscription writes roll back atomically with same-transaction authorization', async t => {
  const f = await fixture(t); const input = subscription();
  await assert.rejects(f.db.transactions.write(async tx => {
    const actor = await f.auth.require(tx, f.a);
    await f.core.setPreferences(tx, actor.userId, true, '1');
    await f.core.register(tx, actor, f.config.audience, input);
    throw new Error('notifications-rollback');
  }), /notifications-rollback/);
  assert.deepEqual(await f.service.preferences(f.a), { pushEnabled: false, generation: '1' });
  const registered = await f.service.register(f.a, input);
  assert.equal(registered.generation, '1');
  const otherSession = await f.service.register(f.a2, { ...input, generation: '1' });
  await assert.rejects(f.service.register(f.a, input), { code: 'CONFLICT' });
  assert.deepEqual(await f.service.register(f.a2, input), otherSession);
});
