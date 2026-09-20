import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { AppleService } from '../../dist/modules/auth/apple/apple.service.js';
import { AppleRepository } from '../../dist/modules/auth/apple/apple.repository.js';
import { AppleProvider } from '../../dist/modules/auth/apple/apple-provider.js';
import { AppleLifecycleRepository } from '../../dist/modules/auth/apple/apple-lifecycle.repository.js';
import { AppleLifecycleService } from '../../dist/modules/auth/apple/apple-lifecycle.service.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { LoginRepository } from '../../dist/modules/auth/login.repository.js';
import { IdentityGuardService } from '../../dist/modules/auth/identity-guard.service.js';
import { IdentityGuardRepository } from '../../dist/modules/auth/identity-guard.repository.js';
import { IdentityRepository } from '../../dist/modules/auth/identity.repository.js';
import { IdentityService } from '../../dist/modules/auth/identity.service.js';
import { AuthService } from '../../dist/modules/auth/auth.service.js';
import { AccountDeletionService } from '../../dist/modules/deletion/account-deletion.service.js';
import { AccountDeletionRepository } from '../../dist/modules/deletion/account-deletion.repository.js';
import { DeletionApplyService } from '../../dist/modules/deletion/deletion-apply.service.js';
import { DeletionRepository } from '../../dist/modules/deletion/deletion.repository.js';
import { deletionFixture } from '../support/deletion-fixture.mjs';
import { appleFixture } from '../support/apple-fixture.mjs';
import { createApi } from '../../dist/application.js';
import { SafeLogger } from '../../dist/infrastructure/observability/logging.js';

const secret = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('base64url');
const denied = code => error => error.code === code;
const guardKey = randomBytes(32);
async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api')); const providerFixture = appleFixture();
  const config = { audience: 'rogi-qa', origin: 'https://qa.rogi.chat', callback: 'https://api.qa.rogi.chat/v1/auth/soop/callback',
    secure: false, key: randomBytes(32), identityGuardKey: guardKey, apple: providerFixture.config, broker: undefined };
  const repository = new AppleRepository(); const sessionRepo = new SessionRepository(); const sessions = new SessionService(sessionRepo, config.audience, config.key);
  const guards = new IdentityGuardService(new IdentityGuardRepository()); const provider = new AppleProvider(config.apple, providerFixture.request);
  const service = new AppleService(config, db.transactions, repository, provider, sessions, new LoginRepository(), guards);
  const lifecycle = new AppleLifecycleService(db.transactions, new AppleLifecycleRepository(), repository, provider, guards, config);
  const soop = new IdentityService(new IdentityRepository(), config, guards); const auth = new AuthService(sessions, undefined, db.transactions, sessionRepo, config);
  t.after(async () => {
    await db.transactions.write(async tx => {
      await tx.prisma.identity_subject_guards.deleteMany({ where: { key_fingerprint: Buffer.from(guards.evidence(Buffer.alloc(0), randomUUID(), guardKey).keyFingerprint, 'hex') } });
      await tx.prisma.identity_guard_keys.deleteMany({ where: { version: 1 } });
    });
    await db.close();
  });
  const start = async (client = 'ios', intent = 'login', credentials) => {
    const verifier = secret(); const input = { clientId: client, intent, codeChallenge: hash(verifier), returnState: secret(), ...(intent === 'login' ? { termsVersion: '2026-09-20' } : {}) };
    return { ...await service.start(input, credentials), verifier, input };
  };
  const login = async (client = 'ios', subject, credentials, intent = 'login') => {
    const pending = await start(client, intent, credentials); const proof = providerFixture.code(client, pending.nonce, subject);
    let code;
    if (client === 'ios') ({ code } = await service.nativeComplete({ transactionId: pending.transactionId, state: pending.state, authorizationCode: proof.code, identityToken: proof.identityToken, codeVerifier: pending.verifier }, credentials));
    else code = new URL(await service.callback(pending.state, proof.code)).searchParams.get('code');
    return { ...await service.exchange({ clientId: client, transactionId: pending.transactionId, code, codeVerifier: pending.verifier }, credentials), subject: proof.subject, pending };
  };
  const credentials = result => ({ transport: 'NATIVE', clientId: 'ios', token: result.accessToken });
  return { db, config, providerFixture, service, lifecycle, sessions, sessionRepo, guards, soop, auth, start, login, credentials };
}

test('Apple native/Services ID share only explicitly scoped identity; restricted account requires verified SOOP', async t => {
  const f = await fixture(t); const first = await f.login();
  assert.equal(first.session.soopLinkStatus, 'REQUIRED'); assert.equal(first.session.capabilities.chat, false);
  const userId = first.session.account.userId;
  const second = await f.login('android', first.subject); assert.equal(second.session.account.userId, userId);
  await assert.rejects(f.db.transactions.read(tx => f.auth.require(tx, f.credentials(first), true)), denied('SOOP_LINK_REQUIRED'));
  const subject = `soop-${randomUUID()}`;
  const soopProof = { schemaVersion: 1, provider: 'soop', subject, clientId: 'fixture', transactionId: randomUUID(), authenticatedAt: new Date().toISOString() };
  await f.db.transactions.write(async tx => { await f.auth.require(tx, f.credentials(first)); assert.equal(await f.soop.resolve(tx, soopProof, userId), userId); });
  const linked = await f.login('ios', first.subject); assert.equal(linked.session.soopLinkStatus, 'VERIFIED');
  assert.equal(await f.db.transactions.write(tx => f.soop.resolve(tx, soopProof)), userId);
  await f.db.transactions.write(tx => tx.prisma.platform_soop.update({ where: { user_id: userId }, data: { status: 'REVOKED' } }));
  await assert.rejects(f.db.transactions.read(tx => f.auth.require(tx, f.credentials(linked), true)), denied('SOOP_LINK_REQUIRED'));
  assert.equal(await f.db.transactions.write(tx => f.soop.resolve(tx, soopProof, userId)), userId);
});

test('completion and authorization code replay, wrong app/S256/state fail without consuming rightful proof', async t => {
  const f = await fixture(t); const p = await f.start(); const proof = f.providerFixture.code('ios', p.nonce);
  const input = { transactionId: p.transactionId, state: p.state, authorizationCode: proof.code, identityToken: proof.identityToken, codeVerifier: p.verifier };
  await assert.rejects(f.service.nativeComplete({ ...input, state: secret() }), denied('AUTH_FAILED'));
  const { code } = await f.service.nativeComplete(input);
  await assert.rejects(f.service.nativeComplete(input), denied('AUTH_FAILED'));
  const exchange = { clientId: 'ios', transactionId: p.transactionId, code, codeVerifier: p.verifier };
  await assert.rejects(f.service.exchange({ ...exchange, clientId: 'android' }), denied('AUTH_FAILED'));
  await assert.rejects(f.service.exchange({ ...exchange, codeVerifier: secret() }), denied('AUTH_FAILED'));
  const session = await f.service.exchange(exchange); assert.equal(session.session.soopLinkStatus, 'REQUIRED');
  await assert.rejects(f.service.exchange(exchange), denied('AUTH_FAILED'));
});

test('explicit Apple link never transfers an identity and rejects changed/logout/generation-bound sessions', async t => {
  const f = await fixture(t); const first = await f.login(); const other = await f.login();
  await assert.rejects(f.login('ios', first.subject, f.credentials(other), 'link'), denied('APPLE_LINK_CONFLICT'));
  for (const change of ['logout', 'generation', 'replacement']) {
    const user = await f.login(); const credentials = f.credentials(user); const p = await f.start('ios', 'link', credentials);
    const proof = f.providerFixture.code('ios', p.nonce);
    if (change === 'logout') await f.auth.logout(credentials);
    if (change === 'generation') await f.db.transactions.write(tx => tx.prisma.users.update({ where: { id: user.session.account.userId }, data: { membership_generation: { increment: 1n } } }));
    await assert.rejects(f.service.nativeComplete({ transactionId: p.transactionId, state: p.state, authorizationCode: proof.code,
      identityToken: proof.identityToken, codeVerifier: p.verifier }, change === 'replacement' ? f.credentials(other) : credentials));
  }
});

test('SOOP-account recovery explicitly adds Apple without restricted-account merge', async t => {
  const f = await fixture(t); const soopProof = { schemaVersion: 1, provider: 'soop', subject: `test-${randomUUID()}` };
  const userId = await f.db.transactions.write(tx => f.soop.resolve(tx, soopProof));
  const issued = await f.db.transactions.write(async tx => {
    await tx.prisma.users.update({ where: { id: userId }, data: { terms_version: '2026-09-20' } }); return f.sessions.issueNative(tx, userId, 'ios');
  });
  const result = await f.login('ios', undefined, { transport: 'NATIVE', clientId: 'ios', token: issued.token }, 'link');
  assert.equal(result.session.account.userId, userId); assert.equal(result.session.soopLinkStatus, 'VERIFIED');
  assert.equal((await f.login('android', result.subject)).session.account.userId, userId);
});

test('signed revocation invalidates sessions and in-flight proofs without deleting SOOP account; replay is idempotent', async t => {
  const f = await fixture(t); const user = await f.login(); const p = await f.start(); const proof = f.providerFixture.code('ios', p.nonce, user.subject);
  const complete = await f.service.nativeComplete({ transactionId: p.transactionId, state: p.state, authorizationCode: proof.code, identityToken: proof.identityToken, codeVerifier: p.verifier });
  const now = Math.floor(Date.now() / 1000); const event = f.providerFixture.jwt({ iss: 'https://appleid.apple.com', aud: f.config.apple.clients.web.audience,
    iat: now, jti: randomUUID(), events: { type: 'consent-revoked', sub: user.subject, event_time: now } });
  await f.lifecycle.notification(event); await f.lifecycle.notification(event);
  await assert.rejects(f.db.transactions.read(tx => f.auth.require(tx, f.credentials(user))), denied('UNAUTHENTICATED'));
  await assert.rejects(f.service.exchange({ clientId: 'ios', transactionId: p.transactionId, code: complete.code, codeVerifier: p.verifier }), denied('AUTH_FAILED'));
  const account = await f.db.transactions.read(tx => tx.prisma.users.findUnique({ where: { id: user.session.account.userId }, select: { status: true } })); assert.equal(account.status, 'ACTIVE');
  f.providerFixture.failRevoke = true; assert.equal((await f.lifecycle.revokeStep()).unavailable, true);
  await f.db.transactions.write(tx => tx.prisma.apple_provider_credentials.updateMany({ where: { user_id: user.session.account.userId }, data: { available_at: new Date(0) } }));
  f.providerFixture.failRevoke = false; assert.equal((await f.lifecycle.revokeStep()).unavailable, false);
});

test('Apple-only account deletion records v3 guards and blocks late login, without falsely closing provider obligations', async t => {
  const f = await fixture(t); const user = await f.login(); const { ledger } = deletionFixture();
  const accountRepository = new AccountDeletionRepository(); const apply = new DeletionApplyService(f.db.transactions, undefined, new DeletionRepository(), accountRepository, f.guards);
  const remove = new AccountDeletionService(f.db.transactions, f.auth, f.config, f.guards, accountRepository, ledger, apply);
  const deleted = await remove.remove(f.credentials(user)); assert.equal(deleted.status, 'blocked');
  const receipt = await ledger.readByKey(`qa/${deleted.requestId}/intent.json`);
  assert.equal(receipt.intent.schemaVersion, 3); assert.equal(receipt.intent.subjectGuards[0].provider, 'apple');
  await assert.rejects(f.login('ios', user.subject));
  const pending = await f.db.transactions.write(tx => f.lifecycle.purgeAccount(tx, receipt)); assert.equal(pending.hasMore, true);
});

test('real Nest HTTP account/room/session gates work with Apple issued restricted credential and optional config absent', async t => {
  const f = await fixture(t); const user = await f.login();
  const app = await createApi(f.db, new SafeLogger('api', () => {}), undefined, { config: { ...f.config, apple: undefined } });
  t.after(() => app.close()); await app.listen(0, '127.0.0.1'); const origin = await app.getUrl();
  const headers = { authorization: `Bearer ${user.accessToken}`, 'x-rogi-client': 'ios' };
  const me = await fetch(`${origin}/v1/me/profile`, { headers }); assert.equal(me.status, 200); assert.equal((await me.json()).onboardingState, 'SOOP_LINK_REQUIRED');
  for (const path of ['/v1/rooms', '/v1/sync']) {
    const response = await fetch(`${origin}${path}`, { headers }); assert.equal(response.status, 403, path); assert.equal((await response.json()).error.code, 'SOOP_LINK_REQUIRED');
  }
  const disabled = await fetch(`${origin}/v1/auth/apple/start`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-rogi-client': 'ios' },
    body: JSON.stringify({ clientId: 'ios', intent: 'login', codeChallenge: hash(secret()), returnState: secret(), termsVersion: '2026-09-20' }) }); assert.equal(disabled.status, 503);
});


test('concurrent native and Services ID first login converge, while different registered scope cannot auto-merge', async t => {
  const f = await fixture(t); const subject = `same-${randomUUID()}`;
  const results = await Promise.all([f.login('ios', subject), f.login('android', subject)]);
  assert.equal(results[0].session.account.userId, results[1].session.account.userId);
  f.config.apple.clients.android.scope = 'other-primary';
  const isolated = await f.login('android', subject);
  assert.notEqual(isolated.session.account.userId, results[0].session.account.userId);
});

test('notification before first account blocks an already verified completion', async t => {
  const f = await fixture(t); const p = await f.start(); const proof = f.providerFixture.code('ios', p.nonce);
  const completion = await f.service.nativeComplete({ transactionId: p.transactionId, state: p.state, authorizationCode: proof.code,
    identityToken: proof.identityToken, codeVerifier: p.verifier });
  const now = Math.floor(Date.now() / 1000);
  await f.lifecycle.notification(f.providerFixture.jwt({ iss: 'https://appleid.apple.com', aud: f.config.apple.clients.ios.audience,
    iat: now, jti: randomUUID(), events: { type: 'account-deleted', sub: proof.subject, event_time: now } }));
  await assert.rejects(f.service.exchange({ clientId: 'ios', transactionId: p.transactionId, code: completion.code, codeVerifier: p.verifier }), denied('AUTH_FAILED'));
});


test('HTTP Apple iOS start/complete/exchange uses the same real provider verifier and returns exact native session DTO', async t => {
  const f = await fixture(t);
  const app = await createApi(f.db, new SafeLogger('api', () => {}), undefined, { config: f.config, appleProvider: new AppleProvider(f.config.apple, f.providerFixture.request) });
  t.after(() => app.close()); await app.listen(0, '127.0.0.1'); const origin = await app.getUrl();
  const send = async (path, body) => {
    const response = await fetch(`${origin}/v1/auth/apple/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-rogi-client': 'ios' }, body: JSON.stringify(body) });
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
  };
  const verifier = secret(); const pending = await send('start', { clientId: 'ios', intent: 'login', codeChallenge: hash(verifier), returnState: secret(), termsVersion: '2026-09-20' });
  const proof = f.providerFixture.code('ios', pending.nonce);
  const completion = await send('native/complete', { transactionId: pending.transactionId, state: pending.state, authorizationCode: proof.code, identityToken: proof.identityToken, codeVerifier: verifier });
  const issued = await send('exchange', { clientId: 'ios', transactionId: pending.transactionId, code: completion.code, codeVerifier: verifier });
  assert.equal(issued.tokenType, 'Bearer'); assert.equal(issued.session.soopLinkStatus, 'REQUIRED');
  assert.deepEqual(Object.keys(issued).sort(), ['accessToken', 'expiresAt', 'session', 'tokenType']);
  const restored = await fetch(`${origin}/v1/auth/session`, { headers: { authorization: `Bearer ${issued.accessToken}`, 'x-rogi-client': 'ios' } });
  assert.deepEqual(await restored.json(), issued.session);
});
