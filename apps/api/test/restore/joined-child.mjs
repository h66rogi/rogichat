// Runs only inside the reviewed disposable Linux read-only storage namespace.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createHash, createPrivateKey, createPublicKey, randomUUID, sign } from 'node:crypto';
import { readFile, writeFile, chmod, rename, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deserialize } from 'node:v8';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createConnection } from 'mysql2/promise';
import { createIsolationAuthority } from '../support/restore-driver/restore_isolation.mjs';
import { canonical } from '../support/restore-driver/restore_proof.mjs';
import { validateMediaConfig } from '../support/restore-driver/restore_fixture_media.mjs';
import { executeIsolated } from '../support/restore-driver/restore_backend_driver.mjs';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { authorizationKey } from '../../dist/infrastructure/config/authorization-epoch.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { AppleSeal } from '../../dist/modules/auth/apple/apple-seal.js';
import { joinRoom, assignRoomOwner } from '../support/domain-fixture.mjs';
import { startApi, request } from './http-fixture.mjs';
const exec = promisify(execFile), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { outcome: 'failed', phase: 'initialize', rejected: [], timingsMs: {} };
let admin, authority, db, api;
function envelope(payload, privatePem) {
  const key = createPrivateKey(privatePem), bytes = Buffer.from(canonical(payload));
  return { payloadBase64: bytes.toString('base64'), signatureBase64: sign(null, bytes, key).toString('base64'), keyId: sha(createPublicKey(key).export({ type: 'spki', format: 'der' })) };
}
async function rejected(name, operation) { report.phase = name; await assert.rejects(operation); report.rejected.push(name); }
async function main() {
  assert.equal(process.platform, 'linux'); assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const fixture = deserialize(await readFile(process.env.M12_RESTORE_FIXTURE_FILE)), directory = fixture.directory;
  const [owner, member, deleted] = fixture.people;
  const json = async (name, value) => { const path = join(directory, name); await writeFile(path, canonical(value), { mode: 0o600 }); return path; };
  const media = { root: process.env.RESTORE_READONLY_ROOT, accountId: '0'.repeat(32), bucket: 'synthetic-restored-media', prefix: 'qa' };
  const storageScopeSha256 = validateMediaConfig(media), firstPath = join(media.root, fixture.media[0].object_key);
  for (const [name, operation] of [['kernel-write-denied', () => writeFile(firstPath, 'overwrite')], ['kernel-chmod-denied', () => chmod(firstPath, 0o644)], ['kernel-rename-denied', () => rename(firstPath, firstPath + '.moved')]]) await rejected(name, operation);
  const oldAuthRecord = JSON.parse(await readFile(fixture.authFile, 'utf8'));
  const oldAuth = { key: Buffer.from(oldAuthRecord.key, 'hex'), audience: 'rogi-test', authorizationEpoch: fixture.oldEpoch };
  db = new MysqlDatabase(readConfig('api'));
  const oldSessions = new SessionService(new SessionRepository(), oldAuth.audience, authorizationKey(oldAuth), oldAuth.authorizationEpoch);
  assert.equal((await db.transactions.read(tx => oldSessions.require(tx, member.token))).userId, member.id);
  await db.close(); db = undefined;
  report.restoredOldSessionAcceptedBeforeQuarantine = true;
  const adminUrl = new URL(process.env.TEST_ADMIN_URL);
  admin = await createConnection({ host: adminUrl.hostname, port: Number(adminUrl.port), user: decodeURIComponent(adminUrl.username), password: decodeURIComponent(adminUrl.password), database: adminUrl.pathname.slice(1) });
  const scope = { environment: 'qa', sourceCommit: fixture.sourceCommit, schemaSha256: fixture.schemaSha256, restoreRunId: randomUUID(),
    snapshotSha256: fixture.snapshotSha256, targetId: fixture.target, ledgerSourceId: sha('synthetic-independent-ledger:' + randomUUID()) };
  const now = Math.floor(Date.now() / 1000), payload = { version: 1, purpose: 'restore-ledger-boundary', ...scope, issuedAt: now, expiresAt: now + 1800,
    ledgerBoundaryId: randomUUID(), admissionFenceId: randomUUID(), pendingAdmissionsResolved: true,
    inventory: fixture.records.map(row => ({ key: row.key, sha256: sha(Buffer.from(row.canonicalBase64, 'base64')) })) };
  const boundary = envelope(payload, fixture.authorityKey), ledgerFile = await json('authoritative-ledger.json', fixture.records), replayLedgerFile = await json('replay-ledger.json', fixture.records);
  const admission = { admissionFenceId: payload.admissionFenceId, ledgerBoundaryId: payload.ledgerBoundaryId, targetId: scope.targetId, pendingRequestIds: [] };
  const admissionFile = await json('admission.json', admission), boundaryProofFile = await json('boundary.json', boundary);
  const boundaryPublicKeyFile = join(directory, 'authority-public.pem'), releasePublicKeyFile = join(directory, 'verifier-public.pem'), verifierPrivateFile = join(directory, 'verifier-private.pem');
  await writeFile(boundaryPublicKeyFile, fixture.authorityPublic, { mode: 0o600 }); await writeFile(releasePublicKeyFile, fixture.verifierPublic, { mode: 0o600 }); await writeFile(verifierPrivateFile, fixture.verifierKey, { mode: 0o600 });
  const originalUrl = new URL(process.env.DATABASE_URL);
  const connectOriginal = () => createConnection({ host: originalUrl.hostname, port: Number(originalUrl.port), user: originalUrl.username, password: originalUrl.password, database: fixture.target });
  const oldWriter = await connectOriginal(); oldWriter.on('error', () => {});
  authority = await createIsolationAuthority({ admin, targetUrl: process.env.DATABASE_URL, scope, boundaryEnvelope: boundary, authorityPrivateKey: fixture.authorityKey,
    ledgerFile, admissionFile, connectTarget: createConnection, previousAuthorizationEpochSha256: sha(fixture.oldEpoch), authSecretFile: fixture.authFile, authAudience: 'rogi-test', storageRoot: media.root, storageScopeSha256 });
  await rejected('prior-runtime-existing-writer-drained', () => oldWriter.execute('UPDATE user_profiles SET birthday_visible_to_streamers=1 WHERE user_id=?', [member.id]));
  await assert.rejects(connectOriginal, { code: 'ER_ACCESS_DENIED_ERROR' }); report.rejected.push('prior-runtime-credential-reconnect-denied');
  process.env.DATABASE_URL = authority.targetUrl;
  await admin.query("CREATE USER 'synthetic_index_probe'@'%' IDENTIFIED BY 'fixture-only-index-probe'");
  try {
    await admin.query("GRANT INDEX ON *.* TO 'synthetic_index_probe'@'%'");
    await rejected('foreign-index-only-principal', () => authority.assertHeld());
  } finally { await admin.query("DROP USER 'synthetic_index_probe'@'%'"); }
  await authority.assertHeld();
  const epochFile = join(directory, 'restored-epoch.json'); await copyFile(authority.authorizationEpochFile, epochFile); await chmod(epochFile, 0o600);
  const config = { version: 1, sourceRoot: fixture.sourceRoot, sourceCommit: fixture.sourceCommit, distSha256: fixture.distSha256, scope, boundaryProofFile,
    boundaryPublicKeyFile, releaseProofFile: join(directory, 'release.json'), releasePublicKeyFile, replayLedgerFile, isolationSocket: authority.socketPath,
    authSecretFile: fixture.authFile, authorizationEpochFile: authority.authorizationEpochFile, media };
  const run = async (verb, change = {}) => {
    const began = performance.now();
    try { return await executeIsolated(verb, { ...config, ...change }, process.env); }
    finally { report.timingsMs[verb] = (report.timingsMs[verb] ?? 0) + performance.now() - began; }
  };
  await rejected('compiled-artifact-mismatch', () => run('prepare', { distSha256: '0'.repeat(64) }));
  await rejected('source-checkout-mismatch', () => run('prepare', { sourceCommit: '0'.repeat(40), scope: { ...scope, sourceCommit: '0'.repeat(40) } }));
  await json('replay-ledger.json', fixture.records.slice(1)); await rejected('missing-ledger-receipt', () => run('prepare'));
  await json('replay-ledger.json', [{ ...fixture.records[0], canonicalBase64: Buffer.from('{corrupt').toString('base64') }, ...fixture.records.slice(1)]); await rejected('corrupt-ledger-receipt', () => run('prepare'));
  await json('replay-ledger.json', fixture.records); await rejected('unavailable-ledger', () => run('prepare', { replayLedgerFile: join(directory, 'missing-ledger') }));
  await json('admission.json', { ...admission, pendingRequestIds: [randomUUID()] }); await rejected('pending-admission', () => run('prepare')); await json('admission.json', admission);
  const [[before]] = await admin.query('SELECT COUNT(*) AS count FROM restore_gate_checkpoints'); assert.equal(Number(before.count), 0);
  report.phase = 'interrupt-after-committed-quarantine';
  await admin.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
  await admin.beginTransaction();
  await admin.execute('SELECT id FROM apple_provider_credentials WHERE id=? FOR UPDATE', [fixture.appleCredentialId]);
  let preparingSettled = false;
  const interrupted = run('prepare').then(value => ({ value }), error => ({ error })).finally(() => { preparingSettled = true; });
  let durable;
  for (let attempt = 0; attempt < 300 && !preparingSettled; attempt++) {
    const [[row]] = await admin.execute('SELECT phase,epoch FROM restore_gate_checkpoints WHERE run_id=?', [scope.restoreRunId]);
    if (row?.phase === 'QUARANTINED') { durable = row; break; }
    await delay(5);
  }
  await admin.execute('SELECT RELEASE_LOCK(?)', ['restore:' + sha(canonical(scope)).slice(0, 48)]);
  await admin.commit(); // Release the actual provider row wait after losing custody.
  const failedPrepare = await interrupted; assert.equal(durable?.phase, 'QUARANTINED'); assert.ok(failedPrepare.error); assert.equal(failedPrepare.value, undefined);
  const [[persisted]] = await admin.execute('SELECT phase,epoch FROM restore_gate_checkpoints WHERE run_id=?', [scope.restoreRunId]);
  assert.equal(persisted.phase, 'QUARANTINED'); assert.equal(persisted.epoch, durable.epoch);
  const [generations] = await admin.query('SELECT id,membership_generation FROM users ORDER BY id');
  const [[reacquired]] = await admin.execute('SELECT GET_LOCK(?,0) AS held', ['restore:' + sha(canonical(scope)).slice(0, 48)]);
  assert.equal(Number(reacquired.held), 1); report.rejected.push('prepare-interrupted-after-durable-quarantine');
  report.phase = 'actual-prepare-retry'; const prepared = await run('prepare');
  const [[resumed]] = await admin.execute('SELECT epoch FROM restore_gate_checkpoints WHERE run_id=?', [scope.restoreRunId]);
  assert.equal(resumed.epoch, durable.epoch);
  const [afterGenerations] = await admin.query('SELECT id,membership_generation FROM users ORDER BY id');
  // Account deletion can legitimately advance its target; unrelated accounts
  // must not be quarantined twice when an existing durable checkpoint resumes.
  assert.deepEqual(afterGenerations.filter(row => row.id !== deleted.id), generations.filter(row => row.id !== deleted.id));
  report.prepareResume = { durableQuarantineObserved: true, realProviderRowLock: true, actualMysqlCustodyLoss: true, interruptedBeforeObservation: true, resumedSameEpoch: true, unrelatedGenerationStable: true };

  report.gate = { ready: prepared.ready, violations: prepared.violations, apple: prepared.apple, media: prepared.media };
  assert.equal(prepared.ready, true); assert.equal(prepared.servingAuthorized, false); assert.equal(prepared.media.status, 'verified'); assert.equal(prepared.media.counts.retained, 3);
  assert.ok(Object.values(prepared.violations).every(value => value === 0)); assert.equal(prepared.apple.upstreamRevocationPending, true);
  const [[credential]] = await admin.execute('SELECT status,token FROM apple_provider_credentials WHERE id=?', [fixture.appleCredentialId]);
  assert.equal(credential.status, 'REVOKE_PENDING'); assert.equal(new AppleSeal(oldAuth.key, oldAuth.audience).open(credential.token, fixture.appleCredentialId, 'refresh'), fixture.appleToken);
  const [[obligation]] = await admin.execute('SELECT state,guard_coverage,live_purged_at FROM account_deletion_obligations WHERE user_id=?', [deleted.id]);
  assert.equal(obligation.state, 'BLOCKED'); assert.equal(Number(obligation.guard_coverage), 1); assert.equal(obligation.live_purged_at, null);
  const [[removed]] = await admin.execute('SELECT deleted_at FROM messages WHERE id=?', [fixture.removed]); assert.ok(removed.deleted_at);
  report.deletionReceiptsReplayed = fixture.records.length; report.appleTokenRetainedDecryptable = true;
  report.phase = 'media-negative-readback';
  const originalObject = fixture.media[0];
  await admin.execute('UPDATE media_objects SET sha256=? WHERE id=?', ['0'.repeat(64), originalObject.id]);
  let observed = await run('observe'); assert.equal(observed.ready, false); assert.ok(observed.media.reasons.includes('CHANGED')); report.rejected.push('changed-media-bytes');
  await admin.execute('UPDATE media_objects SET sha256=? WHERE id=?', [originalObject.sha256, originalObject.id]);
  const absentKey = `qa/${originalObject.asset_id}/${randomUUID()}/image`;
  await admin.execute('UPDATE media_objects SET object_key=?,attempt_id=? WHERE id=?', [absentKey, absentKey.split('/')[2], originalObject.id]);
  observed = await run('observe'); assert.equal(observed.ready, false); assert.ok(observed.media.reasons.includes('MISSING')); assert.ok(observed.media.reasons.includes('ORPHAN')); report.rejected.push('missing-and-orphan-media');
  await admin.execute('UPDATE media_objects SET object_key=?,attempt_id=? WHERE id=?', [originalObject.object_key, originalObject.attempt_id, originalObject.id]);
  observed = await run('observe'); assert.equal(observed.ready, true); assert.equal(observed.observationSha256, prepared.observationSha256);
  // Separate verifier process independently invokes observe and signs its actual digest.
  report.phase = 'independent-attest'; const configFile = await json('driver.json', config);
  const { stdout } = await exec(process.execPath, ['test/support/restore-driver/restore_backend_driver.mjs', 'attest', configFile, verifierPrivateFile], { env: process.env, timeout: 30000, maxBuffer: 65536 });
  const attested = JSON.parse(stdout); assert.equal(attested.attested, true); assert.equal(attested.observationSha256, prepared.observationSha256);
  await admin.execute('UPDATE user_profiles SET birthday_visible_to_streamers=1 WHERE user_id=?', [member.id]);
  await rejected('permission-drift-before-consume', () => run('consume')); await admin.execute('UPDATE user_profiles SET birthday_visible_to_streamers=0 WHERE user_id=?', [member.id]);
  const releaseBytes = await readFile(config.releaseProofFile), release = JSON.parse(releaseBytes), decoded = JSON.parse(Buffer.from(release.payloadBase64, 'base64'));
  await json('release.json', { ...release, signatureBase64: Buffer.alloc(64).toString('base64') }); await rejected('forged-release-signature', () => run('consume')); await writeFile(config.releaseProofFile, releaseBytes);
  await json('release.json', envelope({ ...decoded, observationSha256: '0'.repeat(64) }, fixture.verifierKey)); await rejected('wrong-observation-release', () => run('consume')); await writeFile(config.releaseProofFile, releaseBytes);
  report.phase = 'concurrent-nonce-consume'; const outcomes = await Promise.allSettled([run('consume'), run('consume')]);
  assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1); assert.equal(outcomes.filter(value => value.status === 'rejected').length, 1);
  const accepted = outcomes.find(value => value.status === 'fulfilled').value; assert.equal(accepted.phase, 'RELEASE_AUTHORIZED'); assert.equal(accepted.servingAuthorized, false);
  const [[checkpoint]] = await admin.execute('SELECT phase,release_nonce,release_sha256 FROM restore_gate_checkpoints WHERE run_id=?', [scope.restoreRunId]);
  assert.equal(checkpoint.phase, 'RELEASE_AUTHORIZED'); assert.equal(checkpoint.release_nonce, decoded.nonce); assert.equal(checkpoint.release_sha256, accepted.receiptSha256);
  await rejected('consumed-nonce-replay', () => run('consume')); const recovery = await run('recover'); assert.equal(recovery.recovered, true); assert.equal(recovery.receiptSha256, accepted.receiptSha256);
  report.nonce = { contenders: 2, committed: 1, rejected: 1, replayRejected: true, independentReceiptRecovery: true };
  // Losing actual MySQL custody prevents even a valid persisted receipt from being used.
  await admin.execute('SELECT RELEASE_LOCK(?)', ['restore:' + sha(canonical(scope)).slice(0, 48)]);
  await rejected('actual-mysql-custody-loss', () => run('recover'));
  // Custody-loss rejection is complete. HTTP product probes run with the fresh
  // disposable credential before authority.close() locks and drains that account.
  db = new MysqlDatabase(readConfig('api')); // This trusted fixture retains the dedicated operator connection.
  const epoch = JSON.parse(await readFile(epochFile, 'utf8')).authorizationEpoch, freshAuth = { ...oldAuth, authorizationEpoch: epoch }, key = authorizationKey(freshAuth);
  const freshSessions = new SessionService(new SessionRepository(), freshAuth.audience, key, epoch);
  report.phase = 'actual-http-old-token-denial';
  // Adversarially resurrect rows without changing token digests. Epoch must deny
  // them even though a restored backup can undo revoked_at and numeric counters.
  await db.transactions.write(tx => tx.prisma.auth_sessions.updateMany({ data: { revoked_at: null } }));
  api = await startApi(authority.targetUrl, fixture.authFile, epochFile);
  let oldDenied = 0;
  for (const person of fixture.people) for (const native of [false, true]) { assert.equal((await request(api, person, '/auth/session', { native })).status, 401); oldDenied++; }
  report.oldWebNativeTokensDenied = oldDenied;
  const originalMemberSessions = await db.transactions.read(tx => tx.prisma.auth_sessions.findMany({ where: { user_id: member.id }, select: { id: true, transport: true } }));
  async function issueSameSessionId(person, native = false) {
    return db.transactions.write(async tx => {
      const existing = await tx.prisma.auth_sessions.findMany({ where: { user_id: person.id }, select: { id: true } });
      const issued = native ? await freshSessions.issueNative(tx, person.id, 'ios') : await freshSessions.issue(tx, person.id);
      const row = await tx.prisma.auth_sessions.findFirstOrThrow({ where: { user_id: person.id, id: { notIn: existing.map(row => row.id) } } });
      const oldId = originalMemberSessions.find(value => value.transport === (native ? 'NATIVE' : 'WEB')).id;
      await tx.prisma.auth_sessions.delete({ where: { id: row.id } });
      await tx.prisma.auth_sessions.update({ where: { id: oldId }, data: { token_digest: row.token_digest, csrf_digest: row.csrf_digest, revoked_at: null, expires_at: row.expires_at } });
      return issued;
    });
  }
  Object.assign(member, await issueSameSessionId(member)); member.native = await issueSameSessionId(member, true);
  const currentWeb = await request(api, member, '/auth/session'), currentNative = await request(api, member, '/auth/session', { native: true });
  assert.equal(currentWeb.status, 200); assert.equal(currentNative.status, 200);
  assert.notEqual(currentWeb.body.accountPartition, fixture.oldWeb.accountPartition); assert.notEqual(currentNative.body.accountGeneration, fixture.oldNative.accountGeneration);
  Object.assign(owner, await db.transactions.write(tx => freshSessions.issue(tx, owner.id)));
  assert.equal((await request(api, owner, '/admin/rooms', { method: 'POST', body: {} })).status, 403);
  assert.equal((await request(api, owner, `/rooms/${fixture.rooms.private}/join`, { method: 'POST', body: {} })).status, 403);
  const deniedPrivate = await request(api, member, `/rooms/${fixture.rooms.private}/messages/${fixture.retainedPrivate}`); assert.ok([403, 404].includes(deniedPrivate.status));
  report.restoredOwnerAdminAndPrivateRightsDenied = true;
  report.phase = 'same-counter-period-session-ABA';
  await db.transactions.write(async tx => {
    await tx.prisma.rooms.update({ where: { id: fixture.rooms.aba }, data: fixture.aba.room });
    for (const row of fixture.aba.users) { const { id, ...data } = row; await tx.prisma.users.update({ where: { id }, data }); }
    for (const row of fixture.aba.periods) { const { id, ...data } = row; await tx.prisma.membership_periods.update({ where: { id }, data }); }
    for (const row of fixture.aba.members) { const { id, ...data } = row; await tx.prisma.room_members.update({ where: { id }, data }); }
    for (const row of fixture.aba.grants) { const { id, ...data } = row; await tx.prisma.stream_grants.update({ where: { id }, data }); }
  });
  const snapshot = await request(api, member, `/rooms/${fixture.rooms.aba}/snapshot?${new globalThis.URLSearchParams(fixture.device)}`);
  assert.equal(snapshot.status, 200); assert.notEqual(snapshot.body.membershipScope, fixture.oldSnapshot.membershipScope); assert.notEqual(snapshot.body.authorizationRevision, fixture.oldSnapshot.authorizationRevision);
  const stale = await request(api, member, `/rooms/${fixture.rooms.aba}/events?${new globalThis.URLSearchParams({ ...fixture.device, cursor: fixture.oldSnapshot.nextCursor })}`);
  assert.equal(stale.status, 200); assert.equal(stale.body.resetRequired, true); assert.deepEqual(stale.body.events, []);
  const command = { membershipScope: fixture.oldSnapshot.membershipScope, clientMessageId: randomUUID(), intent: 'SHARED', content: { type: 'TEXT', text: 'Synthetic stale scope' } };
  assert.equal((await request(api, member, `/rooms/${fixture.rooms.aba}/messages`, { method: 'POST', body: command })).status, 409);
  command.membershipScope = snapshot.body.membershipScope; assert.equal((await request(api, member, `/rooms/${fixture.rooms.aba}/messages`, { method: 'POST', body: command })).status, 200);
  const currentNativeSameCounter = await request(api, member, '/auth/session', { native: true }); assert.notEqual(currentNativeSameCounter.body.accountGeneration, fixture.oldNative.accountGeneration);
  report.epochABA = { sameSessionId: true, sameMembershipPeriod: true, sameNumericCounters: true, oldCursorReset: true, oldMembershipScopeRejected: true, newScopeCommandAccepted: true, authorizationRevisionChanged: true, accountPartitionChanged: true, nativeGenerationChanged: true };
  // Distinct legitimate reconstruction uses a new period only for an explicitly
  // reapproved current owner, without reviving the prior private grants.
  await db.transactions.write(async tx => { await tx.prisma.room_members.update({ where: { id: member.actors.private }, data: { status: 'LEFT' } }); await assignRoomOwner(tx, fixture.rooms.private, await joinRoom(tx, fixture.rooms.private, member.id)); });
  const freshPrivate = await request(api, member, `/rooms/${fixture.rooms.private}/messages/${fixture.retainedPrivate}`); assert.equal(freshPrivate.status, 404);
  const formerOwner = await request(api, owner, `/rooms/${fixture.rooms.private}/snapshot?${new globalThis.URLSearchParams(fixture.device)}`); assert.ok([403, 404].includes(formerOwner.status));
  report.freshOwnerPeriodRetainsPrivateGrantDenial = true;
  report.outcome = 'passed'; report.phase = 'complete';
}
try { await main(); }
catch (error) {
  report.error = { name: error.name, code: typeof error.code === 'string' && /^[A-Z_]{1,64}$/.test(error.code) ? error.code : 'ASSERTION_OR_GATE_FAILURE',
    frames: String(error.stack ?? '').split('\n').slice(1, 5).map(line => line.replace(/.*[\\/](?=[^\\/]+:\d+:\d+\)?$)/, '')).filter(line => /^[A-Za-z0-9_.:-]+\)?$/.test(line)) };
  process.exitCode = 1;
} finally {
  await api?.close(); await db?.close(); await authority?.close();
  if (admin) await admin.end();
  process.stdout.write('M12_JOINED ' + JSON.stringify(report) + '\n');
}
