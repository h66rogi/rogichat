import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, generateKeyPairSync } from 'node:crypto';
import { createUser, createRoom, assignRoomOwner, joinRoom, sendMessage, activeMember, actorBlocked, loadMessage, readable, leaveRoom } from '../support/domain-fixture.mjs';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { AuthService } from '../../dist/modules/auth/auth.service.js';
import { NativePushRepository } from '../../dist/modules/notifications/native-push.repository.js';
import { NativePushService } from '../../dist/modules/notifications/native-push.service.js';
import { NativePushTransport } from '../../dist/modules/notifications/native-push-transport.js';
import { NotificationsRepository } from '../../dist/modules/notifications/notifications.repository.js';
import { NotificationsCoreService } from '../../dist/modules/notifications/notifications-core.service.js';
import { NotificationsService } from '../../dist/modules/notifications/notifications.service.js';
import { openNativeToken } from '../../dist/modules/notifications/native-push-contract.js';
import { PushEnqueueService } from '../../dist/modules/notifications/push-enqueue.service.js';
import { PushEnqueueRepository } from '../../dist/modules/notifications/push-enqueue.repository.js';
import { PushDeliveryService } from '../../dist/modules/notifications/push-delivery.service.js';
import { PushDeliveryRepository } from '../../dist/modules/notifications/push-delivery.repository.js';
import { NotificationFanoutService } from '../../dist/modules/notifications/notification-fanout.service.js';
import { NotificationFanoutRepository } from '../../dist/modules/notifications/notification-fanout.repository.js';
import { JobsCoreService } from '../../dist/modules/jobs/jobs-core.service.js';
import { JobsRepository } from '../../dist/modules/jobs/jobs.repository.js';

const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
const input = () => ({ provider: 'APNS', token: randomBytes(32).toString('hex'), installationId: randomUUID(), bindingSecret: randomBytes(32).toString('base64url') });
const proof = value => ({ installationId: value.installationId, bindingSecret: value.bindingSecret });
async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api')); t.after(() => db.close());
  const config = { audience: 'rogi-test', key: randomBytes(32) };
  const repository = new SessionRepository(), sessions = new SessionService(repository, config.audience, config.key);
  const auth = new AuthService(sessions, undefined, db.transactions, repository, config);
  const nativeConfig = { audience: config.audience, encryptionKey: randomBytes(32),
    apns: { teamId: 'ABCDEFGHIJ', keyId: '0123456789', key, topic: 'chat.example.tests', sandbox: true } };
  const transport = new NativePushTransport(nativeConfig); t.after(() => transport.onModuleDestroy());
  const service = new NativePushService(db.transactions, auth, config, new NativePushRepository(), transport);
  const core = new NotificationsCoreService(new NotificationsRepository());
  const preferences = new NotificationsService(db.transactions, auth, config, core, { assertAvailable() {} }, {}, transport);
  const issue = async (id, clientId = 'ios') => ({ id, transport: 'NATIVE', clientId, ...await db.transactions.write(tx => sessions.issueNative(tx, id, clientId)) });
  const user = async () => {
    const id = await db.transactions.write(async tx => {
      const id = await createUser(tx, '격리 푸시 테스트');
      await tx.prisma.platform_soop.create({ data: { id: randomUUID(), user_id: id, provider_subject: new Uint8Array(Buffer.from(randomUUID())), verified_at: await tx.now() }, select: { id: true } });
      return id;
    });
    return issue(id);
  };
  const a = await user(), b = await user(), a2 = await issue(a.id);
  const admit = id => db.transactions.write(tx => core.authorizeSubscription(tx, id));
  const enable = async person => preferences.setPreferences(person, { pushEnabled: true, expectedGeneration: (await preferences.preferences(person)).generation });
  return { db, config, nativeConfig, repository, auth, sessions, service, transport, core, preferences, a, b, a2, issue, admit, enable };
}

test('native binding persists encrypted token, opt-out defaults and minimal cold recovery receipt', async t => {
  const f = await fixture(t), value = input();
  assert.deepEqual(await f.service.capabilities(f.a), { available: true, provider: 'APNS' });
  assert.deepEqual(await f.service.resolve(f.a, proof(value)), { binding: null });
  await assert.rejects(f.enable(f.a), { code: 'CONFLICT' });
  const registered = await f.service.register(f.a, value);
  assert.deepEqual(Object.keys(registered).sort(), ['generation', 'id']);
  assert.deepEqual(await f.service.register(f.a, value), registered);
  assert.deepEqual(await f.service.resolve(f.a, proof(value)), { binding: { ...registered, revoked: false } });
  const row = await f.db.transactions.read(tx => tx.prisma.push_subscriptions.findUnique({ where: { id: registered.id } }));
  assert.equal(row.provider, 'APNS'); assert.equal(row.native_client_id, 'ios');
  assert.equal(row.endpoint, null); assert.equal(row.p256dh, null); assert.equal(row.auth_secret, null);
  assert.equal(Buffer.from(row.native_token).includes(Buffer.from(value.token)), false);
  assert.equal(openNativeToken(Buffer.from(row.native_token), f.nativeConfig.encryptionKey, `rogi-test:${registered.id}:1`), value.token);
  assert.equal(await f.admit(registered.id), null);
  await f.enable(f.a); assert.equal((await f.admit(registered.id)).provider, 'APNS');
  await f.preferences.setPreferences(f.a, { pushEnabled: false, expectedGeneration: '2' });
  await assert.rejects(f.enable(f.a2), { code: 'CONFLICT' });
  assert.deepEqual(await f.enable(f.a), { pushEnabled: true, generation: '4' });
  const wire = JSON.stringify(await f.service.resolve(f.b, proof(value)));
  for (const secret of [f.a.id, f.a.token, value.token, value.bindingSecret, value.installationId]) assert.equal(wire.includes(secret), false);
});

test('installation secret and CAS permit A→B→A, excluding stale owner and delayed DELETE', async t => {
  const f = await fixture(t), value = input(), first = await f.service.register(f.a, value);
  await assert.rejects(f.service.register(f.b, { ...value, generation: first.generation, bindingSecret: input().bindingSecret }), { code: 'NOT_FOUND' });
  await assert.rejects(f.service.resolve(f.b, { ...proof(value), bindingSecret: input().bindingSecret }), { code: 'NOT_FOUND' });
  const second = await f.service.register(f.b, { ...value, generation: first.generation });
  assert.equal(second.id, first.id); assert.equal(second.generation, '2');
  await assert.rejects(f.service.remove(f.a, first.id, { generation: '1', bindingSecret: value.bindingSecret }), { code: 'NOT_FOUND' });
  await assert.rejects(f.service.register(f.a, { ...value, generation: '1' }), { code: 'CONFLICT' });
  const recovered = await f.service.resolve(f.a2, proof(value)); assert.equal(recovered.binding.generation, '2');
  const third = await f.service.register(f.a2, { ...value, generation: recovered.binding.generation });
  assert.equal(third.generation, '3');
  await assert.rejects(f.service.remove(f.a, third.id, { generation: '3', bindingSecret: value.bindingSecret }), { code: 'NOT_FOUND' });
  await f.service.remove(f.a2, third.id, { generation: '3', bindingSecret: value.bindingSecret });
  await f.service.remove(f.a2, third.id, { generation: '3', bindingSecret: value.bindingSecret });
  assert.deepEqual(await f.service.resolve(f.a2, proof(value)), { binding: { id: third.id, generation: '4', revoked: true } });
  const row = await f.db.transactions.read(tx => tx.prisma.push_subscriptions.findUnique({ where: { id: third.id }, select: { native_token: true } }));
  assert.equal(row.native_token, null);
  const renewed = await f.service.register(f.a2, { ...value, generation: '4' }); assert.equal(renewed.generation, '5');
  await assert.rejects(f.service.remove(f.a2, third.id, { generation: '3', bindingSecret: value.bindingSecret }), { code: 'CONFLICT' });
});

test('native token cannot be stolen by another installation; token rotation requires current CAS', async t => {
  const f = await fixture(t), value = input(), first = await f.service.register(f.a, value);
  await assert.rejects(f.service.register(f.b, { ...input(), token: value.token }), { code: 'CONFLICT' });
  const rotated = { ...value, token: input().token };
  await assert.rejects(f.service.register(f.a, rotated), { code: 'CONFLICT' });
  const second = await f.service.register(f.a, { ...rotated, generation: first.generation });
  assert.equal(second.generation, '2');
  assert.equal(await f.db.transactions.write(tx => f.core.invalidateSubscription(tx, first.id, 1n)), 0);
  await assert.rejects(f.service.register(f.a, { ...value, generation: first.generation }), { code: 'CONFLICT' });
});

test('concurrent native rebind and token rotation have one CAS winner on actual MySQL', async t => {
  const f = await fixture(t), value = input(), first = await f.service.register(f.a, value);
  const results = await Promise.allSettled([f.a, f.a2].map(person => f.service.register(person, { ...value, generation: first.generation })));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.find(row => row.status === 'rejected').reason.code, 'CONFLICT');
  assert.equal((await f.service.resolve(f.a2, proof(value))).binding.generation, '2');
});

test('native enrollment enforces SOOP, account/session/client and provider availability', async t => {
  const f = await fixture(t), value = input();
  await assert.rejects(f.service.register({ ...f.a, clientId: 'android' }, value), { code: 'INVALID_REQUEST' });
  await assert.rejects(f.service.register({ token: f.a.token }, value), { code: 'INVALID_REQUEST' });
  const android = await f.issue(f.a.id, 'android');
  assert.deepEqual(await f.service.capabilities(android), { available: false, provider: 'FCM' });
  await assert.rejects(f.service.register(android, { ...value, provider: 'FCM', token: 'isolated_token_' + randomUUID() }), { code: 'AUTH_UNAVAILABLE' });
  await f.db.transactions.write(tx => tx.prisma.platform_soop.updateMany({ where: { user_id: f.a.id }, data: { status: 'REVOKED' } }));
  await assert.rejects(f.service.register(f.a, value), { code: 'SOOP_LINK_REQUIRED' });
  await assert.rejects(f.enable(f.a), { code: 'SOOP_LINK_REQUIRED' });
  await f.db.transactions.write(tx => tx.prisma.platform_soop.updateMany({ where: { user_id: f.a.id }, data: { status: 'VERIFIED' } }));
  await f.auth.logout(f.a);
  await assert.rejects(f.service.register(f.a, value), { code: 'UNAUTHENTICATED' });
  await f.db.transactions.write(tx => tx.prisma.users.update({ where: { id: f.b.id }, data: { status: 'DELETING' } }));
  await assert.rejects(f.service.register(f.b, value), { code: 'UNAUTHENTICATED' });
});

test('native admission rechecks account generation, opt-out and logout; cleanup removes native ciphertext', async t => {
  const f = await fixture(t), value = input(), first = await f.service.register(f.a, value);
  await f.enable(f.a); assert.ok(await f.admit(first.id));
  await f.db.transactions.write(tx => tx.prisma.users.update({ where: { id: f.a.id }, data: { membership_generation: { increment: 1n } } }));
  assert.equal(await f.admit(first.id), null);
  const second = await f.service.register(f.a, { ...value, generation: first.generation }); assert.ok(await f.admit(second.id));
  await f.preferences.setPreferences(f.a, { pushEnabled: false, expectedGeneration: '2' }); assert.equal(await f.admit(first.id), null);
  await f.enable(f.a); await f.auth.logout(f.a); assert.equal(await f.admit(first.id), null);
  await f.db.transactions.write(tx => tx.prisma.users.update({ where: { id: f.a.id }, data: { status: 'DELETING' } }));
  let done = false;
  for (let i = 0; i < 15 && !done; i++) done = (await f.db.transactions.write(tx => f.core.purgeAccount(tx, f.a.id, 1))).done;
  assert.equal(done, true);
  assert.equal(await f.db.transactions.read(tx => tx.prisma.push_subscriptions.count({ where: { id: first.id } })), 0);
});

async function deliveryFixture(t, provider = 'APNS') {
  const f = await fixture(t);
  if (provider === 'FCM') {
    f.nativeConfig.fcm = { projectId: 'isolated-project', email: 'sender@isolated-project.iam.gserviceaccount.com',
      key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey, applicationId: 'chat.example.tests' };
    f.a = await f.issue(f.a.id, 'android');
  }
  const room = await f.db.transactions.write(async tx => {
    const room = await createRoom(tx, '격리 네이티브 알림 방', 'GROUP');
    await assignRoomOwner(tx, room, await joinRoom(tx, room, f.b.id)); await joinRoom(tx, room, f.a.id);
    return room;
  });
  const value = { ...input(), provider, ...(provider === 'FCM' ? { token: 'isolated:token_' + randomUUID() } : {}) };
  const subscription = await f.service.register(f.a, value); await f.enable(f.a);
  const message = await f.db.transactions.write(tx => sendMessage(tx, room, f.b.id,
    { clientMessageId: randomUUID(), intent: 'SHARED', content: { type: 'TEXT', text: 'isolated private message never in push payload' } }, f.config.key));
  const jobs = new JobsCoreService(new JobsRepository());
  const producer = new PushEnqueueService(jobs, new PushEnqueueRepository());
  const claim = (resourceId, roomId) => f.db.transactions.write(async tx => {
    const job = await tx.prisma.jobs.findFirstOrThrow({ where: { purpose: 'PUSH', resource_id: resourceId, room_id: roomId }, select: { id: true } });
    const lease = { id: job.id, purpose: 'PUSH', roomId, resourceId, generation: 1n, leaseOwner: randomUUID(), leaseToken: randomUUID(), attempts: 1, maxAttempts: 5 };
    await tx.prisma.jobs.update({ where: { id: job.id }, data: { state: 'RUNNING', generation: 1n, attempts: 1,
      lease_owner: lease.leaseOwner, lease_token: lease.leaseToken, lease_until: new Date((await tx.now()).getTime() + 30000) } });
    return lease;
  });
  const fanout = new NotificationFanoutService(f.db.transactions, new NotificationFanoutRepository(), producer, jobs, f.config.audience);
  assert.equal(await fanout.consume(await claim(message.messageId, null)), 'completed');
  const intent = await f.db.transactions.read(tx => tx.prisma.push_deliveries.findFirstOrThrow({ where: { subscription_id: subscription.id, message_id: message.messageId }, select: { id: true } }));
  const lease = await claim(intent.id, room);
  const worker = native => new PushDeliveryService(f.db.transactions, new PushDeliveryRepository(), f.core,
    { requireActiveMember: activeMember, actorBlocked }, { load: loadMessage, readable }, jobs,
    { config: { audience: f.config.audience }, prepare: () => assert.fail('native delivery used Web Push') }, { config: f.nativeConfig, ...native });
  return { ...f, room, value, subscription, messageId: message.messageId, lease, worker };
}

test('APNS and FCM messages create real fanout/delivery jobs and decrypt only at provider boundary', async t => {
  for (const provider of ['APNS', 'FCM']) await t.test(provider, async t => {
    const f = await deliveryFixture(t, provider); let sends = 0;
    const result = await f.worker({ prepare: async (actualProvider, token) => {
      assert.equal(actualProvider, provider); assert.equal(token, f.value.token);
      return { send: async () => { sends++; return { kind: 'accepted' }; } };
    } }).consume(f.lease);
    assert.equal(result, 'completed'); assert.equal(sends, 1);
    const job = await f.db.transactions.read(tx => tx.prisma.jobs.findUnique({ where: { id: f.lease.id } }));
    assert.equal(job.state, 'COMPLETED');
    const wire = JSON.stringify(job, (_, value) => typeof value === 'bigint' ? String(value) : value);
    assert.equal(wire.includes(f.value.token), false); assert.equal(wire.includes('isolated private message'), false);
  });
});

test('native final dispatch rechecks logout, account switch, opt-out, membership and content deletion after prepare', async t => {
  const cases = [
    ['logout', f => f.auth.logout(f.a)],
    ['rebind', f => f.service.register(f.b, { ...f.value, generation: f.subscription.generation })],
    ['opt-out', f => f.preferences.setPreferences(f.a, { pushEnabled: false, expectedGeneration: '2' })],
    ['leave', f => f.db.transactions.write(tx => leaveRoom(tx, f.room, f.a.id))],
    ['deleted message', f => f.db.transactions.write(tx => tx.prisma.messages.update({ where: { id: f.messageId }, data: { deleted_at: new Date() } }))],
  ];
  for (const [name, change] of cases) await t.test(name, async t => {
    const f = await deliveryFixture(t); let sends = 0;
    assert.equal(await f.worker({ prepare: async () => {
      // This real database write completing proves preparation holds no DB tx.
      await change(f); return { send: async () => { sends++; return { kind: 'accepted' }; } };
    } }).consume(f.lease), 'completed');
    assert.equal(sends, 0);
  });
});

test('late native Unregistered result cannot revoke a newer token generation', async t => {
  const f = await deliveryFixture(t);
  assert.equal(await f.worker({ prepare: async () => ({ send: async () => {
    await f.service.register(f.a, { ...f.value, token: input().token, generation: f.subscription.generation });
    return { kind: 'gone' };
  } }) }).consume(f.lease), 'completed');
  assert.deepEqual(await f.service.resolve(f.a, proof(f.value)), { binding: { id: f.subscription.id, generation: '2', revoked: false } });
});

test('expired and revoked sessions cannot permanently exhaust native installation capacity', async t => {
  for (const kind of ['expired', 'revoked']) await t.test(kind, async t => {
    const f = await fixture(t);
    for (let i = 0; i < 20; i++) await f.service.register(f.a, input());
    await assert.rejects(f.service.register(f.a, input()), { code: 'RATE_LIMITED' });
    const actor = await f.db.transactions.read(tx => f.auth.require(tx, f.a));
    await f.db.transactions.write(tx => tx.prisma.auth_sessions.update({ where: { id: actor.sessionId },
      data: kind === 'expired' ? { expires_at: new Date(0) } : { revoked_at: new Date() } }));
    assert.equal((await f.service.register(await f.issue(f.a.id), input())).generation, '1');
  });
});

test('crossed A→B and B→A rebinding finishes without inverse account lock cycle', async t => {
  const f = await fixture(t), av = input(), bv = input();
  const ar = await f.service.register(f.a, av), br = await f.service.register(f.b, bv);
  const results = await Promise.allSettled([
    f.service.register(f.b, { ...av, generation: ar.generation }),
    f.service.register(f.a, { ...bv, generation: br.generation }),
  ]);
  // NOWAIT can refuse contention but cannot leave a partial replacement.
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') {
      assert.equal(results[i].reason.code, 'CONFLICT');
      assert.equal(results[i].reason.getStatus(), 409);
    }
    const value = i === 0 ? av : bv, person = i === 0 ? f.b : f.a;
    const row = (await f.service.resolve(person, proof(value))).binding;
    assert.equal(row.generation, results[i].status === 'fulfilled' ? '2' : '1');
    assert.equal(row.revoked, false);
  }
});

test('actual MySQL NOWAIT 3572 becomes a controlled rebind conflict and preserves the old binding', { timeout: 15000 }, async t => {
  const f = await fixture(t), value = input();
  const first = await f.service.register(f.a, value);
  let locked, release;
  const ready = new Promise(resolve => { locked = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const blocker = f.db.transactions.write(async tx => {
    await tx.rows('SELECT id FROM users WHERE id=? FOR UPDATE', [f.a.id]);
    locked(); await hold;
  });
  try {
    await ready;
    // Assert the pinned driver's real error shape; no raw diagnostic is logged.
    await assert.rejects(f.db.transactions.write(tx => tx.rows('SELECT id FROM users WHERE id=? FOR UPDATE NOWAIT', [f.a.id])), error => {
      const cause = error.meta?.driverAdapterError?.cause;
      assert.equal(cause?.kind, 'mysql');
      assert.equal(cause?.code, 3572);
      assert.equal(cause?.originalCode, '3572');
      return true;
    });
    await assert.rejects(f.service.register(f.b, { ...value, generation: first.generation }), error => error.code === 'CONFLICT' && error.getStatus() === 409);
  } finally { release(); await blocker; }
  assert.equal((await f.service.resolve(f.a, proof(value))).binding.generation, '1');
  assert.equal((await f.service.register(f.b, { ...value, generation: first.generation })).generation, '2');
});
