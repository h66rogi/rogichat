import { IdentityGuardRepository } from '../../dist/modules/auth/identity-guard.repository.js';
import { IdentityGuardService } from '../../dist/modules/auth/identity-guard.service.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { SafeLogger } from '../../dist/infrastructure/observability/logging.js';
import { createApi } from '../../dist/application.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { IdentityRepository } from '../../dist/modules/auth/identity.repository.js';
import { IdentityService } from '../../dist/modules/auth/identity.service.js';
import { LoginRepository } from '../../dist/modules/auth/login.repository.js';
import { NativeAuthRepository } from '../../dist/modules/auth/native-auth.repository.js';
import { NativeAuthService } from '../../dist/modules/auth/native-auth.service.js';
import { HttpBroker } from '../../dist/modules/auth/broker.adapter.js';
import { AuthFlow } from '../../dist/modules/auth/auth-flow.service.js';
import { secret, digest } from '../../dist/modules/auth/auth-primitives.js';
import { oauthCookieName } from '../../dist/modules/auth/auth-context.js';
import { createUser } from '../support/domain-fixture.mjs';
import { responseContract } from '../support/openapi-response.mjs';

const startPath = '/v1/auth/native/soop/transactions';
const exchangePath = '/v1/auth/native/completions/exchange';
const challenge = value => createHash('sha256').update(value).digest('base64url');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// Isolated test contract only: this broker never ships in src or a deployed module.
class FixtureBroker {
  requests = []; codes = new Map(); exchanges = 0; failure = false; requestFailure = false;
  async request(input) {
    if (this.requestFailure) throw new Error('fixture-broker-request-secret');
    this.requests.push(input);
    return `https://broker.example.invalid/v1/platform/oauth/rogichat/authorize?request=${secret()}`;
  }
  code(request, subject = `fixture-${randomUUID()}`, overrides = {}) {
    const code = secret(); this.codes.set(code, { request, subject, overrides }); return code;
  }
  async exchange(input) {
    this.exchanges++;
    const pending = this.codes.get(input.code); this.codes.delete(input.code);
    assert.ok(pending); assert.equal(pending.request.transactionId, input.transactionId);
    assert.equal(challenge(input.verifier), pending.request.challenge);
    this.entered?.resolve(); if (this.release) await this.release.promise;
    if (this.failure) throw new Error('fixture-broker-exchange-secret');
    return { schemaVersion: 1, provider: 'soop', subject: pending.subject, clientId: 'fixture-client',
      transactionId: input.transactionId, authenticatedAt: new Date().toISOString(), ...pending.overrides };
  }
}

async function fixture(t, overrides = {}) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api')); let app; let logs = '';
  t.after(async () => { try { await app?.close(); } finally { await db.close(); } });
  const config = { audience: 'rogi-qa', origin: 'https://qa.rogi.chat', callback: 'https://api.qa.rogi.chat/v1/auth/soop/callback',
    secure: false, key: randomBytes(32), broker: { baseUrl: 'https://broker.example.invalid', clientId: 'fixture-client', clientSecret: secret() }, ...overrides };
  const sessions = new SessionService(new SessionRepository(), config.audience, config.key);
  const broker = new FixtureBroker(); const identities = new IdentityService(new IdentityRepository(), config, new IdentityGuardService(new IdentityGuardRepository()));
  const nativeFlow = new NativeAuthService(sessions, db.transactions, config, broker, new NativeAuthRepository(), identities, new LoginRepository());
  const flow = new AuthFlow(sessions, db.transactions, config, broker, new LoginRepository(), identities);
  app = await createApi(db, new SafeLogger('api', line => { logs += line; }), undefined, { config, sessions, flow, nativeFlow });
  await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
  const verify = responseContract(app, config);
  const checked = async (method, path, options) => {
    const response = await fetch(`${base}${path}`, options);
    verify(method, path, response.status, response.headers.get('content-type')?.includes('application/json') ? await response.clone().json() : undefined);
    return response;
  };
  const call = (path, body, headers = {}) => checked('POST', path, { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/json', 'X-Rogi-Client': 'ios', ...headers }, body: JSON.stringify(body) });
  const get = (path, cookies) => checked('GET', path, { redirect: 'manual', headers: cookies ? { Cookie: cookies } : {} });
  const begin = async (options = {}) => {
    const verifier = options.verifier ?? secret(); const state = secret();
    const clientId = options.clientId ?? 'ios';
    const response = await call(startPath, { clientId, intent: options.token ? 'link' : 'login', codeChallenge: challenge(verifier),
      codeChallengeMethod: 'S256', returnState: state, ...(options.token ? {} : { termsVersion: '2026-09-20' }) },
    { 'X-Rogi-Client': clientId, ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('set-cookie'), null);
    const body = await response.json(); assert.deepEqual(Object.keys(body).sort(), ['authorizeUrl', 'expiresIn', 'transactionId']);
    assert.equal(body.expiresIn, 600);
    const url = new URL(body.authorizeUrl); assert.equal(url.origin, config.audience === 'rogi-production' ? 'https://api.rogi.chat' : 'https://api.qa.rogi.chat');
    assert.equal(url.pathname, '/v1/auth/native/soop/launch'); assert.deepEqual([...url.searchParams.keys()], ['request']);
    const request = broker.requests.find(item => item.transactionId === body.transactionId);
    assert.notEqual(request.challenge, challenge(verifier));
    return { ...body, verifier, state, request, clientId, token: options.token, launchPath: `${url.pathname}${url.search}` };
  };
  const launch = async started => {
    const response = await get(started.launchPath); assert.equal(response.status, 303);
    const cookies = response.headers.getSetCookie(); assert.equal(cookies.length, 1);
    assert.match(cookies[0], /HttpOnly/); assert.match(cookies[0], /SameSite=Lax/); assert.match(cookies[0], /Max-Age=600/);
    started.cookie = cookies[0].split(';')[0]; return started;
  };
  const callback = (started, options = {}) => {
    const code = options.code ?? broker.code(started.request, options.subject, options.identity);
    started.providerCode = code;
    return get(`/v1/auth/soop/callback?state=${options.state ?? started.request.state}&${options.error ? `error=${options.error}` : `code=${code}`}${options.extra ?? ''}`, options.cookie ?? started.cookie);
  };
  const complete = async (started, options) => {
    const response = await callback(started, options); assert.equal(response.status, 303);
    assert.equal(response.headers.getSetCookie().length, 1); assert.match(response.headers.getSetCookie()[0], /Expires=Thu, 01 Jan 1970/);
    const url = new URL(response.headers.get('location')); assert.equal(url.origin, config.origin); assert.equal(url.pathname, '/mobile/auth/complete');
    assert.deepEqual([...url.searchParams.keys()], ['code', 'state']); assert.equal(url.searchParams.get('state'), started.state);
    started.code = url.searchParams.get('code'); return started;
  };
  const exchange = (started, body = {}, headers = {}) => call(exchangePath, { clientId: started.clientId, transactionId: started.transactionId, code: started.code, codeVerifier: started.verifier, ...body },
    { 'X-Rogi-Client': started.clientId, ...(started.token ? { Authorization: `Bearer ${started.token}` } : {}), ...headers });
  const local = async () => db.transactions.write(async tx => {
    const userId = await createUser(tx, '네이티브 연결 합성 계정');
    await tx.prisma.users.update({ where: { id: userId }, data: { terms_version: '2026-09-20' } });
    const issued = await sessions.issueNative(tx, userId, 'ios');
    const principal = await sessions.require(tx, issued.token, undefined, false, { transport: 'NATIVE', clientId: 'ios' });
    return { ...issued, ...principal };
  });
  const update = (started, data) => db.transactions.write(tx => tx.prisma.login_transactions.update({ where: { id: started.transactionId }, data }));
  return { db, config, broker, identities, nativeFlow, sessions, flow, base, call, get, begin, launch, callback, complete, exchange, local, update, logs: () => logs };
}

test('native SOOP HTTP login returns the exact nested session DTO, opaque seven-day credential and redacted logs', { timeout: 20000 }, async t => {
  const f = await fixture(t); const started = await f.complete(await f.launch(await f.begin()));
  const response = await f.exchange(started); assert.equal(response.status, 200);
  assert.equal(response.headers.get('set-cookie'), null); assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json(); assert.deepEqual(Object.keys(body).sort(), ['accessToken', 'expiresAt', 'session', 'tokenType']);
  assert.equal(body.tokenType, 'Bearer'); assert.match(body.accessToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(body.expiresAt, body.session.expiresAt); assert.equal(body.session.soopLinkStatus, 'VERIFIED');
  const headers = { Authorization: `Bearer ${body.accessToken}`, 'X-Rogi-Client': 'ios' };
  const session = await fetch(`${f.base}/v1/auth/session`, { headers }); assert.deepEqual(await session.json(), body.session);
  const saved = await f.db.transactions.read(tx => tx.prisma.auth_sessions.findUnique({ where: { token_digest: digest(body.accessToken) } }));
  assert.equal(saved.transport, 'NATIVE'); assert.equal(saved.client_id, 'ios'); assert.ok(Math.abs(saved.expires_at - saved.created_at - 604800000) < 1000);
  assert.equal((await f.exchange(started)).status, 400); // Lost ACK cannot recover a credential.
  for (const value of [started.request.state, started.state, started.verifier, started.providerCode, started.code, body.accessToken, f.config.broker.clientSecret]) assert.ok(!f.logs().includes(value));
});

test('strict native JSON/body/header grammar rejects field injection, mixed transports and duplicate headers', { timeout: 20000 }, async t => {
  const f = await fixture(t); const body = { clientId: 'ios', intent: 'login', codeChallenge: secret(), codeChallengeMethod: 'S256', returnState: secret(), termsVersion: '2026-09-20' };
  for (const change of [{ returnUrl: 'https://evil.invalid' }, { subject: 'fake' }, { termsVersion: undefined }, { clientId: 'web' }, { codeChallengeMethod: 'plain' }, { codeChallenge: 'short' }, { returnState: 'short' }, { intent: 'link' }]) {
    assert.equal((await f.call(startPath, { ...body, ...change })).status, 400);
  }
  for (const headers of [{ 'X-Rogi-Client': 'android' }, { 'X-Rogi-Client': '' }, { Cookie: `rogi_session=${secret()}` }, { Cookie: `__Host-rogi_session=${secret()}` }, { 'X-CSRF-Token': secret() }, { Authorization: 'Bearer broken' }, { 'Content-Type': 'text/plain' }]) {
    assert.equal((await f.call(startPath, body, headers)).status, 400);
  }
  assert.equal((await f.call(startPath, body, { Origin: f.config.origin })).status, 403);
  for (const name of ['X-Rogi-Client', 'Authorization']) {
    const status = await new Promise((resolve, reject) => {
      const raw = JSON.stringify(body); const headers = ['Content-Type', 'application/json', 'Content-Length', String(Buffer.byteLength(raw)), 'X-Rogi-Client', 'ios', name, name === 'Authorization' ? `Bearer ${secret()}` : 'ios'];
      if (name === 'Authorization') headers.push(name, `Bearer ${secret()}`);
      const req = httpRequest(`${f.base}${startPath}`, { method: 'POST', headers }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); req.on('error', reject); req.end(raw);
    }); assert.equal(status, 400);
  }
  assert.equal(f.broker.requests.length, 0);
});

test('native launch/callback single use, wrong browser/state/query and reversed tabs preserve rightful flows', { timeout: 20000 }, async t => {
  const f = await fixture(t); const first = await f.launch(await f.begin()); const second = await f.launch(await f.begin());
  assert.equal((await f.get(first.launchPath)).status, 400);
  assert.equal((await f.callback(first, { cookie: second.cookie })).status, 400);
  assert.equal((await f.callback(first, { cookie: `${oauthCookieName(f.config, first.request.state)}=${secret()}` })).status, 400);
  assert.equal((await f.callback(first, { state: secret() })).status, 400);
  for (const extra of ['&channel=WEB', '&returnUrl=https://evil.invalid', `&state=${first.request.state}`]) assert.equal((await f.callback(first, { extra })).status, 400);
  assert.equal(f.broker.exchanges, 0);
  for (const started of [second, first]) { await f.complete(started); assert.equal((await f.callback(started)).status, 400); assert.equal((await f.exchange(started)).status, 200); }
  assert.equal(f.broker.exchanges, 2);
});

test('native completion wrong PKCE/client/id/environment does not consume the transaction', { timeout: 20000 }, async t => {
  const f = await fixture(t); const started = await f.complete(await f.launch(await f.begin({ verifier: 'a'.repeat(128) })));
  for (const change of [{ codeVerifier: secret() }, { code: secret() }, { transactionId: randomUUID() }, { clientId: 'android' }]) {
    assert.equal((await f.exchange(started, change, change.clientId ? { 'X-Rogi-Client': 'android' } : {})).status, 400);
  }
  for (const change of [{ codeVerifier: 'a'.repeat(129) }, { codeVerifier: 'a'.repeat(42) }, { codeVerifier: '!'.repeat(43) }, { extra: true }, { transactionId: 'bad' }]) assert.equal((await f.exchange(started, change)).status, 400);
  await f.update(started, { audience: 'rogi-production' }); assert.equal((await f.exchange(started)).status, 400);
  await f.update(started, { audience: 'rogi-qa' }); assert.equal((await f.exchange(started)).status, 200);
});

test('stage TTLs and overall expiry are enforced with the database clock', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const launch = await f.begin(); await f.update(launch, { launch_expires: new Date(0) }); assert.equal((await f.get(launch.launchPath)).status, 400);
  const callback = await f.launch(await f.begin()); await f.update(callback, { expires_at: new Date(0) }); assert.equal((await f.callback(callback)).status, 400);
  const complete = await f.complete(await f.launch(await f.begin())); await f.update(complete, { completion_expires: new Date(0) }); assert.equal((await f.exchange(complete)).status, 400);
  const overall = await f.complete(await f.launch(await f.begin())); await f.update(overall, { expires_at: new Date(0) }); assert.equal((await f.exchange(overall)).status, 400);
});

test('concurrent launch/callback/exchange admits exactly one consumer at each stage', { timeout: 20000 }, async t => {
  const f = await fixture(t); const started = await f.begin();
  const launches = await Promise.all([f.get(started.launchPath), f.get(started.launchPath)]); assert.deepEqual(launches.map(r => r.status).sort(), [303, 400]);
  started.cookie = launches.find(r => r.status === 303).headers.getSetCookie()[0].split(';')[0];
  const code = f.broker.code(started.request); const callbacks = await Promise.all([f.callback(started, { code }), f.callback(started, { code })]);
  assert.deepEqual(callbacks.map(r => r.status).sort(), [303, 400]); assert.equal(f.broker.exchanges, 1);
  started.code = new URL(callbacks.find(r => r.status === 303).headers.get('location')).searchParams.get('code');
  const results = await Promise.all([f.exchange(started), f.exchange(started)]); assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
});

test('native link preserves terms, rotates only its bound session and rejects session/account replacement', { timeout: 20000 }, async t => {
  const f = await fixture(t); const local = await f.local(); const other = await f.local();
  const started = await f.complete(await f.launch(await f.begin({ token: local.token })));
  assert.equal((await f.exchange(started, {}, { Authorization: `Bearer ${other.token}` })).status, 401);
  assert.equal((await f.exchange(started, {}, { Authorization: '' })).status, 400);
  const response = await f.exchange(started); assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.session.account.userId, local.userId);
  const account = await f.db.transactions.read(tx => tx.prisma.users.findUnique({ where: { id: local.userId } })); assert.equal(account.terms_version, '2026-09-20');
  await assert.rejects(f.db.transactions.read(tx => f.sessions.require(tx, local.token, undefined, false, { transport: 'NATIVE', clientId: 'ios' })), { code: 'UNAUTHENTICATED' });
  assert.equal((await f.db.transactions.read(tx => f.sessions.require(tx, other.token, undefined, false, { transport: 'NATIVE', clientId: 'ios' }))).userId, other.userId);
});

test('native link requires recent auth at start, callback and exchange and current generation/account state', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const changeSession = (local, data) => f.db.transactions.write(tx => tx.prisma.auth_sessions.update({ where: { id: local.sessionId }, data }));
  const old = await f.local(); await changeSession(old, { created_at: new Date(Date.now() - 960000) });
  await assert.rejects(f.nativeFlow.start({ clientId: 'ios', intent: 'link', codeChallenge: secret(), returnState: secret() }, { transport: 'NATIVE', clientId: 'ios', token: old.token }), { code: 'RECENT_AUTH_REQUIRED' });
  for (const stage of ['callback', 'exchange']) {
    const local = await f.local(); const started = await f.launch(await f.begin({ token: local.token })); if (stage === 'exchange') await f.complete(started);
    await changeSession(local, { created_at: new Date(Date.now() - 960000) });
    const response = stage === 'callback' ? await f.callback(started) : await f.exchange(started); assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'RECENT_AUTH_REQUIRED');
  }
  for (const data of [{ membership_generation: { increment: 1n } }, { status: 'SUSPENDED' }, { status: 'DELETING' }]) {
    const local = await f.local(); const started = await f.complete(await f.launch(await f.begin({ token: local.token })));
    await f.db.transactions.write(tx => tx.prisma.users.update({ where: { id: local.userId }, data })); assert.equal((await f.exchange(started)).status >= 400, true);
    assert.equal(await f.db.transactions.read(tx => tx.prisma.platform_soop.count({ where: { user_id: local.userId } })), 0);
  }
});

test('logout during broker I/O cannot finalize link; provider I/O holds no authorization transaction', { timeout: 20000 }, async t => {
  const f = await fixture(t); const local = await f.local(); const started = await f.launch(await f.begin({ token: local.token }));
  f.broker.entered = deferred(); f.broker.release = deferred();
  const callback = f.callback(started); await f.broker.entered.promise;
  const logout = await f.call('/v1/auth/logout', {}, { Authorization: `Bearer ${local.token}` }); assert.equal(logout.status, 204);
  f.broker.release.resolve(); const response = await callback; assert.equal(response.status, 303);
  const url = new URL(response.headers.get('location')); assert.equal(url.searchParams.get('error'), 'LINK_SESSION_CHANGED'); assert.equal(url.searchParams.has('code'), false);
  assert.equal(await f.db.transactions.read(tx => tx.prisma.platform_soop.count({ where: { user_id: local.userId } })), 0);
});

test('concurrent first logins share canonical identity; conflicting native links never merge accounts', { timeout: 20000 }, async t => {
  const f = await fixture(t); const subject = `fixture-${randomUUID()}`;
  const first = await f.complete(await f.launch(await f.begin()), { subject }); const second = await f.complete(await f.launch(await f.begin()), { subject });
  // Force second's stage-row read before first registers the canonical account.
  // A consistent RR read at that stage must not hide the newly committed profile
  // from the exact session DTO projection after identity authorization.
  const entered = deferred(); const release = deferred(); const resolve = f.identities.resolve.bind(f.identities);
  t.mock.method(f.identities, 'resolve', async (tx, identity, linkUser) => {
    if (identity.transactionId === second.transactionId) { entered.resolve(); await release.promise; }
    return resolve(tx, identity, linkUser);
  });
  const secondResponse = f.exchange(second); await entered.promise;
  const firstResponse = await f.exchange(first); release.resolve();
  const results = [firstResponse, await secondResponse]; assert.deepEqual(results.map(r => r.status), [200, 200]);
  const bodies = await Promise.all(results.map(r => r.json())); assert.deepEqual(bodies[0].session.account, bodies[1].session.account);
  assert.notEqual(bodies[0].accessToken, bodies[1].accessToken);
  const local = await f.local(); const link = await f.complete(await f.launch(await f.begin({ token: local.token })), { subject });
  const response = await f.exchange(link); assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: { code: 'SOOP_LINK_CONFLICT' } });
  assert.equal(await f.db.transactions.read(tx => tx.prisma.platform_soop.count({ where: { user_id: local.userId } })), 0);
});

test('broker denial/failure/mismatched identities fail closed; native denial uses only allowlisted error and state', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  for (const identity of [{ provider: 'apple' }, { clientId: 'different' }, { transactionId: randomUUID() }, { authenticatedAt: new Date(0).toISOString() }, { subject: '' }]) {
    const started = await f.launch(await f.begin()); const response = await f.callback(started, { identity }); assert.equal(response.status, 303);
    const url = new URL(response.headers.get('location')); assert.deepEqual([...url.searchParams.keys()], ['error', 'state']); assert.equal(url.searchParams.get('error'), 'NATIVE_CALLBACK_FAILED');
    const row = await f.db.transactions.read(tx => tx.prisma.login_transactions.findUnique({ where: { id: started.transactionId } })); assert.equal(row.status, 'FAILED'); assert.equal(row.identity_payload, null);
  }
  const denied = await f.launch(await f.begin()); const response = await f.callback(denied, { error: 'PROVIDER_DENIED' }); assert.equal(response.status, 303); assert.equal((await f.callback(denied)).status, 400);
  f.broker.failure = true; const failed = await f.launch(await f.begin()); const failure = await f.callback(failed); assert.equal(new URL(failure.headers.get('location')).searchParams.get('error'), 'NATIVE_CALLBACK_FAILED');
  assert.ok(!f.logs().includes('fixture-broker-exchange-secret'));
});

test('unconfigured broker/environment fails closed; production uses the exact production HTTPS boundary', { timeout: 20000 }, async t => {
  const disabled = await fixture(t, { broker: undefined });
  await assert.rejects(disabled.nativeFlow.start({ clientId: 'ios', intent: 'login', codeChallenge: secret(), returnState: secret() }), { code: 'AUTH_UNAVAILABLE' });
  await assert.rejects(new HttpBroker(disabled.config).request({ transactionId: randomUUID(), state: secret(), challenge: secret() }), { code: 'AUTH_UNAVAILABLE' });
  assert.equal(disabled.broker.requests.length, 0);
  const f = await fixture(t, { audience: 'rogi-production', origin: 'https://rogi.chat', callback: 'https://api.rogi.chat/v1/auth/soop/callback' });
  const started = await f.complete(await f.launch(await f.begin({ clientId: 'android' }))); assert.equal((await f.exchange(started)).status, 200);
});

test('broker start timeout or arbitrary authorization URL cannot produce a launch ticket', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const body = { clientId: 'ios', intent: 'login', codeChallenge: secret(), codeChallengeMethod: 'S256', returnState: secret(), termsVersion: '2026-09-20' };
  f.broker.requestFailure = true;
  let response = await f.call(startPath, body); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: { code: 'AUTH_UNAVAILABLE' } });
  f.broker.request = async () => 'https://evil.invalid/authorize';
  response = await f.call(startPath, body); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: { code: 'AUTH_UNAVAILABLE' } });
  assert.ok(!f.logs().includes('fixture-broker-request-secret'));
});

test('browser launch bounds pending cookies without consuming ticket and never accepts caller channel', { timeout: 20000 }, async t => {
  const f = await fixture(t); const started = await f.begin();
  const cookies = Array.from({ length: 10 }, () => `${oauthCookieName(f.config, secret())}=${secret()}`).join('; ');
  assert.equal((await f.get(started.launchPath, cookies)).status, 429);
  assert.equal((await f.get(`${started.launchPath}&channel=WEB`)).status, 400);
  assert.equal((await f.get(`${started.launchPath}&request=${secret()}`)).status, 400);
  await f.complete(await f.launch(started)); assert.equal((await f.exchange(started)).status, 200);
});

test('native exchange lost actual COMMIT acknowledgement consumes code exactly once without recoverable plaintext token', { timeout: 20000 }, async t => {
  let loseAck = false; let committed = 0;
  const original = PrismaMariaDb.prototype.connect;
  t.mock.method(PrismaMariaDb.prototype, 'connect', async function () {
    const adapter = await original.call(this); const start = adapter.startTransaction.bind(adapter);
    adapter.startTransaction = async isolation => {
      const tx = await start(isolation); const commit = tx.commit.bind(tx);
      tx.commit = async () => { await commit(); if (loseAck) { committed++; throw Object.assign(new Error('lost_commit_ack'), { code: 'P2034' }); } };
      return tx;
    }; return adapter;
  });
  const f = await fixture(t); const started = await f.complete(await f.launch(await f.begin()));
  loseAck = true;
  await assert.rejects(f.nativeFlow.exchange({ clientId: 'ios', transactionId: started.transactionId, code: started.code, codeVerifier: started.verifier }), { code: 'NATIVE_CALLBACK_FAILED' });
  loseAck = false; assert.equal(committed, 1);
  const saved = await f.db.transactions.read(tx => tx.prisma.login_transactions.findUnique({ where: { id: started.transactionId } }));
  assert.equal(saved.status, 'SUCCEEDED'); assert.equal(saved.identity_payload, null); assert.equal(saved.completion_digest, null);
  assert.equal((await f.exchange(started)).status, 400);
});

test('login account state is rechecked at final exchange and native/web callbacks cannot swap stored channel', { timeout: 20000 }, async t => {
  const f = await fixture(t); const subject = `fixture-${randomUUID()}`;
  const first = await f.complete(await f.launch(await f.begin()), { subject }); const initial = await (await f.exchange(first)).json();
  const pending = await f.complete(await f.launch(await f.begin()), { subject });
  await f.db.transactions.write(tx => tx.prisma.users.update({ where: { id: initial.session.account.userId }, data: { status: 'DELETING' } }));
  assert.equal((await f.exchange(pending)).status, 400);
  const native = await f.launch(await f.begin());
  await assert.rejects(f.flow.callback(native.request.state, f.broker.code(native.request), native.cookie.split('=')[1]), { code: 'AUTH_FAILED' });
  assert.equal(f.broker.exchanges, 2);
  await f.complete(native); assert.equal((await f.exchange(native)).status, 200);
  const browser = secret(); const web = await f.flow.start('login', browser);
  assert.equal(await f.nativeFlow.handles(web.state), false);
  await assert.rejects(f.nativeFlow.callback(web.state, browser, secret()), { code: 'NATIVE_CALLBACK_FAILED' });
  const request = f.broker.requests.at(-1); assert.ok((await f.flow.callback(web.state, f.broker.code(request), browser)).token);
});

test('native link logout before callback and after callback invalidates the bound session', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  for (const stage of ['callback', 'exchange']) {
    const local = await f.local(); const started = await f.launch(await f.begin({ token: local.token }));
    if (stage === 'exchange') await f.complete(started);
    assert.equal((await f.call('/v1/auth/logout', {}, { Authorization: `Bearer ${local.token}` })).status, 204);
    const response = stage === 'callback' ? await f.callback(started) : await f.exchange(started);
    assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: { code: 'LINK_SESSION_CHANGED' } });
    assert.equal(await f.db.transactions.read(tx => tx.prisma.platform_soop.count({ where: { user_id: local.userId } })), 0);
  }
});

test('stale or missing terms reject native link start/callback/exchange without upgrading consent or revoking the current session', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  for (const terms_version of [null, 'older-consent']) {
    for (const stage of ['start', 'callback', 'exchange']) {
      const local = await f.local(); let started;
      if (stage !== 'start') started = await f.launch(await f.begin({ token: local.token }));
      if (stage === 'exchange') await f.complete(started);
      await f.db.transactions.write(tx => tx.prisma.users.update({ where: { id: local.userId }, data: { terms_version } }));
      const response = stage === 'start'
        ? await f.call(startPath, { clientId: 'ios', intent: 'link', codeChallenge: secret(), codeChallengeMethod: 'S256', returnState: secret() }, { Authorization: `Bearer ${local.token}` })
        : stage === 'callback' ? await f.callback(started) : await f.exchange(started);
      assert.equal(response.status, 403); assert.deepEqual(await response.json(), { error: { code: 'TERMS_REQUIRED' } }); assert.equal(response.headers.get('set-cookie'), null);
      const account = await f.db.transactions.read(tx => tx.prisma.users.findUnique({ where: { id: local.userId } })); assert.equal(account.terms_version, terms_version);
      assert.equal(await f.db.transactions.read(tx => tx.prisma.auth_sessions.count({ where: { user_id: local.userId } })), 1);
      assert.equal(await f.db.transactions.read(tx => tx.prisma.platform_soop.count({ where: { user_id: local.userId } })), 0);
      assert.equal((await f.db.transactions.read(tx => f.sessions.require(tx, local.token, undefined, false, { transport: 'NATIVE', clientId: 'ios' }))).userId, local.userId);
    }
  }
});
