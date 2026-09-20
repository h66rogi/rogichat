import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { createApi } from '../../dist/application.js';
import { LifecycleState } from '../../dist/common/lifecycle/lifecycle-state.js';
import { SafeLogger } from '../../dist/infrastructure/observability/logging.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { NotificationsCoreService } from '../../dist/modules/notifications/notifications-core.service.js';
import { NotificationsRepository } from '../../dist/modules/notifications/notifications.repository.js';
import { createUser, createRoom, joinRoom, sendMessage, sendInput } from '../support/domain-fixture.mjs';

test('real M11 HTTP composition preserves own-state DTOs, proof precedence, native availability and empty DELETE204', { timeout: 25000 }, async t => {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api'));
  const config = { audience: 'rogi-test', origin: 'http://localhost:3001', callback: 'http://127.0.0.1:3000/v1/auth/soop/callback', secure: false, key: randomBytes(32), broker: undefined };
  const sessions = new SessionService(new SessionRepository(), config.audience, config.key);
  const core = new NotificationsCoreService(new NotificationsRepository());
  const fixture = await db.transactions.write(async tx => {
    const sender = await createUser(tx, 'HTTP 합성 작성자'), user = await createUser(tx, 'HTTP 합성 사용자');
    await tx.prisma.platform_soop.create({ data: { id: randomUUID(), user_id: user, provider_subject: randomBytes(24), verified_at: await tx.now() }, select: { id: true } });
    const room = await createRoom(tx, 'HTTP 합성 방', 'GROUP');
    await joinRoom(tx, room, sender); await joinRoom(tx, room, user);
    const web = await sessions.issue(tx, user), native = await sessions.issueNative(tx, user, 'ios');
    const principal = await sessions.require(tx, web.token, web.csrf);
    const point = createECDH('prime256v1'); point.generateKeys();
    const input = { endpoint: `https://fcm.googleapis.com/http-fixture/${randomUUID()}`, keys: { p256dh: point.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
    const subscription = await core.register(tx, principal, config.audience, input);
    return { sender, user, room, web, native, input, subscription };
  });
  const message = await db.transactions.write(tx => sendMessage(tx, fixture.room, fixture.sender,
    sendInput({ clientMessageId: randomUUID(), intent: 'SHARED', content: { type: 'TEXT', text: '합성 HTTP 메시지' } }), config.key));
  const app = await createApi(db, new SafeLogger('api', () => {}), new LifecycleState(), { config });
  await app.listen(0, '127.0.0.1');
  t.after(async () => { await app.close(); await db.close(); });
  const base = await app.getUrl();
  const webHeaders = { cookie: `rogi_session=${fixture.web.token}`, origin: config.origin, 'x-csrf-token': fixture.web.csrf };
  const nativeHeaders = { authorization: `Bearer ${fixture.native.token}`, 'x-rogi-client': 'ios' };
  const request = (path, method = 'GET', body, headers = webHeaders) => fetch(`${base}${path}`, {
    method, headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const prefs = '/v1/me/notification-preferences';
  let response = await request(prefs);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { pushEnabled: false, generation: '1' });
  assert.equal((await request(prefs, 'PUT', { pushEnabled: false })).status, 400);
  assert.equal((await request(prefs, 'PUT', { pushEnabled: false, expectedGeneration: '1' }, { cookie: webHeaders.cookie, origin: config.origin })).status, 400);
  assert.equal((await request(prefs, 'PUT', { pushEnabled: false, expectedGeneration: '1' }, {})).status, 403);
  response = await request(prefs, 'PUT', { pushEnabled: true, expectedGeneration: '1' });
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: { code: 'AUTH_UNAVAILABLE' } });
  assert.equal((await request(prefs, 'PUT', { pushEnabled: true, expectedGeneration: '1' }, nativeHeaders)).status, 503);
  assert.equal((await request(prefs, 'PUT', { pushEnabled: false, expectedGeneration: '1' }, nativeHeaders)).status, 200);
  assert.equal((await request(prefs, 'GET', undefined, { ...webHeaders, ...nativeHeaders })).status, 400);
  const read = `/v1/rooms/${fixture.room}/read-state`;
  response = await request(read, 'GET', undefined, nativeHeaders);
  assert.equal(response.status, 200);
  const state = await response.json(); assert.deepEqual(state.items, []); assert.match(state.readContext, /^[A-Za-z0-9_-]{43}$/);
  response = await request(read, 'PUT', { readContext: state.readContext, messageId: message.messageId }, nativeHeaders);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { messageId: message.messageId });
  assert.equal((await request(read, 'PUT', { readContext: state.readContext, messageId: message.messageId })).status, 409);
  assert.equal((await request('/v1/rooms/invalid/read-state')).status, 400);
  assert.equal((await request('/v1/me/push-subscriptions', 'POST', fixture.input)).status, 503);
  for (let attempt = 0; attempt < 2; attempt++) {
    response = await request(`/v1/me/push-subscriptions/${fixture.subscription.id}`, 'DELETE', { generation: fixture.subscription.generation });
    assert.equal(response.status, 204); assert.equal(await response.text(), '');
  }
});
