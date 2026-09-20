import { IdentityGuardRepository } from '../../dist/modules/auth/identity-guard.repository.js';
import { IdentityGuardService } from '../../dist/modules/auth/identity-guard.service.js';
import { createUser } from '../support/domain-fixture.mjs';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { IdentityService } from '../../dist/modules/auth/identity.service.js';
import { IdentityRepository } from '../../dist/modules/auth/identity.repository.js';
import { LoginRepository } from '../../dist/modules/auth/login.repository.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { digest, secret } from '../../dist/modules/auth/auth-primitives.js';
import { AuthFlow } from '../../dist/modules/auth/auth-flow.service.js';
import { oauthCookieName } from '../../dist/modules/auth/auth-context.js';
import { createApi } from '../../dist/application.js';
import { SafeLogger } from '../../dist/infrastructure/observability/logging.js';
import { responseContract } from '../support/openapi-response.mjs';

function deferred() {
  let resolve;
  return { promise: new Promise(done => { resolve = done; }), resolve: value => resolve(value) };
}

// Test-only broker: never mounted as an HTTP bypass or included in application runtime.
class FixtureBroker {
  requests = [];
  codes = new Map();
  exchanges = 0;
  requestFailure = false;
  exchangeFailure = false;
  entered;
  release;
  constructor(clientId) { this.clientId = clientId; }
  async request(input) {
    if (this.requestFailure) throw new Error('fixture-broker-request-secret-marker');
    this.requests.push(input);
    return `https://broker.example.invalid/authorize?request=${input.transactionId}`;
  }
  code(request, subject = `fixture-${randomUUID()}`, overrides = {}) {
    const code = secret();
    this.codes.set(code, { request, subject, overrides, consumed: false });
    return code;
  }
  async exchange(input) {
    this.exchanges++;
    const pending = this.codes.get(input.code);
    if (!pending || pending.consumed || pending.request.transactionId !== input.transactionId ||
        pending.request.challenge !== createHash('sha256').update(input.verifier).digest('base64url')) {
      throw new Error('fixture-broker-code-rejected');
    }
    pending.consumed = true;
    this.entered?.resolve();
    if (this.release) await this.release.promise;
    if (this.exchangeFailure) throw new Error('fixture-broker-timeout-secret-marker');
    return { schemaVersion: 1, provider: 'soop', subject: pending.subject, clientId: this.clientId,
      transactionId: input.transactionId, authenticatedAt: new Date().toISOString(), ...pending.overrides };
  }
}

async function fixture(t, withHttp = false, secure = false) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api'));
  let app;
  t.after(async () => { try { await app?.close(); } finally { await db.close(); } });
  const config = {
    audience: 'rogi-test', origin: 'http://localhost:3001', callback: 'http://127.0.0.1:3000/v1/auth/soop/callback',
    secure, key: randomBytes(32),
    broker: { baseUrl: 'https://broker.example.invalid', clientId: 'fixture-client', clientSecret: randomBytes(32).toString('hex') },
  };
  const sessions = new SessionService(new SessionRepository(), config.audience, config.key);
  const broker = new FixtureBroker(config.broker.clientId);
  const flow = new AuthFlow(sessions, db.transactions, config, broker, new LoginRepository(), new IdentityService(new IdentityRepository(), config, new IdentityGuardService(new IdentityGuardRepository())));
  let logs = '';
  if (withHttp) {
    app = await createApi(db, new SafeLogger('api', line => { logs += line; }), undefined, { sessions, flow, config });
    await app.listen(0, '127.0.0.1');
  }
  const begin = async (intent = 'login', browser = secret(), session) => {
    await flow.start(intent, browser, session?.token, session?.csrf);
    return { browser, request: broker.requests.at(-1) };
  };
  const complete = async (started, subject, overrides) => {
    const code = broker.code(started.request, subject, overrides);
    return flow.callback(started.request.state, code, started.browser);
  };
  const principal = token => db.transactions.read(tx => sessions.require(tx, token));
  const localSession = () => db.transactions.write(async tx => {
    const userId = await createUser(tx, '연결 전 합성 계정');
    await tx.prisma.users.update({ where: { id: userId }, data: { terms_version: '2026-09-20' } });
    return { userId, ...await sessions.issue(tx, userId) };
  });
  return { db, config, sessions, broker, flow, begin, complete, principal, localSession,
    verify: app ? responseContract(app, config) : undefined,
    base: app ? await app.getUrl() : undefined, logs: () => logs };
}

const errorCode = (code, status) => error => error.code === code && error.getStatus?.() === status;
function responseCookie(response, name) {
  const item = response.headers.getSetCookie().find(value => value.startsWith(`${name}=`));
  assert.ok(item, `expected ${name} cookie`);
  assert.match(item, /HttpOnly/i);
  assert.match(item, /SameSite=Lax/i);
  assert.match(item, /Path=\//i);
  assert.doesNotMatch(item, /Domain=/i);
  return item.split(';')[0];
}

test('real MySQL HTTP login/session/logout uses strict minimal DTOs, cookie binding, CSRF and exact CORS', { timeout: 20000 }, async t => {
  const f = await fixture(t, true);
  const post = (path, body, headers = {}) => fetch(`${f.base}${path}`, {
    method: 'POST', redirect: 'manual', headers: { Origin: f.config.origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const endpoint = '/v1/auth/soop/start';
  for (const body of [
    { intent: 'login' }, { intent: 'login', termsVersion: 'unaccepted' },
    { intent: 'login', termsVersion: '2026-09-20', userId: randomUUID(), role: 'owner' },
  ]) {
    const response = await post(endpoint, body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: { code: 'INVALID_REQUEST' } });
  }
  const body = { intent: 'login', termsVersion: '2026-09-20' };
  let response = await post(endpoint, body, { Origin: 'https://evil.invalid' });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  response = await post(endpoint, body);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), f.config.origin);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const started = await response.json();
  assert.deepEqual(Object.keys(started), ['authorizeUrl']);
  const request = f.broker.requests.at(-1);
  const browserCookie = responseCookie(response, oauthCookieName(f.config, request.state));
  const subject = `fixture-http-${randomUUID()}`;
  const code = f.broker.code(request, subject);
  response = await fetch(`${f.base}/v1/auth/soop/callback?state=${request.state}&code=${code}`, {
    redirect: 'manual', headers: { Cookie: browserCookie },
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), `${f.config.origin}/`);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const sessionCookie = responseCookie(response, 'rogi_session');
  response = await fetch(`${f.base}/v1/auth/session`, { headers: { Cookie: sessionCookie, Origin: f.config.origin } });
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.deepEqual(Object.keys(status).sort(), ['accountPartition', 'authenticated', 'capabilities', 'csrfToken', 'onboardingState', 'soopLinkStatus']);
  assert.match(status.accountPartition, /^[A-Za-z0-9_-]{43}$/);
  f.verify('GET', '/v1/auth/session', response.status, status);
  assert.equal(status.authenticated, true);
  assert.equal(status.soopLinkStatus, 'VERIFIED');
  assert.match(status.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  const token = sessionCookie.slice('rogi_session='.length);
  const principal = await f.principal(token);
  const [account] = await f.db.transactions.read(tx => tx.rows('SELECT terms_version FROM users WHERE id=?', [principal.userId]));
  assert.equal(account.terms_version, '2026-09-20');
  response = await post('/v1/auth/logout', {}, { Cookie: sessionCookie, 'X-CSRF-Token': secret() });
  assert.equal(response.status, 403);
  assert.equal((await f.principal(token)).userId, principal.userId);
  response = await post('/v1/auth/logout', {}, { Cookie: sessionCookie });
  assert.equal(response.status, 400);
  response = await post('/v1/auth/logout', { userId: principal.userId }, { Cookie: sessionCookie, 'X-CSRF-Token': status.csrfToken });
  assert.equal(response.status, 400);
  response = await fetch(`${f.base}/v1/auth/session`, { headers: { Cookie: `${sessionCookie}; ${sessionCookie}` } });
  assert.equal(response.status, 400);
  response = await fetch(`${f.base}/v1/auth/session`, { method: 'OPTIONS', headers: {
    Origin: f.config.origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-csrf-token',
  } });
  assert.equal(response.status, 204);
  response = await fetch(`${f.base}/v1/auth/session`, { method: 'OPTIONS', headers: {
    Origin: f.config.origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization',
  } });
  assert.equal(response.status, 403);
  response = await post('/v1/auth/logout', {}, { Cookie: sessionCookie, 'X-CSRF-Token': status.csrfToken });
  assert.equal(response.status, 204);
  await assert.rejects(f.principal(token), errorCode('UNAUTHENTICATED', 401));
  response = await fetch(`${f.base}/v1/auth/session`, { headers: { Cookie: sessionCookie } });
  assert.deepEqual(await response.json(), { error: { code: 'UNAUTHENTICATED' } });
  for (const value of [request.state, code, token, subject, f.config.broker.clientSecret, 'secret-marker']) assert.ok(!f.logs().includes(value));
});

test('state/browser/audience binding and one-time callback claims reject tampering, replay and concurrent consumption', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const started = await f.begin();
  const code = f.broker.code(started.request);
  await assert.rejects(f.flow.callback(secret(), code, started.browser), errorCode('AUTH_FAILED', 400));
  await assert.rejects(f.flow.callback(started.request.state, code, secret()), errorCode('AUTH_FAILED', 400));
  const otherConfig = { ...f.config, audience: 'rogi-other-environment' };
  const otherSessions = new SessionService(new SessionRepository(), otherConfig.audience, otherConfig.key);
  const otherFlow = new AuthFlow(otherSessions, f.db.transactions, otherConfig, f.broker, new LoginRepository(), new IdentityService(new IdentityRepository(), otherConfig, new IdentityGuardService(new IdentityGuardRepository())));
  await assert.rejects(otherFlow.callback(started.request.state, code, started.browser), errorCode('AUTH_FAILED', 400));
  assert.equal(f.broker.exchanges, 0);
  const results = await Promise.allSettled([
    f.flow.callback(started.request.state, code, started.browser),
    f.flow.callback(started.request.state, code, started.browser),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal(f.broker.exchanges, 1);
  await assert.rejects(f.flow.callback(started.request.state, code, started.browser), errorCode('AUTH_FAILED', 400));
  const session = results.find(result => result.status === 'fulfilled').value;
  await assert.rejects(f.db.transactions.read(tx => otherSessions.require(tx, session.token)), errorCode('UNAUTHENTICATED', 401));
  const [login] = await f.db.transactions.read(tx => tx.rows('SELECT user_id,status,LENGTH(verifier) AS verifier_size FROM login_transactions WHERE id=?', [started.request.transactionId]));
  assert.equal(login.status, 'SUCCEEDED');
  assert.equal(login.user_id, (await f.principal(session.token)).userId);
  assert.equal(Number(login.verifier_size), 0);
});

test('broker client/provider/transaction/freshness mismatch, denied codes and reported timeout cannot issue sessions', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  for (const overrides of [
    { clientId: 'different-environment-client' }, { provider: 'wrong-provider' },
    { transactionId: randomUUID() }, { schemaVersion: 2 },
    { authenticatedAt: new Date(Date.now() - 600000).toISOString() }, { authenticatedAt: 'not-a-date' },
  ]) {
    const started = await f.begin();
    await assert.rejects(f.complete(started, undefined, overrides), errorCode('AUTH_FAILED', 400));
    const [row] = await f.db.transactions.read(tx => tx.rows('SELECT user_id,status,LENGTH(verifier) AS verifier_size FROM login_transactions WHERE id=?', [started.request.transactionId]));
    assert.equal(row.status, 'FAILED');
    assert.equal(Number(row.verifier_size), 0);
  }
  let started = await f.begin();
  await assert.rejects(f.flow.callback(started.request.state, secret(), started.browser), errorCode('AUTH_FAILED', 400));
  f.broker.exchangeFailure = true;
  started = await f.begin();
  await assert.rejects(f.complete(started), errorCode('AUTH_FAILED', 400));
  f.broker.exchangeFailure = false;
  f.broker.requestFailure = true;
  await assert.rejects(f.begin(), errorCode('AUTH_UNAVAILABLE', 503));
});

test('expired transactions, expired sessions and suspended accounts fail closed without relinking identity', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const expired = await f.begin();
  await f.db.transactions.write(tx => tx.execute('UPDATE login_transactions SET expires_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE id=?', [expired.request.transactionId]));
  await assert.rejects(f.complete(expired), errorCode('AUTH_FAILED', 400));
  const subject = `fixture-suspension-${randomUUID()}`;
  const valid = await f.complete(await f.begin(), subject);
  const principal = await f.principal(valid.token);
  await f.db.transactions.write(tx => tx.execute('UPDATE users SET status=? WHERE id=?', ['SUSPENDED', principal.userId]));
  await assert.rejects(f.principal(valid.token), errorCode('UNAUTHENTICATED', 401));
  await assert.rejects(f.complete(await f.begin(), subject), errorCode('AUTH_FAILED', 400));
  const [mapping] = await f.db.transactions.read(tx => tx.rows('SELECT user_id FROM platform_soop WHERE provider_subject=?', [Buffer.from(subject)]));
  assert.equal(mapping.user_id, principal.userId);
  const temporary = await f.localSession();
  await f.db.transactions.write(tx => tx.execute('UPDATE auth_sessions SET expires_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE token_digest=?', [digest(temporary.token)]));
  await assert.rejects(f.principal(temporary.token), errorCode('UNAUTHENTICATED', 401));
});

test('link requires CSRF/recent session, rotates successful sessions, rejects account changes and cannot race logout', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const local = await f.localSession();
  await assert.rejects(f.db.transactions.read(tx => f.sessions.require(tx, local.token, undefined, true)), errorCode('SOOP_LINK_REQUIRED', 403));
  await assert.rejects(f.flow.start('link', secret(), local.token, secret()), errorCode('FORBIDDEN', 403));
  let started = await f.begin('link', secret(), local);
  let code = f.broker.code(started.request);
  const swapped = await f.localSession();
  await assert.rejects(f.flow.callback(started.request.state, code, started.browser, swapped.token), errorCode('AUTH_FAILED', 400));
  const linked = await f.flow.callback(started.request.state, code, started.browser, local.token);
  assert.equal((await f.principal(linked.token)).userId, local.userId);
  assert.equal((await f.principal(linked.token)).soopLinked, true);
  await assert.rejects(f.principal(local.token), errorCode('UNAUTHENTICATED', 401));
  const old = await f.localSession();
  await f.db.transactions.write(tx => tx.execute('UPDATE auth_sessions SET created_at=TIMESTAMPADD(MINUTE,-16,UTC_TIMESTAMP(3)) WHERE token_digest=?', [digest(old.token)]));
  await assert.rejects(f.begin('link', secret(), old), errorCode('RECENT_AUTH_REQUIRED', 403));
  const revoking = await f.localSession();
  started = await f.begin('link', secret(), revoking);
  code = f.broker.code(started.request);
  f.broker.entered = deferred(); f.broker.release = deferred();
  const callback = f.flow.callback(started.request.state, code, started.browser, revoking.token);
  const denied = assert.rejects(callback, errorCode('AUTH_FAILED', 400));
  await f.broker.entered.promise;
  await f.db.transactions.write(tx => f.sessions.revoke(tx, revoking.token, revoking.csrf));
  f.broker.release.resolve();
  await denied;
  const links = await f.db.transactions.read(tx => tx.rows('SELECT id FROM platform_soop WHERE user_id=?', [revoking.userId]));
  assert.equal(links.length, 0);
});

test('two concurrent first logins share one canonical identity and a link cannot steal it', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const first = await f.begin();
  const second = await f.begin();
  const subject = `fixture-unique-${randomUUID()}`;
  const codes = [f.broker.code(first.request, subject), f.broker.code(second.request, subject)];
  const sessions = await Promise.all([
    f.flow.callback(first.request.state, codes[0], first.browser),
    f.flow.callback(second.request.state, codes[1], second.browser),
  ]);
  const principals = await Promise.all(sessions.map(session => f.principal(session.token)));
  assert.equal(principals[0].userId, principals[1].userId);
  assert.notEqual(principals[0].sessionId, principals[1].sessionId);
  const mappings = await f.db.transactions.read(tx => tx.rows('SELECT user_id FROM platform_soop WHERE provider_subject=?', [Buffer.from(subject)]));
  assert.equal(mappings.length, 1);
  const other = await f.localSession();
  const link = await f.begin('link', secret(), other);
  await assert.rejects(f.flow.callback(link.request.state, f.broker.code(link.request, subject), link.browser, other.token), errorCode('SOOP_LINK_CONFLICT', 409));
  assert.equal((await f.principal(other.token)).soopLinked, false);
  assert.equal((await f.principal(sessions[0].token)).userId, mappings[0].user_id);
});

test('first-login tabs keep separate cookies under reversed response order and reject browser/state swaps', { timeout: 20000 }, async t => {
  const f = await fixture(t, true);
  const start = () => fetch(`${f.base}/v1/auth/soop/start`, {
    method: 'POST', headers: { Origin: f.config.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent: 'login', termsVersion: '2026-09-20' }),
  });
  const responses = await Promise.all([start(), start()]);
  const tabs = [];
  for (const response of responses) {
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(Object.keys(body), ['authorizeUrl']);
    const id = new URL(body.authorizeUrl).searchParams.get('request');
    const request = f.broker.requests.find(value => value.transactionId === id);
    tabs.push({ request, name: oauthCookieName(f.config, request.state),
      cookie: responseCookie(response, oauthCookieName(f.config, request.state)), code: f.broker.code(request) });
  }
  assert.notEqual(tabs[0].name, tabs[1].name);
  // Browser applies the last network response first: each cookie must survive either ordering.
  const jar = new Map();
  for (const tab of [...tabs].reverse()) jar.set(tab.name, tab.cookie);
  const call = (tab, cookie) => fetch(`${f.base}/v1/auth/soop/callback?state=${tab.request.state}&code=${tab.code}`, {
    redirect: 'manual', headers: { Cookie: cookie },
  });
  let response = await call(tabs[0], tabs[1].cookie);
  assert.equal(response.status, 400);
  response = await call(tabs[0], `${tabs[0].name}=${tabs[1].cookie.split('=')[1]}`);
  assert.equal(response.status, 400);
  response = await call(tabs[0], `${tabs[0].name}=${secret()}`);
  assert.equal(response.status, 400);
  assert.equal(f.broker.exchanges, 0);
  for (const tab of tabs) {
    response = await call(tab, [...jar.values()].join('; '));
    assert.equal(response.status, 303);
    const cleared = response.headers.getSetCookie().filter(value => value.startsWith(`${tab.name}=`));
    assert.equal(cleared.length, 1);
    assert.match(cleared[0], /Expires=Thu, 01 Jan 1970/);
    assert.ok(!response.headers.getSetCookie().some(value => value.startsWith(`${tabs.find(other => other !== tab).name}=`)));
    jar.delete(tab.name);
  }
  assert.equal(f.broker.exchanges, 2);
});

test('denied OAuth clears only its cookie, consumes state, and start bounds supplied outstanding cookies', { timeout: 20000 }, async t => {
  const f = await fixture(t, true);
  const post = cookies => fetch(`${f.base}/v1/auth/soop/start`, {
    method: 'POST', headers: { Origin: f.config.origin, 'Content-Type': 'application/json', ...(cookies ? { Cookie: cookies } : {}) },
    body: JSON.stringify({ intent: 'login', termsVersion: '2026-09-20' }),
  });
  for (const reason of ['PROVIDER_DENIED', 'PROVIDER_AUTH_FAILED']) {
    const start = await post(); assert.equal(start.status, 200);
    const request = f.broker.requests.at(-1);
    const name = oauthCookieName(f.config, request.state);
    const cookie = responseCookie(start, name);
    const url = `${f.base}/v1/auth/soop/callback?state=${request.state}&error=${reason}`;
    let response = await fetch(url, { redirect: 'manual', headers: { Cookie: cookie } });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `${f.config.origin}/auth/login?error=AUTH_FAILED`);
    assert.equal(response.headers.getSetCookie().length, 1);
    assert.match(response.headers.getSetCookie()[0], /Expires=Thu, 01 Jan 1970/);
    const [row] = await f.db.transactions.read(tx => tx.rows('SELECT status,LENGTH(verifier) AS size FROM login_transactions WHERE id=?', [request.transactionId]));
    assert.equal(row.status, 'FAILED'); assert.equal(Number(row.size), 0);
    response = await fetch(url, { redirect: 'manual', headers: { Cookie: cookie } });
    assert.equal(response.status, 400);
  }
  assert.equal(f.broker.exchanges, 0);
  const outstanding = Array.from({ length: 10 }, () => `${oauthCookieName(f.config, secret())}=${secret()}`);
  let response = await post(outstanding.join('; '));
  assert.equal(response.status, 429);
  assert.equal(f.broker.requests.length, 2);
  response = await post(outstanding.slice(0, 9).join('; '));
  assert.equal(response.status, 200);
  response = await post(`unrelated=${'x'.repeat(8192)}`);
  assert.equal(response.status, 400);
});

test('one-hop hosted client rate buckets are independent; direct local forwarding spoof cannot bypass limits', { timeout: 20000 }, async t => {
  for (const secure of [false, true]) {
    const f = await fixture(t, true, secure);
    const call = forwarded => fetch(`${f.base}/v1/auth/soop/callback?state=invalid`, {
      redirect: 'manual', headers: { 'X-Forwarded-For': forwarded },
    });
    for (let index = 0; index < 30; index++) {
      const response = await call('198.51.100.1'); assert.equal(response.status, 400);
    }
    assert.equal((await call('198.51.100.1')).status, 429);
    // Hosted ingress tests represent Caddy's overwritten header. Local ingress ignores it entirely.
    assert.equal((await call('198.51.100.2')).status, secure ? 400 : 429);
    // A prepended attacker-controlled entry is not trusted beyond the single proxy hop.
    assert.equal((await call('203.0.113.9, 198.51.100.1')).status, 429);
  }
});
