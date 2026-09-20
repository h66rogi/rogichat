import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { NotificationsService } from '../../dist/modules/notifications/notifications.service.js';
import { NotificationsCoreService } from '../../dist/modules/notifications/notifications-core.service.js';
import { parseNotificationPreferences, parsePushSubscription, parseSubscriptionGeneration } from '../../dist/modules/notifications/notification-contract.js';
import { ApiError } from '../../dist/modules/auth/auth-primitives.js';

const web = { token: randomBytes(32).toString('base64url'), csrf: randomBytes(32).toString('base64url') };
const native = { transport: 'NATIVE', token: web.token, clientId: 'ios' };
function input() { const key = createECDH('prime256v1'); key.generateKeys(); return { endpoint: 'https://fcm.googleapis.com/send/unit-fixture', keys: { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }; }
function fixture(overrides = {}) {
  const events = []; const read = { writable: false }, write = { writable: true };
  const actor = { userId: randomUUID(), sessionId: randomUUID(), soopLinked: true };
  const auth = { async require(tx) { events.push(tx === write ? 'write-auth' : 'read-auth'); if (overrides.auth) return overrides.auth(tx); return actor; } };
  const transactions = { read: fn => fn(read), write: fn => fn(write) };
  const core = { async register(tx) { assert.equal(tx, write); events.push('register'); return { id: randomUUID(), generation: '1' }; }, async setPreferences(tx, userId, enabled) { assert.equal(tx, write); assert.equal(userId, actor.userId); events.push('preferences'); return { pushEnabled: enabled, generation: '2' }; } };
  const transport = { assertAvailable() { events.push('availability'); if (overrides.unavailable) throw new ApiError('AUTH_UNAVAILABLE', 503); } };
  const endpoints = { async validate() { events.push('dns'); if (overrides.dns) await overrides.dns(); } };
  return { events, write, service: new NotificationsService(transactions, auth, { audience: 'rogi-test' }, core, transport, endpoints) };
}

test('wire parsers reject extra target selectors, invalid generations and credential syntax', () => {
  const valid = input(); assert.deepEqual(parsePushSubscription(valid), valid);
  for (const value of [{ pushEnabled: true, userId: randomUUID() }, { pushEnabled: 'true' }, {}, null]) assert.throws(() => parseNotificationPreferences(value), { code: 'INVALID_REQUEST' });
  for (const generation of ['0', '01', '-1', '1e2', '18446744073709551616', 1, null]) assert.throws(() => parseSubscriptionGeneration({ generation }), { code: 'INVALID_REQUEST' });
  assert.deepEqual(parseSubscriptionGeneration({ generation: '18446744073709551615' }), { generation: '18446744073709551615' });
  for (const value of [{ ...valid, accountId: randomUUID() }, { ...valid, keys: { ...valid.keys, auth: valid.keys.auth + '=' } }, { ...valid, endpoint: 'http://fcm.googleapis.com/a' }, { ...valid, endpoint: 'https://user:password@fcm.googleapis.com/a' }, { ...valid, endpoint: valid.endpoint + '#secret' }]) assert.throws(() => parsePushSubscription(value), { code: 'INVALID_REQUEST' });
});

test('registration authenticates before DNS and reauthenticates in exact write transaction', async () => {
  const f = fixture(); await f.service.register(web, input());
  assert.deepEqual(f.events, ['read-auth', 'availability', 'dns', 'write-auth', 'register']);
  const expired = fixture({ auth(tx) { if (tx.writable) throw new ApiError('UNAUTHENTICATED', 401); return {}; } });
  await assert.rejects(expired.service.register(web, input()), { code: 'UNAUTHENTICATED' });
  assert.ok(!expired.events.includes('register'));
});

test('native and absent provider never register WebPush or report an enabled native push preference', async () => {
  for (const credentials of [native, { ...native, clientId: 'android' }]) {
    const f = fixture(); await assert.rejects(f.service.register(credentials, input()), { code: 'AUTH_UNAVAILABLE' });
    await assert.rejects(f.service.setPreferences(credentials, { pushEnabled: true, expectedGeneration: '1' }), { code: 'AUTH_UNAVAILABLE' });
    assert.ok(!f.events.includes('register')); assert.ok(!f.events.includes('dns'));
    assert.equal((await f.service.setPreferences(credentials, { pushEnabled: false, expectedGeneration: '1' })).pushEnabled, false);
  }
  const absent = fixture({ unavailable: true });
  await assert.rejects(absent.service.register(web, input()), { code: 'AUTH_UNAVAILABLE' });
  await assert.rejects(absent.service.setPreferences(web, { pushEnabled: true, expectedGeneration: '1' }), { code: 'AUTH_UNAVAILABLE' });
  assert.ok(!absent.events.includes('register')); assert.ok(!absent.events.includes('preferences'));
});

test('on-curve validation and bounded destination policy reject registration without persisting or echoing provider details', async () => {
  const f = fixture(); const invalid = input(); invalid.keys.p256dh = Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]).toString('base64url');
  await assert.rejects(f.service.register(web, invalid), { code: 'INVALID_REQUEST' });
  assert.ok(!f.events.includes('dns')); assert.ok(!f.events.includes('register'));
  for (const [message, code] of [['invalid_push_endpoint', 'INVALID_REQUEST'], ['push_dns_timeout', 'AUTH_UNAVAILABLE'], ['secret-dns-provider-details', 'AUTH_UNAVAILABLE']]) {
    const denied = fixture({ dns() { throw new Error(message); } });
    await assert.rejects(denied.service.register(web, input()), error => error.code === code && !error.message.includes('secret-dns-provider-details'));
    assert.ok(!denied.events.includes('register'));
  }
});

test('worker authorization rejects stale binding after initial lookup and current preference opt-out', async () => {
  const base = { id: 'subscription', user_id: 'user', session_id: 'session', audience: 'rogi-test', endpoint: 'private', p256dh: 'private', auth_secret: 'private', generation: '2', account_generation: '3', revoked_at: null };
  for (const replacement of [{ session_id: 'replacement' }, { user_id: 'replacement' }, { audience: 'rogi-qa' }, { account_generation: '4' }, { revoked_at: new Date() }]) {
    const core = new NotificationsCoreService({ async byId() { return base; }, async binding() { return { audience: 'rogi-test', membership_generation: '3', soop_status: 'VERIFIED' }; }, async lockPreferences() { return { push_enabled: 1, generation: '2' }; }, async lockSubscription() { return { ...base, ...replacement }; } });
    assert.equal(await core.authorizeSubscription({ writable: true }, base.id), null);
  }
  for (const soop_status of [null, 'REVOKED']) {
    const core = new NotificationsCoreService({ async byId() { return base; }, async binding() { return { audience: 'rogi-test', membership_generation: '3', soop_status }; } });
    assert.equal(await core.authorizeSubscription({ writable: true }, base.id), null);
  }
  const optedOut = new NotificationsCoreService({ async byId() { return base; }, async binding() { return { audience: 'rogi-test', membership_generation: '3', soop_status: 'VERIFIED' }; }, async lockPreferences() { return { push_enabled: 0, generation: '3' }; }, async lockSubscription() { return base; } });
  assert.equal(await optedOut.authorizeSubscription({ writable: true }, base.id), null);
  await assert.rejects(optedOut.authorizeSubscription({ writable: false }, base.id), /requires_write_transaction/);
});

test('preference HTTP input requires generation and core rejects stale preference before save', async () => {
  assert.throws(() => parseNotificationPreferences({ pushEnabled: true }), { code: 'INVALID_REQUEST' });
  assert.deepEqual(parseNotificationPreferences({ pushEnabled: false, expectedGeneration: '3' }), { pushEnabled: false, expectedGeneration: '3' });
  let saved = false;
  const core = new NotificationsCoreService({ async lockPreferences() { return { push_enabled: 0, generation: '3' }; }, async savePreferences() { saved = true; } });
  await assert.rejects(core.setPreferences({}, 'owner', true, '2'), { code: 'CONFLICT' });
  assert.equal(saved, false);
});

test('capability projects only after same-snapshot proof and supports implicit WEB credentials', async () => {
  const tx = { writable: false }; const events = [];
  const publicKey = input().keys.p256dh;
  const transport = { get config() { events.push('config'); return { vapid: { publicKey, privateKey: 'not-projected', subject: 'not-projected' } }; } };
  const auth = { async requireEnrollmentRead(handle, credentials) { assert.equal(handle, tx); events.push('proof'); if (!credentials.token) throw new ApiError('UNAUTHENTICATED', 401); } };
  const service = new NotificationsService({ read: fn => fn(tx) }, auth, {}, {}, transport, {});
  for (const credentials of [web, { ...web, transport: 'WEB' }]) {
    events.length = 0;
    assert.deepEqual(await service.capabilities(credentials), { available: true, applicationServerKey: publicKey });
    assert.deepEqual(events, ['proof', 'config']);
  }
  assert.deepEqual(await service.capabilities(native), { available: false });
  events.length = 0;
  await assert.rejects(service.capabilities({}), { code: 'UNAUTHENTICATED' }); assert.deepEqual(events, ['proof']);
});
