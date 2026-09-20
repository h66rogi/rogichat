import { IdentityGuardRepository } from '../../dist/modules/auth/identity-guard.repository.js';
import { createApi } from '../../dist/application.js';
import { SafeLogger } from '../../dist/infrastructure/observability/logging.js';
import { responseContract } from '../support/openapi-response.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { AuthService } from '../../dist/modules/auth/auth.service.js';
import { AuthFlow } from '../../dist/modules/auth/auth-flow.service.js';
import { NativeAuthService } from '../../dist/modules/auth/native-auth.service.js';
import { NativeAuthRepository } from '../../dist/modules/auth/native-auth.repository.js';
import { LoginRepository } from '../../dist/modules/auth/login.repository.js';
import { IdentityService } from '../../dist/modules/auth/identity.service.js';
import { IdentityRepository } from '../../dist/modules/auth/identity.repository.js';
import { IdentityGuardService } from '../../dist/modules/auth/identity-guard.service.js';
import { AccountDeletionRepository } from '../../dist/modules/deletion/account-deletion.repository.js';
import { AccountDeletionService } from '../../dist/modules/deletion/account-deletion.service.js';
import { DeletionApplyService } from '../../dist/modules/deletion/deletion-apply.service.js';
import { DeletionRepository } from '../../dist/modules/deletion/deletion.repository.js';
import { DeletionReplayRepository } from '../../dist/modules/deletion/deletion-replay.repository.js';
import { DeletionReconciler } from '../../dist/modules/deletion/deletion-reconciler.js';
import { accountDeletionId } from '../../dist/modules/deletion/deletion-ledger.js';
import { secret, digest } from '../../dist/modules/auth/auth-primitives.js';
import { deletionFixture } from '../support/deletion-fixture.mjs';

const guardKey = randomBytes(32); // Isolated test-only key, never product configuration.
const denied = error => [400, 401, 403, 503].includes(error.getStatus?.());
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(t, linked = true) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api'));
  const config = { audience: 'rogi-qa', origin: 'https://qa.rogi.chat', callback: 'https://api.qa.rogi.chat/v1/auth/soop/callback',
    secure: true, key: randomBytes(32), identityGuardKey: guardKey,
    broker: { baseUrl: 'https://broker.example.invalid', clientId: 'fixture-client', clientSecret: secret() } };
  const sessionsRepo = new SessionRepository(); const sessions = new SessionService(sessionsRepo, config.audience, config.key);
  const guards = new IdentityGuardService(new IdentityGuardRepository()); const accounts = new AccountDeletionRepository(); const checkpoints = new DeletionRepository();
  const identities = new IdentityService(new IdentityRepository(), config, guards);
  const { ledger, store } = deletionFixture(); const apply = new DeletionApplyService(db.transactions, undefined, checkpoints, accounts, guards);
  const auth = new AuthService(sessions, undefined, db.transactions, sessionsRepo, config);
  const remove = new AccountDeletionService(db.transactions, auth, config, guards, accounts, ledger, apply);
  const userId = randomUUID(); const identityId = randomUUID(); const subject = `fixture-${randomUUID()}`;
  const session = await db.transactions.write(async tx => {
    await tx.prisma.users.create({ data: { id: userId, terms_version: '2026-09-20', profile: { create: { nickname: '합성 탈퇴 시험' } } } });
    if (linked) await tx.prisma.platform_soop.create({ data: { id: identityId, user_id: userId, provider_subject: Buffer.from(subject), verified_at: await tx.now() } });
    return sessions.issue(tx, userId);
  });
  const requestId = accountDeletionId('qa', userId);
  const intent = async () => ({ schemaVersion: 2, environment: 'qa', scope: 'ACCOUNT', roomId: null, actorUserId: userId, targetId: userId,
    requestId, requestedAt: (await db.transactions.read(tx => tx.now())).toISOString(), subjectGuard: linked ? guards.evidence(Buffer.from(subject), identityId, guardKey) : null });
  t.after(async () => {
    await db.transactions.write(async tx => {
      await tx.prisma.account_deletion_obligations.deleteMany({ where: { user_id: userId } });
      await tx.prisma.deletion_intents.deleteMany({ where: { target_id: userId } });
      await tx.prisma.identity_subject_guards.deleteMany({ where: { key_fingerprint: Buffer.from(guards.evidence(Buffer.alloc(0), identityId, guardKey).keyFingerprint, 'hex') } });
      await tx.prisma.identity_guard_keys.deleteMany({ where: { version: 1 } });
    });
    await db.close();
  });
  return { db, config, guards, accounts, checkpoints, identities, ledger, store, apply, auth, remove, sessions, session,
    userId, identityId, subject, requestId, intent, replay: new DeletionReconciler(ledger, apply, db.transactions, new DeletionReplayRepository()),
    dueReplay: () => db.transactions.write(tx => tx.prisma.deletion_replay_entries.updateMany({ where: { source_id: ledger.sourceId }, data: { next_attempt_at: new Date(0) } })),
    identity: () => ({ schemaVersion: 1, provider: 'soop', subject, clientId: config.broker.clientId, transactionId: randomUUID(), authenticatedAt: new Date().toISOString() }) };
}

test('ACCOUNT admission requires command proof, current self and recent auth; external failure never blocks or ACKs', async t => {
  const f = await fixture(t);
  await assert.rejects(f.remove.remove({ token: f.session.token }), denied);
  await assert.rejects(f.remove.remove({ ...f.session, csrf: secret() }), denied);
  await f.db.transactions.write(tx => tx.prisma.auth_sessions.updateMany({ where: { user_id: f.userId }, data: { created_at: new Date(Date.now() - 901000) } }));
  await assert.rejects(f.remove.remove(f.session), error => error.code === 'RECENT_AUTH_REQUIRED');
  await f.db.transactions.write(tx => tx.prisma.auth_sessions.updateMany({ where: { user_id: f.userId }, data: { created_at: new Date() } }));
  f.store.fail = true;
  await assert.rejects(f.remove.remove(f.session), error => error.getStatus?.() === 503);
  const state = await f.db.transactions.read(async tx => ({ user: await tx.prisma.users.findUnique({ where: { id: f.userId } }), count: await tx.prisma.account_deletion_obligations.count({ where: { user_id: f.userId } }) }));
  assert.equal(state.user.status, 'ACTIVE'); assert.equal(state.count, 0);
});

test('durable ACCOUNT intent survives DB boundary failure and independently replays with original deadline and outstanding purge', async t => {
  const f = await fixture(t); f.store.loseAck = true;
  const apply = f.apply.apply.bind(f.apply); f.apply.apply = async () => { throw new Error('synthetic_checkpoint_crash'); };
  await assert.rejects(f.remove.remove(f.session), /synthetic_checkpoint_crash/);
  assert.equal(f.store.rows.size, 1);
  f.apply.apply = apply;
  const page = await f.replay.tick(); assert.equal(page.attempted, 1);
  const receipt = await f.ledger.readByKey([...f.store.rows.keys()][0]);
  assert.equal(receipt.intent.requestId, f.requestId);
  assert.deepEqual(await f.apply.apply(receipt), { requestId: f.requestId, status: 'blocked' });
  const state = await f.db.transactions.read(async tx => ({ user: await tx.prisma.users.findUnique({ where: { id: f.userId } }),
    obligation: await tx.prisma.account_deletion_obligations.findUnique({ where: { user_id: f.userId } }) }));
  assert.equal(state.user.status, 'DELETING'); assert.equal(state.user.membership_generation, 1n);
  assert.equal(state.obligation.state, 'BLOCKED'); assert.equal(state.obligation.live_purged_at, null);
  assert.equal(state.obligation.requested_at.toISOString(), receipt.intent.requestedAt);
  assert.equal(state.obligation.auth_not_before - state.obligation.requested_at, 600000);
  await assert.rejects(f.db.transactions.write(tx => f.auth.require(tx, f.session)), denied);
  await assert.rejects(f.remove.remove(f.session), denied); // A receipt is not new authentication.
});

test('subject guard outlives auth deadline and missing identity; missing/rotated keys fail closed', async t => {
  const f = await fixture(t); const intent = { ...await f.intent(), requestedAt: '2026-01-01T00:00:00.000Z' };
  await f.apply.apply(await f.ledger.ensureIntent(intent));
  await f.db.transactions.write(tx => tx.prisma.platform_soop.delete({ where: { user_id: f.userId } }));
  await assert.rejects(f.db.transactions.write(tx => f.identities.resolve(tx, f.identity())), denied);
  for (const key of [undefined, randomBytes(32)]) {
    const config = { ...f.config, identityGuardKey: key };
    const identities = new IdentityService(new IdentityRepository(), config, f.guards);
    await assert.rejects(f.db.transactions.write(tx => identities.resolve(tx, f.identity())), error => error.code === 'AUTH_UNAVAILABLE');
  }
  assert.equal(await f.db.transactions.read(tx => tx.prisma.platform_soop.count({ where: { provider_subject: Buffer.from(f.subject) } })), 0);
});

test('link introduced during external I/O cannot earn ACK with incomplete guard evidence', async t => {
  const f = await fixture(t, false);
  f.store.beforePut = async () => f.db.transactions.write(tx => f.identities.resolve(tx, f.identity(), f.userId));
  await assert.rejects(f.remove.remove(f.session), error => error.getStatus?.() === 503);
  const result = await f.db.transactions.read(async tx => ({ user: await tx.prisma.users.findUnique({ where: { id: f.userId } }), obligation: await tx.prisma.account_deletion_obligations.findUnique({ where: { user_id: f.userId } }) }));
  assert.equal(result.user.status, 'DELETING'); assert.equal(result.obligation.guard_coverage, false); assert.equal(result.obligation.live_purged_at, null);
  await assert.rejects(f.db.transactions.write(tx => f.identities.resolve(tx, { ...f.identity(), subject: `other-${randomUUID()}` })), denied);
});

test('legacy ACCOUNT UUID is preserved and missing guard evidence remains fail-closed/outstanding', async t => {
  const f = await fixture(t); const base = await f.intent(); delete base.subjectGuard;
  const legacy = { ...base, schemaVersion: 1, requestId: randomUUID() };
  const receipt = await f.ledger.ensureIntent(legacy);
  await f.db.transactions.write(tx => f.checkpoints.checkpoint(tx, receipt));
  await assert.rejects(f.remove.remove(f.session), error => error.getStatus?.() === 503);
  assert.equal(f.store.rows.size, 1);
  const obligation = await f.db.transactions.read(tx => tx.prisma.account_deletion_obligations.findUnique({ where: { user_id: f.userId } }));
  assert.equal(obligation.request_id, legacy.requestId); assert.equal(obligation.guard_coverage, false);
  await f.db.transactions.write(tx => tx.prisma.platform_soop.delete({ where: { user_id: f.userId } }));
  await assert.rejects(f.db.transactions.write(tx => f.identities.resolve(tx, f.identity())), error => error.code === 'AUTH_UNAVAILABLE');
});

test('two connections: guard current read defeats an older RR snapshot after account deletion', async t => {
  const f = await fixture(t); const ready = deferred(); const release = deferred();
  const delayed = f.db.transactions.write(async tx => {
    await tx.prisma.users.findUnique({ where: { id: f.userId }, select: { status: true } });
    ready.resolve(); await release.promise;
    return f.identities.resolve(tx, f.identity());
  });
  const denial = assert.rejects(delayed, denied);
  await ready.promise;
  await f.apply.apply(await f.ledger.ensureIntent(await f.intent()));
  release.resolve(); await denial;
});

test('bounded replay scrubs bound web/native secrets without consuming the physical purge obligation', async t => {
  const f = await fixture(t);
  await f.db.transactions.write(tx => tx.prisma.login_transactions.createMany({ data: Array.from({ length: 205 }, (_, index) => ({
    id: randomUUID(), user_id: f.userId, state_digest: digest(secret()), browser_digest: digest(secret()), verifier: Buffer.from('synthetic-verifier'),
    intent: 'link', audience: f.config.audience, channel: index % 2 ? 'WEB' : 'NATIVE', status: 'PROCESSING',
    launch_payload: Buffer.from('synthetic-launch'), identity_payload: Buffer.from('synthetic-identity'), expires_at: new Date(Date.now() + 600000),
  })) }));
  await f.remove.remove(f.session);
  const count = () => f.db.transactions.read(tx => tx.prisma.login_transactions.count({ where: { user_id: f.userId, status: 'PROCESSING' } }));
  assert.equal(await count(), 205);
  await f.replay.tick(); assert.equal(await count(), 205); // Apply and scrub are separately fenced transactions.
  await f.dueReplay(); await f.replay.tick(); assert.equal(await count(), 105);
  await f.dueReplay(); await f.replay.tick(); assert.equal(await count(), 5);
  await f.dueReplay(); await f.replay.tick(); assert.equal(await count(), 0);
  const rows = await f.db.transactions.read(tx => tx.prisma.login_transactions.findMany({ where: { user_id: f.userId } }));
  for (const row of rows) { assert.equal(row.verifier.length, 0); assert.equal(row.launch_payload, null); assert.equal(row.identity_payload, null); }
  assert.equal((await f.db.transactions.read(tx => tx.prisma.account_deletion_obligations.findUnique({ where: { user_id: f.userId } }))).state, 'BLOCKED');
});

function brokerFor(f) {
  return { requests: [], async request(input) { this.requests.push(input); return `https://auth.rogi.chat/v1/platform/oauth/rogichat/authorize?request=${secret()}`; },
    async exchange(input) { this.entered?.resolve(); if (this.release) await this.release.promise; return { ...f.identity(), transactionId: input.transactionId }; } };
}

test('unbound web callback and native callback/exchange cannot recreate a deleted identity', async t => {
  const f = await fixture(t); const broker = brokerFor(f); const logins = new LoginRepository();
  const web = new AuthFlow(f.sessions, f.db.transactions, f.config, broker, logins, f.identities);
  const native = new NativeAuthService(f.sessions, f.db.transactions, f.config, broker, new NativeAuthRepository(), f.identities, logins);
  const browser = secret(); const started = await web.start('login', browser);
  async function beginNative() {
    const verifier = secret(); const browser = secret();
    const start = await native.start({ clientId: 'ios', intent: 'login', codeChallenge: createHash('sha256').update(verifier).digest('base64url'), returnState: secret() });
    const launch = await native.launch(new URL(start.authorizeUrl).searchParams.get('request'), browser);
    return { start, launch, verifier, browser };
  }
  const completed = await beginNative();
  const completion = new URL(await native.callback(completed.launch.state, completed.browser, secret())).searchParams.get('code');
  assert.ok(completion);
  const late = await beginNative();
  await f.remove.remove(f.session);
  await f.db.transactions.write(tx => tx.prisma.platform_soop.delete({ where: { user_id: f.userId } }));
  await assert.rejects(web.callback(started.state, secret(), browser), denied);
  assert.equal(new URL(await native.callback(late.launch.state, late.browser, secret())).searchParams.has('error'), true);
  await assert.rejects(native.exchange({ clientId: 'ios', transactionId: completed.start.transactionId, code: completion, codeVerifier: completed.verifier }), denied);
  assert.equal(await f.db.transactions.read(tx => tx.prisma.platform_soop.count({ where: { provider_subject: Buffer.from(f.subject) } })), 0);
});


test('HTTP account route exposes only the exact blocked receipt or safe denial DTO', async t => {
  const f = await fixture(t);
  const app = await createApi(f.db, new SafeLogger('api', () => {}), undefined, { config: f.config }, undefined, 'test', { ledger: f.ledger });
  await app.listen(0, '127.0.0.1');
  try {
    const base = await app.getUrl(); const verify = responseContract(app, f.config);
    const headers = { 'Content-Type': 'application/json', Origin: f.config.origin, Cookie: `__Host-rogi_session=${f.session.token}`, 'X-CSRF-Token': f.session.csrf };
    for (const input of [{ userId: f.userId }, { requestId: randomUUID() }]) {
      const response = await fetch(`${base}/v1/me/account`, { method: 'DELETE', headers, body: JSON.stringify(input) });
      const body = await response.json(); assert.equal(response.status, 400); assert.deepEqual(body, { error: { code: 'INVALID_REQUEST' } });
      verify('DELETE', '/v1/me/account', response.status, body);
    }
    const response = await fetch(`${base}/v1/me/account`, { method: 'DELETE', headers, body: '{}' });
    const body = await response.json(); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(body, { requestId: f.requestId, status: 'blocked' }); verify('DELETE', '/v1/me/account', 200, body);
    const rejected = await fetch(`${base}/v1/me/account`, { method: 'DELETE', headers, body: '{}' });
    assert.equal(rejected.status, 401); assert.deepEqual(await rejected.json(), { error: { code: 'UNAUTHENTICATED' } });
  } finally { await app.close(); }
});

for (const channel of ['WEB', 'NATIVE']) test(`two connections: ${channel} linked callback crossing deletion commit cannot reissue auth`, async t => {
  const f = await fixture(t); const broker = brokerFor(f); const logins = new LoginRepository();
  const entered = deferred(); const release = deferred(); broker.entered = entered; broker.release = release;
  let pending;
  if (channel === 'WEB') {
    const web = new AuthFlow(f.sessions, f.db.transactions, f.config, broker, logins, f.identities);
    const browser = secret(); const start = await web.start('link', browser, f.session.token, f.session.csrf);
    pending = assert.rejects(web.callback(start.state, secret(), browser, f.session.token), denied);
  } else {
    const native = new NativeAuthService(f.sessions, f.db.transactions, f.config, broker, new NativeAuthRepository(), f.identities, logins);
    const issued = await f.db.transactions.write(tx => f.sessions.issueNative(tx, f.userId, 'ios'));
    const credentials = { transport: 'NATIVE', clientId: 'ios', token: issued.token }; const browser = secret();
    const start = await native.start({ clientId: 'ios', intent: 'link', codeChallenge: createHash('sha256').update(secret()).digest('base64url'), returnState: secret() }, credentials);
    const launch = await native.launch(new URL(start.authorizeUrl).searchParams.get('request'), browser);
    pending = native.callback(launch.state, browser, secret()).then(url => assert.equal(new URL(url).searchParams.has('error'), true));
  }
  await entered.promise;
  try { assert.deepEqual(await f.remove.remove(f.session), { requestId: f.requestId, status: 'blocked' }); }
  finally { release.resolve(); }
  await pending;
  assert.equal(await f.db.transactions.read(tx => tx.prisma.auth_sessions.count({ where: { user_id: f.userId } })), channel === 'WEB' ? 1 : 2);
});

test('legacy missing account independently replays without synthetic parents and retains the global registration barrier', async t => {
  const f = await fixture(t); const base = await f.intent(); delete base.subjectGuard;
  const legacy = { ...base, schemaVersion: 1, requestedAt: '2026-01-01T00:00:00.000Z' };
  await f.ledger.ensureIntent(legacy);
  // Isolated synthetic restore fixture only; product admission never deletes these rows.
  await f.db.transactions.write(async tx => {
    await tx.prisma.auth_sessions.deleteMany({ where: { user_id: f.userId } });
    await tx.prisma.platform_soop.deleteMany({ where: { user_id: f.userId } });
    await tx.prisma.user_profiles.deleteMany({ where: { user_id: f.userId } });
    await tx.prisma.users.delete({ where: { id: f.userId } });
  });
  await f.replay.tick(); await f.replay.tick();
  const state = await f.db.transactions.read(async tx => ({ user: await tx.prisma.users.findUnique({ where: { id: f.userId } }),
    obligation: await tx.prisma.account_deletion_obligations.findUnique({ where: { user_id: f.userId } }),
    checkpoint: await tx.prisma.deletion_intents.findUnique({ where: { request_id: f.requestId } }) }));
  assert.equal(state.user, null); assert.equal(state.checkpoint.blocked_at, null);
  assert.equal(state.obligation.guard_coverage, false); assert.equal(state.obligation.live_purged_at, null);
  assert.equal(state.obligation.requested_at.toISOString(), legacy.requestedAt);
  for (const config of [f.config, { ...f.config, identityGuardKey: undefined }]) {
    const identities = new IdentityService(new IdentityRepository(), config, f.guards);
    await assert.rejects(f.db.transactions.write(tx => identities.resolve(tx, f.identity())), error => error.code === 'AUTH_UNAVAILABLE');
  }
});

test('persistent ACCOUNT scrub failure retains its phase while a later independent ACCOUNT blocks', async t => {
  const f = await fixture(t, false);
  await f.ledger.ensureIntent(await f.intent()); await f.replay.tick(); await f.dueReplay();
  const scrub = f.accounts.scrubBindings.bind(f.accounts);
  f.accounts.scrubBindings = (tx, userId) => {
    if (userId === f.userId) throw new Error('synthetic_persistent_scrub_failure');
    return scrub(tx, userId);
  };
  const later = randomUUID();
  await f.db.transactions.write(tx => tx.prisma.users.create({ data: { id: later, terms_version: '2026-09-20' } }));
  await f.ledger.ensureIntent({ schemaVersion: 2, environment: 'qa', requestId: accountDeletionId('qa', later),
    actorUserId: later, targetId: later, scope: 'ACCOUNT', roomId: null, subjectGuard: null, requestedAt: '2026-09-20T00:00:00.000Z' });
  const result = await f.replay.tick(); assert.equal(result.failed, 1);
  const state = await f.db.transactions.read(async tx => ({
    account: await tx.prisma.users.findUnique({ where: { id: later }, select: { status: true } }),
    entries: await tx.prisma.deletion_replay_entries.findMany({ where: { source_id: f.ledger.sourceId } }),
  }));
  assert.equal(state.account.status, 'DELETING');
  const failed = state.entries.find(row => row.last_failure_code === 'SCRUB_FAILED');
  assert.equal(failed.phase, 'SCRUB'); assert.equal(failed.state, 'RETRY'); assert.ok(failed.first_failure_at);
  assert.equal(result.inventoryPassEnded, true); // Still not a global resolution claim.
});

for (const restored of ['ACTIVE', 'missing']) test(`SCRUB returns to APPLY after ${restored} account restoration and resumes bounded cleanup`, async t => {
  const f = await fixture(t, false), replayRepository = new DeletionReplayRepository();
  const restart = () => new DeletionReconciler(f.ledger, f.apply, f.db.transactions, replayRepository);
  await f.ledger.ensureIntent(await f.intent()); await restart().tick();
  const entry = () => f.db.transactions.read(tx => tx.prisma.deletion_replay_entries.findFirst({ where: {
    source_id: f.ledger.sourceId, object_key: `qa/${f.requestId}/intent.json`,
  } }));
  const initial = await entry(); assert.equal(initial.phase, 'SCRUB'); assert.ok(initial.receipt_sha256);
  await f.db.transactions.write(async tx => {
    await tx.prisma.login_transactions.createMany({ data: Array.from({ length: 205 }, () => ({
      id: randomUUID(), user_id: f.userId, state_digest: digest(secret()), browser_digest: digest(secret()), verifier: Buffer.from('synthetic-restored'),
      intent: 'link', audience: f.config.audience, status: 'PROCESSING', expires_at: new Date(Date.now() + 600000),
    })) });
    if (restored === 'ACTIVE') await tx.prisma.users.update({ where: { id: f.userId }, data: { status: 'ACTIVE' } });
    else {
      await tx.prisma.auth_sessions.deleteMany({ where: { user_id: f.userId } });
      await tx.prisma.user_profiles.deleteMany({ where: { user_id: f.userId } });
      await tx.prisma.users.delete({ where: { id: f.userId } });
    }
  });
  const count = () => f.db.transactions.read(tx => tx.prisma.login_transactions.count({ where: { user_id: f.userId, status: 'PROCESSING' } }));
  await f.dueReplay(); await restart().tick();
  assert.equal((await entry()).phase, 'APPLY'); assert.equal(await count(), 205);
  // The SCRUB transaction yields without acquiring guard/account locks or mutating that account.
  const afterYield = await f.db.transactions.read(tx => tx.prisma.users.findUnique({ where: { id: f.userId }, select: { status: true } }));
  assert.equal(afterYield?.status ?? 'missing', restored);
  if (restored === 'missing') {
    const independent = randomUUID();
    await f.db.transactions.write(tx => tx.prisma.users.create({ data: { id: independent, terms_version: '2026-09-20' } }));
    await f.ledger.ensureIntent({ schemaVersion: 2, environment: 'qa', requestId: accountDeletionId('qa', independent), actorUserId: independent,
      targetId: independent, scope: 'ACCOUNT', roomId: null, subjectGuard: null, requestedAt: '2026-09-20T00:00:00.000Z' });
    await f.dueReplay(); await restart().tick();
    assert.equal((await entry()).phase, 'APPLY'); assert.equal((await entry()).state, 'RETRY');
    assert.equal((await f.db.transactions.read(tx => tx.prisma.users.findUnique({ where: { id: independent } }))).status, 'DELETING');
    await f.db.transactions.write(tx => tx.prisma.users.create({ data: { id: f.userId, terms_version: '2026-09-20' } }));
  }
  await f.dueReplay(); await restart().tick();
  assert.equal((await f.db.transactions.read(tx => tx.prisma.users.findUnique({ where: { id: f.userId } }))).status, 'DELETING');
  assert.equal((await entry()).phase, 'SCRUB'); assert.equal((await entry()).receipt_sha256, initial.receipt_sha256);
  for (const remaining of [105, 5, 0]) {
    await f.dueReplay(); await restart().tick(); assert.equal(await count(), remaining);
  }
  assert.equal((await entry()).state, 'OBSERVED');
  assert.equal((await f.db.transactions.read(tx => tx.prisma.account_deletion_obligations.findUnique({ where: { user_id: f.userId } }))).state, 'BLOCKED');
});
