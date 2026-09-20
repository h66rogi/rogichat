import { deletionFixture } from '../support/deletion-fixture.mjs';
import { responseContract } from '../support/openapi-response.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { io } from 'socket.io-client';
import { createUser, createRoom, joinRoom, sendMessage, Jobs, publishText } from '../support/domain-fixture.mjs';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { createApi } from '../../dist/application.js';
import { SafeLogger } from '../../dist/infrastructure/observability/logging.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { AuthService } from '../../dist/modules/auth/auth.service.js';
import { RealtimeGateway } from '../../dist/modules/realtime/realtime.gateway.js';
import { digest } from '../../dist/modules/auth/auth-primitives.js';

async function fixture(t, http = false) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api'));
  let app; const clients = [];
  t.after(async () => { try { for (const client of clients) client.disconnect(); await app?.close(); } finally { await db.close(); } });
  const config = { audience: `native-${randomBytes(8).toString('hex')}`, origin: 'http://localhost:3001', secure: false, key: randomBytes(32), broker: undefined };
  const repository = new SessionRepository();
  const sessions = new SessionService(repository, config.audience, config.key);
  const auth = new AuthService(sessions, undefined, db.transactions, repository, config);
  const userId = await db.transactions.write(tx => createUser(tx, '네이티브 합성 사용자'));
  const issue = clientId => db.transactions.write(tx => sessions.issueNative(tx, userId, clientId));
  const native = await issue('ios');
  const web = await db.transactions.write(tx => sessions.issue(tx, userId));
  let logs = '';
  if (http) {
    app = await createApi(db, new SafeLogger('api', line => { logs += line; }), undefined, { config }, undefined, 'test', deletionFixture());
    await app.listen(0, '127.0.0.1');
  }
  const base = app ? await app.getUrl() : undefined;
  const credentials = { transport: 'NATIVE', token: native.token, clientId: 'ios' };
  const headers = { Authorization: `Bearer ${native.token}`, 'X-Rogi-Client': 'ios' };
  const validateResponse = app ? responseContract(app, config) : undefined;
  const call = async (method, path, body, extra = {}) => { const response = await fetch(`${base}${path}`, { method, headers: { ...headers,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    validateResponse(method, path, response.status, response.headers.get('content-type')?.includes('application/json') ? await response.clone().json() : undefined);
    return response;
  };
  const link = () => db.transactions.write(async tx => {
    await tx.prisma.platform_soop.create({ data: { id: randomUUID(), user_id: userId, provider_subject: Buffer.from(`native-fixture-${randomUUID()}`), verified_at: await tx.now() } });
    await tx.prisma.users.update({ where: { id: userId }, data: { membership_generation: { increment: 1n } } });
  });
  const connect = async (overrides = {}) => {
    const client = io(base, { path: '/v1/realtime', transports: ['websocket'], reconnection: false, timeout: 1500,
      extraHeaders: headers, auth: { schemaVersion: 1, transport: 'native' }, ...overrides });
    clients.push(client);
    await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); });
    return client;
  };
  return { db, config, sessions, auth, userId, native, web, credentials, headers, call, link, issue, base, app, connect, logs: () => logs };
}

test('native DB credentials enforce purpose/client/audience on both snapshots and command transactions, with fixed expiry', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const rows = await f.db.transactions.read(tx => tx.prisma.auth_sessions.findMany({ where: { user_id: f.userId }, select: { transport: true, client_id: true, token_digest: true, created_at: true, expires_at: true } }));
  const saved = rows.find(row => row.transport === 'NATIVE');
  assert.deepEqual(Buffer.from(saved.token_digest), digest(f.native.token));
  assert.equal(saved.client_id, 'ios'); assert.equal(saved.expires_at.toISOString(), f.native.expiresAt);
  assert.ok(Math.abs(saved.expires_at - saved.created_at - 7 * 86400000) < 1000);
  assert.equal(rows.find(row => row.transport === 'WEB').client_id, null);
  for (const mode of ['read', 'write']) {
    const run = credentials => f.db.transactions[mode](tx => f.auth.require(tx, credentials));
    assert.equal((await run(f.credentials)).userId, f.userId);
    for (const credentials of [{ token: f.native.token }, { ...f.credentials, token: f.web.token }, { ...f.credentials, clientId: 'android' }]) {
      await assert.rejects(run(credentials), { code: 'UNAUTHENTICATED' });
    }
    const other = new SessionService(new SessionRepository(), `${f.config.audience}-x`, f.config.key);
    await assert.rejects(f.db.transactions[mode](tx => other.require(tx, f.native.token, undefined, false, { transport: 'NATIVE', clientId: 'ios' })), { code: 'UNAUTHENTICATED' });
  }
  await assert.rejects(f.db.transactions.write(tx => f.auth.require(tx, f.credentials, true)), { code: 'SOOP_LINK_REQUIRED' });
  await assert.rejects(f.db.transactions.write(tx => f.sessions.issueNative(tx, f.userId, 'web')), { code: 'INVALID_REQUEST' });
  for (const client_id of [null, 'unknown']) {
    await f.db.transactions.write(tx => tx.prisma.auth_sessions.updateMany({ where: { token_digest: digest(f.native.token) }, data: { client_id } }));
    for (const mode of ['read', 'write']) await assert.rejects(f.db.transactions[mode](tx => f.auth.require(tx, f.credentials)), { code: 'UNAUTHENTICATED' });
  }
  await f.db.transactions.write(tx => tx.prisma.auth_sessions.updateMany({ where: { token_digest: digest(f.native.token) }, data: { client_id: 'ios' } }));
  await f.db.transactions.write(tx => tx.prisma.auth_sessions.updateMany({ where: { token_digest: digest(f.web.token) }, data: { client_id: 'ios' } }));
  for (const mode of ['read', 'write']) await assert.rejects(f.db.transactions[mode](tx => f.auth.require(tx, { token: f.web.token })), { code: 'UNAUTHENTICATED' });
  await f.db.transactions.write(tx => tx.prisma.auth_sessions.updateMany({ where: { token_digest: digest(f.native.token) }, data: { expires_at: new Date(0) } }));
  await assert.rejects(f.db.transactions.read(tx => f.auth.require(tx, f.credentials)), { code: 'UNAUTHENTICATED' });
  await assert.rejects(f.auth.logout(f.credentials), { code: 'UNAUTHENTICATED' });
  for (const status of ['SUSPENDED', 'DELETING', 'DELETED']) {
    const current = await f.issue('ios');
    await f.db.transactions.write(tx => tx.prisma.users.update({ where: { id: f.userId }, data: { status } }));
    await assert.rejects(f.db.transactions.write(tx => f.auth.require(tx, { ...f.credentials, token: current.token })), { code: 'UNAUTHENTICATED' });
    await f.db.transactions.write(tx => tx.prisma.users.update({ where: { id: f.userId }, data: { status: 'ACTIVE' } }));
  }
});

test('native HTTP session projects only own account, preserves web response and enforces strict headers and isolated logout', { timeout: 20000 }, async t => {
  const f = await fixture(t, true);
  let response = await f.call('GET', '/v1/auth/session');
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const before = await response.json();
  assert.deepEqual(Object.keys(before).sort(), ['account', 'accountGeneration', 'accountPartition', 'authenticated', 'capabilities', 'expiresAt', 'onboardingState', 'soopLinkStatus']);
  assert.deepEqual(before.account, { userId: f.userId, nickname: '네이티브 합성 사용자', avatarAssetId: null });
  assert.deepEqual(before.capabilities, { chat: false }); assert.equal(before.onboardingState, 'SOOP_LINK_REQUIRED');
  assert.equal(before.soopLinkStatus, 'REQUIRED'); assert.equal(before.expiresAt, f.native.expiresAt); assert.match(before.accountGeneration, /^[A-Za-z0-9_-]{43}$/);
  response = await f.call('PATCH', '/v1/me/profile', { nickname: '내 프로필 수정' }); assert.equal(response.status, 200);
  const unlinked = await f.call('GET', `/v1/rooms/${randomUUID()}/messages/${randomUUID()}`);
  assert.equal(unlinked.status, 403); assert.deepEqual(await unlinked.json(), { error: { code: 'SOOP_LINK_REQUIRED' } });
  await f.link();
  const after = await (await f.call('GET', '/v1/auth/session')).json();
  assert.equal(after.account.nickname, '내 프로필 수정'); assert.equal(after.onboardingState, 'READY'); assert.deepEqual(after.capabilities, { chat: true });
  assert.notEqual(after.accountGeneration, before.accountGeneration);
  assert.match(before.accountPartition, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(after.accountPartition, before.accountPartition);
  const another = await f.issue('ios');
  assert.equal((await f.auth.session({ ...f.credentials, token: another.token })).accountGeneration, after.accountGeneration);
  assert.equal((await f.auth.session({ ...f.credentials, token: another.token })).accountPartition, before.accountPartition);
  for (const extra of [{ Cookie: `rogi_session=${f.web.token}` }, { 'X-CSRF-Token': f.web.csrf }, { 'X-Rogi-Client': 'web' }, { Authorization: `Bearer ${f.native.token}, Bearer ${f.native.token}` }]) {
    assert.equal((await f.call('GET', '/v1/auth/session', undefined, extra)).status, 400);
  }
  assert.equal((await f.call('GET', '/v1/auth/session', undefined, { 'X-Rogi-Client': 'android' })).status, 401);
  assert.equal((await f.call('GET', '/v1/auth/session', undefined, { Origin: 'https://evil.invalid' })).status, 403);
  // Real HTTP duplicate Authorization must not be silently chosen by Node's header parser.
  const duplicated = await new Promise((resolve, reject) => {
    const req = httpRequest(`${f.base}/v1/auth/session`, { headers: ['Authorization', f.headers.Authorization, 'Authorization', f.headers.Authorization, 'X-Rogi-Client', 'ios'] }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end();
  });
  assert.equal(duplicated, 400);
  const webHeaders = { Cookie: `rogi_session=${f.web.token}`, Origin: f.config.origin };
  response = await fetch(`${f.base}/v1/auth/session`, { headers: webHeaders });
  assert.deepEqual(await response.json(), { authenticated: true, soopLinkStatus: 'VERIFIED', csrfToken: f.web.csrf, accountPartition: before.accountPartition });
  response = await fetch(`${f.base}/v1/auth/logout`, { method: 'POST', headers: { ...webHeaders, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 400);
  assert.equal((await f.call('POST', '/v1/auth/logout', { csrf: 'no' })).status, 400);
  response = await f.call('POST', '/v1/auth/logout', {});
  assert.equal(response.status, 204); assert.equal(response.headers.get('set-cookie'), null);
  assert.equal((await f.call('GET', '/v1/auth/session')).status, 401);
  assert.equal((await fetch(`${f.base}/v1/auth/session`, { headers: webHeaders })).status, 200);
  assert.equal((await f.auth.session({ ...f.credentials, token: another.token })).authenticated, true);
  await f.db.transactions.write(tx => tx.prisma.auth_sessions.updateMany({ where: { token_digest: digest(another.token) }, data: { expires_at: new Date(0) } }));
  assert.equal((await f.call('GET', '/v1/auth/session', undefined, { Authorization: `Bearer ${another.token}` })).status, 401);
  for (const value of [f.native.token, f.web.token, f.userId, f.web.csrf]) assert.ok(!f.logs().includes(value));
});

test('native session fails closed for an ACTIVE account with missing profile instead of fabricating a profile', { timeout: 15000 }, async t => {
  const f = await fixture(t, true);
  await f.db.transactions.write(tx => tx.prisma.user_profiles.delete({ where: { user_id: f.userId } }));
  const response = await f.call('GET', '/v1/auth/session');
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: { code: 'AUTH_UNAVAILABLE' } });
});

test('native shared message/reaction/delete commands use current same-transaction session authorization without CSRF', { timeout: 20000 }, async t => {
  const f = await fixture(t, true); await f.link();
  const roomId = await f.db.transactions.write(async tx => { const id = await createRoom(tx, '네이티브 명령 합성방', 'GROUP'); await joinRoom(tx, id, f.userId); return id; });
  const path = `/v1/rooms/${roomId}/messages`;
  let response = await f.call('POST', path, { clientMessageId: randomUUID(), intent: 'SHARED', content: { type: 'TEXT', text: '네이티브 합성 메시지' } });
  assert.equal(response.status, 200); const sent = await response.json();
  response = await f.call('PUT', `${path}/${sent.messageId}/reactions/me`, { emoji: '❤️' }); assert.equal(response.status, 200);
  response = await f.call('DELETE', `${path}/${sent.messageId}/reactions/me`, {}); assert.equal(response.status, 200);
  response = await f.call('POST', `${path}/${sent.messageId}/delete`, {}); assert.equal(response.status, 200);
  await f.db.transactions.write(tx => tx.prisma.platform_soop.updateMany({ where: { user_id: f.userId }, data: { status: 'REVOKED' } }));
  response = await f.call('POST', path, { clientMessageId: randomUUID(), intent: 'SHARED', content: { type: 'TEXT', text: '거부되어야 함' } });
  assert.equal(response.status, 403); assert.deepEqual(await response.json(), { error: { code: 'SOOP_LINK_REQUIRED' } });
});

test('native owner publication accepts native proof and still denies nonowners and revoked sessions', { timeout: 20000 }, async t => {
  const f = await fixture(t, true); await f.link();
  const { roomId, source } = await f.db.transactions.write(async tx => {
    const roomId = await createRoom(tx, '네이티브 공개 합성방', 'FAN');
    const owner = await joinRoom(tx, roomId, f.userId);
    await tx.prisma.room_members.update({ where: { id: owner }, data: { role: 'STREAMER' } });
    await tx.prisma.rooms.update({ where: { id: roomId }, data: { owner_member_id: owner } });
    const fan = await createUser(tx, '네이티브 공개 합성팬');
    await joinRoom(tx, roomId, fan);
    const source = await sendMessage(tx, roomId, fan, { clientMessageId: randomUUID(), intent: 'PRIVATE',
      recipientActorId: owner, quoteId: null, content: { type: 'TEXT', text: '네이티브 공개 합성본문' } }, f.config.key);
    return { roomId, source };
  });
  const path = `/v1/rooms/${roomId}/messages/${source.messageId}/publications`;
  assert.equal((await f.call('POST', path, {}, { 'X-CSRF-Token': f.web.csrf })).status, 400);
  const accepted = await f.call('POST', path, {}); assert.equal(accepted.status, 202);
  const body = await accepted.json();
  assert.deepEqual(Object.keys(body).sort(), ['publicationId', 'status']); assert.equal(body.status, 'preparing');
  assert.equal((await f.call('GET', `/v1/rooms/${roomId}/publications/${body.publicationId}`)).status, 200);
  const lease = (await new Jobs(f.db.transactions, 'worker').claim({ purposes: ['PUBLICATION'] })).find(item => item.resourceId === body.publicationId);
  assert.ok(lease); assert.equal(await publishText(f.db.transactions, lease), 'completed');
  await f.db.transactions.write(tx => tx.prisma.rooms.update({ where: { id: roomId }, data: { owner_member_id: null } }));
  assert.equal((await f.call('POST', path, {})).status, 404);
  assert.equal((await f.call('POST', '/v1/auth/logout', {})).status, 204);
  assert.equal((await f.call('POST', path, {})).status, 401);
});

test('real native sockets need purpose/client/SOOP, reject URL credentials, and lose access after logout/expiry', { timeout: 25000 }, async t => {
  const f = await fixture(t, true);
  await assert.rejects(f.connect(), /UNAUTHENTICATED/);
  await f.link();
  const client = await f.connect(); assert.ok(client.connected);
  for (const overrides of [
    { extraHeaders: { ...f.headers, 'X-Rogi-Client': 'android' } },
    { extraHeaders: { ...f.headers, Authorization: `Bearer ${f.web.token}` } },
    { extraHeaders: { Cookie: `rogi_session=${f.web.token}` }, auth: { schemaVersion: 1, csrfToken: f.web.csrf } },
    { extraHeaders: { ...f.headers, Cookie: `rogi_session=${f.web.token}` } },
    { extraHeaders: { ...f.headers, Origin: 'https://evil.invalid' } },
    { auth: { schemaVersion: 1, transport: 'native', token: f.native.token } },
    { query: { token: f.native.token } },
  ]) await assert.rejects(f.connect(overrides));
  const gateway = f.app.get(RealtimeGateway);
  const connection = [...gateway.connections.values()].find(value => value.socket.id === client.id);
  assert.ok(connection); assert.equal(connection.socket.request.headers.authorization, undefined);
  assert.ok(!connection.socket.request.rawHeaders.includes(f.headers.Authorization));
  assert.equal((await f.call('POST', '/v1/auth/logout', {})).status, 204);
  const disconnected = new Promise(resolve => client.once('disconnect', resolve));
  gateway.lastSessionCheck = -Infinity; // Trigger the existing 15-second sweep without sleeping.
  await gateway.tick(); await disconnected; assert.equal(client.connected, false);
  await assert.rejects(f.connect(), /UNAUTHENTICATED/);
  const expired = await f.issue('ios');
  await f.db.transactions.write(tx => tx.prisma.auth_sessions.updateMany({ where: { token_digest: digest(expired.token) }, data: { expires_at: new Date(0) } }));
  await assert.rejects(f.connect({ extraHeaders: { ...f.headers, Authorization: `Bearer ${expired.token}` } }), /UNAUTHENTICATED/);
});
