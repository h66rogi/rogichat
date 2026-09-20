import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AuthModule } from '../../dist/modules/auth/auth.module.js';
import { AuthService } from '../../dist/modules/auth/auth.service.js';
import { RecoveryAuthController } from '../../dist/modules/auth/recovery-auth.controller.js';
import { AUTH_CONFIG } from '../../dist/modules/auth/auth.tokens.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { cookie, cookieName, oauthCookieName, csrf, readSessionCredentials, readCommandCredentials } from '../../dist/modules/auth/auth-context.js';
import { ApiError, digest } from '../../dist/modules/auth/auth-primitives.js';
import { AuthFlow } from '../../dist/modules/auth/auth-flow.service.js';
import { Transactions } from '../../dist/infrastructure/database/transactions.js';
import { authCors } from '../../dist/common/http/auth-cors.js';

const token = 'a'.repeat(43); const proof = 'b'.repeat(43);
const config = () => ({ audience: 'auth-module-test', origin: 'http://localhost:3001',
  callback: 'http://localhost:3000/v1/auth/soop/callback', secure: false, key: randomBytes(32), broker: undefined });
function infrastructure(transactions) {
  class FixtureDatabaseModule {}
  Module({})(FixtureDatabaseModule);
  return { module: FixtureDatabaseModule, providers: [{ provide: Transactions, useValue: transactions }], exports: [Transactions] };
}
async function fixture(t) {
  const calls = []; const principal = { userId: randomUUID(), sessionId: randomUUID(), soopLinked: true };
  let used = 0;
  const tx = { writable: true,
    rows: async (...args) => { calls.push(['rows', ...args]); return [{ used, expired: 0 }]; },
    execute: async (...args) => { calls.push(['execute', ...args]); if (args[0].startsWith('UPDATE rate_buckets SET used=used+1')) used++; return { affectedRows: 1 }; },
  };
  tx.now = async () => new Date('2026-09-20T00:00:00Z');
  tx.prisma = {
    auth_sessions: { updateMany: async input => { calls.push(['revoke', input]); return { count: 1 }; } },
    rate_buckets: {
      createMany: async input => { calls.push(['rate.create', input]); return { count: 1 }; },
      updateMany: async input => { calls.push(['rate.update', input]); if (input.data.used?.increment === 1) used++; return { count: 1 }; },
    },
  };
  const transactions = {
    read: async run => { calls.push(['read']); return run({ ...tx, writable: false }); },
    write: async run => { calls.push(['write']); return run(tx); },
  };
  let revoked = false;
  const sessions = {
    require: async (...args) => { calls.push(['require', ...args]); if (revoked) throw new ApiError('UNAUTHENTICATED', 401); return { ...principal }; },
    csrf: value => `derived:${value}`,
  };
  const flow = {
    start: async (...args) => { calls.push(['start', ...args]); return { url: 'https://example.invalid/authorize', state: 'state' }; },
    callback: async (...args) => { calls.push(['callback', ...args]); return { token, csrf: proof }; },
    deny: async (...args) => { calls.push(['deny', ...args]); },
  };
  const settings = config();
  const module = AuthModule.register(infrastructure(transactions), { config: settings, sessions, flow, nativeFlow: { handles: async () => false } });
  const app = await NestFactory.createApplicationContext(module, { logger: false, abortOnError: false });
  t.after(() => app.close());
  return { calls, principal, tx, module, transactions, settings, flow, service: app.get(AuthService), revoke: () => { revoked = true; }, used: () => used, setUsed: value => { used = value; } };
}

test('AuthModule exports a narrow service/config boundary, with private session/flow/transaction providers', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.module.exports, [AuthService, AUTH_CONFIG]);
  assert.deepEqual(f.module.controllers, [RecoveryAuthController]);
  for (const name of ['sessions', 'transactions', 'flow']) assert.equal(name in f.service, false);
  for (const dependency of [AuthFlow, Transactions, SessionRepository, SessionService]) {
    class InvalidConsumer { constructor(value) { this.value = value; } }
    Inject(dependency)(InvalidConsumer, undefined, 0);
    class ConsumerModule {}
    Module({ imports: [f.module], providers: [InvalidConsumer] })(ConsumerModule);
    await assert.rejects(NestFactory.createApplicationContext(ConsumerModule, { logger: false, abortOnError: false }));
  }
});

test('require preserves the exact caller transaction and revalidates every call without cached Guard principal', async t => {
  const f = await fixture(t); const credentials = Object.freeze({ token, csrf: proof });
  assert.deepEqual(await f.service.require(f.tx, credentials, true), f.principal);
  assert.deepEqual(f.calls, [['require', f.tx, token, proof, true]]);
  f.revoke();
  await assert.rejects(f.service.require(f.tx, credentials, true), { code: 'UNAUTHENTICATED' });
  assert.equal(f.calls.filter(call => call[0] === 'require').length, 2);
  assert.equal(f.calls.some(call => call[0] === 'read' || call[0] === 'write'), false);
});

test('session projection and logout own bounded read/write transactions with mandatory logout proof', async t => {
  const f = await fixture(t);
  const session = await f.service.session({ token });
  assert.deepEqual(session, { authenticated: true, soopLinkStatus: 'VERIFIED', csrfToken: `derived:${token}` });
  assert.equal(f.calls[0][0], 'read'); assert.equal(f.calls[1][1].writable, false); assert.equal(f.calls[1][4], false);
  f.principal.soopLinked = false;
  assert.equal((await f.service.session({ token })).soopLinkStatus, 'REQUIRED');
  f.calls.length = 0;
  await assert.rejects(f.service.logout({ token }), { code: 'INVALID_REQUEST' }); assert.deepEqual(f.calls, []);
  await f.service.logout({ token, csrf: proof });
  assert.deepEqual(f.calls.map(call => call[0]), ['write', 'require', 'revoke']);
  assert.deepEqual(f.calls[2][1], { where: { id: f.principal.sessionId }, data: { revoked_at: await f.tx.now() } });
  f.calls.length = 0; f.revoke();
  await assert.rejects(f.service.logout({ token, csrf: proof }), { code: 'UNAUTHENTICATED' });
  assert.equal(f.calls.some(call => call[0] === 'revoke'), false);
});

test('AuthService delegates OAuth start/callback/denial without introducing an outer transaction', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.service.start('link', 'browser', token, proof), { url: 'https://example.invalid/authorize', state: 'state' });
  assert.deepEqual(await f.service.callback('state', 'code', 'browser', token), { token, csrf: proof });
  await f.service.deny('state', 'browser');
  assert.deepEqual(f.calls, [['start', 'link', 'browser', token, proof], ['callback', 'state', 'code', 'browser', token], ['deny', 'state', 'browser']]);
});

test('Nest default factories build real SessionService/AuthFlow/HttpBroker and retain fail-closed missing broker config', async t => {
  const settings = config(); const id = randomUUID(); const sql = [];
  const tx = {
    writable: false,
    rows: async (query, params) => { sql.push([query, params]); return [{ id, user_id: randomUUID(), csrf_digest: digest(proof), status: 'ACTIVE', soop_status: 'VERIFIED' }]; },
    execute: async (query, params) => { sql.push([query, params]); return { affectedRows: 1 }; },
  };
  tx.now = async () => new Date('2026-09-20T00:00:00Z');
  tx.prisma = {
    auth_sessions: { findFirst: async input => { sql.push(['auth_sessions.findFirst', input]); return { id, user_id: randomUUID(), csrf_digest: digest(proof), user: { status: 'ACTIVE', soop: { status: 'VERIFIED' } } }; } },
    login_transactions: {
      create: async input => { sql.push(['login.create', input]); return { id: input.data.id }; },
      updateMany: async input => { sql.push(['login.update', input]); return { count: 1 }; },
    },
  };
  const transactions = { read: run => run(tx), write: run => run({ ...tx, writable: true }) };
  const registered = AuthModule.register(infrastructure(transactions), { config: settings });
  const app = await NestFactory.createApplicationContext(registered, { logger: false, abortOnError: false });
  t.after(() => app.close()); const service = app.get(AuthService);
  const repository = app.get(SessionRepository); const calls = [];
  const findCurrent = repository.findCurrent.bind(repository);
  t.mock.method(repository, 'findCurrent', (...args) => { calls.push(args); return findCurrent(...args); });
  const expected = createHmac('sha256', settings.key).update(`csrf:${settings.audience}:${token}`).digest('base64url');
  assert.equal(service.csrf(token), expected); assert.equal((await service.session({ token })).csrfToken, expected);
  assert.equal(calls.length, 1); assert.equal(calls[0][0], tx);
  assert.equal(sql[0][1].where.audience, settings.audience);
  await assert.rejects(service.start('login', 'c'.repeat(43)), { code: 'AUTH_UNAVAILABLE' });
  assert.equal(sql.filter(([query]) => query === 'login.create').length, 1);
  assert.equal(sql.filter(([query]) => query === 'login.update').length, 1);
});

test('transport contexts preserve exact Origin/CSRF/cookie behavior without retaining Express requests', () => {
  const settings = config(); const request = { headers: { cookie: `other=x; rogi_session=${token}`, origin: settings.origin, 'x-csrf-token': proof } };
  assert.equal(cookie(request, 'rogi_session'), token); assert.equal(csrf(request, settings), proof);
  const read = readSessionCredentials(request, settings); const command = readCommandCredentials(request, settings);
  assert.deepEqual(read, { token }); assert.deepEqual(command, { token, csrf: proof });
  assert.ok(Object.isFrozen(read)); assert.ok(Object.isFrozen(command));
  assert.deepEqual(readSessionCredentials({ headers: {} }, settings), {});
  assert.equal(cookieName({ ...settings, secure: true }, 'session'), '__Host-rogi_session');
  assert.equal(oauthCookieName(settings, 'state'), `rogi_oauth_${digest('state').toString('hex')}`);
  for (const headers of [{ ...request.headers, origin: 'https://evil.invalid' }, { ...request.headers, origin: undefined }]) {
    assert.throws(() => readCommandCredentials({ headers }, settings), { code: 'FORBIDDEN' });
  }
  for (const cookieValue of [`rogi_session=${token}; rogi_session=${token}`, 'x'.repeat(8193)]) {
    assert.throws(() => readSessionCredentials({ headers: { cookie: cookieValue } }, settings), { code: 'INVALID_REQUEST' });
  }
  for (const value of [undefined, '', 'invalid', [proof, proof]]) {
    assert.throws(() => readCommandCredentials({ headers: { ...request.headers, 'x-csrf-token': value } }, settings), { code: 'INVALID_REQUEST' });
  }
});

test('auth IP limits commit before OAuth failures, preserve HMAC scopes and enforce existing 10/30 thresholds', async t => {
  const f = await fixture(t); let committed = false;
  const write = f.transactions.write;
  f.transactions.write = async operation => { const result = await write(operation); committed = true; return result; };
  f.flow.start = async () => { assert.equal(committed, true); throw new ApiError('AUTH_UNAVAILABLE', 503); };
  await f.service.charge('start', '127.0.0.1');
  const firstWrite = f.calls.find(call => call[0] === 'execute');
  const expected = createHmac('sha256', f.settings.key).update('start:127.0.0.1').digest();
  assert.deepEqual(firstWrite[2], [expected, 60]);
  assert.match(firstWrite[1], /ON DUPLICATE KEY UPDATE key_digest=key_digest$/);
  await assert.rejects(f.service.start('login', 'browser'), { code: 'AUTH_UNAVAILABLE' });
  assert.equal(f.used(), 1);
  f.setUsed(10); await assert.rejects(f.service.charge('start', '127.0.0.1'), { code: 'RATE_LIMITED' }); assert.equal(f.used(), 10);
  f.setUsed(29); await f.service.charge('callback', undefined); assert.equal(f.used(), 30);
  const unknown = createHmac('sha256', f.settings.key).update('callback:unknown').digest();
  assert.deepEqual(f.calls.filter(call => call[0] === 'rows').at(-1)[2], [unknown]);
  await assert.rejects(f.service.charge('callback', undefined), { code: 'RATE_LIMITED' }); assert.equal(f.used(), 30);
});

test('module-owned HTTP controller preserves session/logout, login/link and callback cookie contracts', async t => {
  const f = await fixture(t); const state = 'c'.repeat(43); const browser = 'd'.repeat(43); const code = 'e'.repeat(43);
  f.flow.start = async (...args) => { f.calls.push(['start', ...args]); return { url: 'https://example.invalid/authorize', state }; };
  const app = await NestFactory.create(f.module, { logger: false, abortOnError: false });
  t.after(() => app.close()); authCors(app.getHttpAdapter().getInstance(), f.settings);
  await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
  const call = (method, path, body, headers = {}) => fetch(`${base}/v1/auth${path}`, {
    method, redirect: 'manual', headers: { Origin: f.settings.origin, Cookie: `rogi_session=${token}`, 'X-CSRF-Token': proof,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let response = await call('GET', '/session'); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: true, soopLinkStatus: 'VERIFIED', csrfToken: `derived:${token}` });
  response = await call('POST', '/logout', {}); assert.equal(response.status, 204);
  assert.match(response.headers.get('set-cookie'), /^rogi_session=;/); assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  response = await call('POST', '/logout', {}, { 'X-CSRF-Token': '' }); assert.equal(response.status, 400);
  response = await call('POST', '/soop/start', { intent: 'login', termsVersion: '2026-09-20' });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { authorizeUrl: 'https://example.invalid/authorize' });
  assert.match(response.headers.get('set-cookie'), new RegExp(`^${oauthCookieName(f.settings, state)}=`));
  assert.match(response.headers.get('set-cookie'), /Max-Age=600/); assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  assert.equal(f.calls.filter(call => call[0] === 'start').at(-1)[4], undefined);
  response = await call('POST', '/soop/start', { intent: 'link' }); assert.equal(response.status, 200);
  assert.equal(f.calls.filter(call => call[0] === 'start').at(-1)[4], proof);
  response = await call('POST', '/soop/start', { intent: 'login', termsVersion: '2026-09-20', extra: true }); assert.equal(response.status, 400);
  response = await call('POST', '/soop/start', { intent: 'login', termsVersion: '2026-09-20' }, { Origin: 'https://evil.invalid' }); assert.equal(response.status, 403);
  const oauthCookie = `${oauthCookieName(f.settings, state)}=${browser}`;
  response = await call('GET', `/soop/callback?state=${state}&code=${code}`, undefined, { Cookie: `rogi_session=${token}; ${oauthCookie}` });
  assert.equal(response.status, 303); assert.equal(response.headers.get('location'), `${f.settings.origin}/`);
  assert.deepEqual(f.calls.filter(call => call[0] === 'callback').at(-1), ['callback', state, code, browser, token]);
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.ok(response.headers.getSetCookie().some(value => value.startsWith(`rogi_session=${token};`) && value.includes('Max-Age=604800')));
  response = await call('GET', `/soop/callback?state=${state}&error=PROVIDER_DENIED`, undefined, { Cookie: oauthCookie });
  assert.equal(response.status, 303); assert.equal(response.headers.get('location'), `${f.settings.origin}/auth/login?error=AUTH_FAILED`);
  assert.deepEqual(f.calls.filter(call => call[0] === 'deny').at(-1), ['deny', state, browser]);
});
