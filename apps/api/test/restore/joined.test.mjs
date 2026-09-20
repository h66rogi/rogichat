import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { randomBytes, randomUUID, generateKeyPairSync, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { serialize } from 'node:v8';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createConnection } from 'mysql2/promise';
import { NestFactory } from '@nestjs/core';
import { MessagesCoreModule } from '../../dist/modules/messages/messages-core.module.js';
import { MessagesCoreService } from '../../dist/modules/messages/messages-core.service.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { authorizationKey } from '../../dist/infrastructure/config/authorization-epoch.js';
import { restoreSchemaSha256 } from '../../dist/modules/restore-gate/restore-gate.service.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { IdentityGuardService } from '../../dist/modules/auth/identity-guard.service.js';
import { IdentityGuardRepository } from '../../dist/modules/auth/identity-guard.repository.js';
import { AppleSeal } from '../../dist/modules/auth/apple/apple-seal.js';
import { accountDeletionId, deletionIntentKey, encodeDeletionIntent } from '../../dist/modules/deletion/deletion-ledger.js';
import { createUser, createRoom, joinRoom, assignRoomOwner, sendMessage, sendInput } from '../support/domain-fixture.mjs';
import { imageBytes, videoBytes } from '../support/restore-media-bytes.mjs';
import { compiledTreeHash } from '../support/restore-driver/restore_backend_driver.mjs';
import { evidence, isolated } from '../quality/evidence.mjs';
import { backup, restore, identifier } from './backup-fixture.mjs';
import { startApi, request } from './http-fixture.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('joined real backup, protected operator gate, release CAS and epoch-invalidated HTTP', { timeout: 12 * 60 * 1000 }, async t => {
  isolated(); assert.equal(process.platform, 'linux'); assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  const began = performance.now(), directory = await realpath(await mkdtemp(join(tmpdir(), 'rg-joined-'))), objects = join(directory, 'objects');
  await mkdir(objects, { mode: 0o700 });
  const original = new URL(process.env.DATABASE_URL), adminUrl = new URL(process.env.TEST_ADMIN_URL);
  const admin = await createConnection({ host: adminUrl.hostname, port: Number(adminUrl.port), user: decodeURIComponent(adminUrl.username), password: decodeURIComponent(adminUrl.password), database: adminUrl.pathname.slice(1), supportBigNumbers: true, bigNumberStrings: true });
  const db = new MysqlDatabase(readConfig('api')), context = await NestFactory.createApplicationContext(MessagesCoreModule, { logger: false, abortOnError: false });
  const suffix = randomBytes(8).toString('hex'), target = `rogichat_test_${suffix}`, account = `fixture_${suffix}`;
  let targetCreated = false, accountCreated = false, api, childProcess;
  t.after(async () => {
    await api?.close();
    if (childProcess && childProcess.exitCode === null && childProcess.signalCode === null) { const exited = once(childProcess, 'exit'); childProcess.kill('SIGTERM'); await exited; }
    await context.close(); await db.close();
    if (targetCreated) await admin.query(`DROP DATABASE IF EXISTS ${identifier(target)}`);
    await admin.query("DROP USER IF EXISTS ?@'%'", ["runtime_" + suffix]);
    if (accountCreated) await admin.query("DROP USER IF EXISTS ?@'%'", [account]);
    await admin.end(); await rm(directory, { recursive: true, force: true });
  });
  const baseKey = randomBytes(32), guardKey = randomBytes(32), oldEpoch = randomUUID(), authFile = join(directory, 'auth.json'), oldEpochFile = join(directory, 'old-epoch.json');
  await writeFile(authFile, JSON.stringify({ key: baseKey.toString('hex'), identityGuardKey: guardKey.toString('hex') }), { mode: 0o600 });
  await writeFile(oldEpochFile, JSON.stringify({ authorizationEpoch: oldEpoch }), { mode: 0o600 });
  const auth = { key: baseKey, audience: 'rogi-test', authorizationEpoch: oldEpoch }, oldKey = authorizationKey(auth);
  const sessions = new SessionService(new SessionRepository(), auth.audience, oldKey, oldEpoch), people = [];
  for (let i = 0; i < 3; i++) people.push(await db.transactions.write(async tx => {
    const id = await createUser(tx, `Synthetic joined restore ${i}`), identityId = randomUUID(), subject = randomBytes(24);
    await tx.prisma.platform_soop.create({ data: { id: identityId, user_id: id, provider_subject: subject, verified_at: await tx.now() } });
    return { id, identityId, subject, ...await sessions.issue(tx, id), native: await sessions.issueNative(tx, id, 'ios') };
  }));
  const [owner, member, deleted] = people;
  const rooms = {};
  for (const [name, mode, participants] of [['aba', 'GROUP', [owner, member]], ['private', 'FAN', people]]) rooms[name] = await db.transactions.write(async tx => {
    const room = await createRoom(tx, `Synthetic ${name} restore`, mode);
    for (const person of participants) { person.actors ??= {}; person.actors[name] = await joinRoom(tx, room, person.id); }
    await assignRoomOwner(tx, room, owner.actors[name]); return room;
  });
  const send = (room, person, intent, text, recipient) => db.transactions.write(tx => sendMessage(tx, room, person.id,
    sendInput({ clientMessageId: randomUUID(), intent, ...(recipient ? { recipientActorId: recipient } : {}), content: { type: 'TEXT', text } }), oldKey));
  await send(rooms.aba, owner, 'SHARED', 'Synthetic stable ABA message');
  const removed = await send(rooms.private, deleted, 'PRIVATE', 'Synthetic removed private', owner.actors.private);
  const retainedPrivate = await send(rooms.private, member, 'PRIVATE', 'Synthetic old private grant', owner.actors.private);
  const media = [];
  for (const [kind, variants] of [['PHOTO', [['image', imageBytes]]], ['VIDEO', [['video', videoBytes], ['poster', imageBytes]]]]) {
    const assetId = randomUUID(), attempt = randomUUID();
    const records = [];
    for (const [variant, bytes] of variants) {
      const key = `qa/${assetId}/${attempt}/${variant}`, path = join(objects, key); await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, bytes, { mode: 0o600 });
      records.push({ id: randomUUID(), asset_id: assetId, attempt_id: attempt, variant, object_key: key, state: 'READY', byte_length: BigInt(bytes.length), sha256: sha(bytes) });
    }
    await db.transactions.write(async tx => {
      await tx.prisma.media_assets.create({ data: { id: assetId, owner_user_id: owner.id, kind, content_type: kind === 'VIDEO' ? 'video/mp4' : 'image/png', state: 'READY', declared_bytes: 1n, reserved_bytes: 1n, expires_at: new Date(Date.now() + 3600000) } });
      await tx.prisma.media_objects.createMany({ data: records });
    });
    media.push(...records);
  }
  const appleCredentialId = randomUUID(), appleIdentityId = randomUUID(), appleToken = 'synthetic-retained-revoke-token';
  await db.transactions.write(async tx => {
    await tx.prisma.admin_capabilities.create({ data: { user_id: owner.id, manage_rooms: true, manage_users: true, manage_stickers: true } });
    await tx.prisma.creator_accounts.create({ data: { user_id: owner.id, enabled: true } });
    await tx.prisma.user_profiles.update({ where: { user_id: member.id }, data: { birthday_month: 1, birthday_day: 2, birthday_visible_to_streamers: true } });
    await tx.prisma.auth_identities.create({ data: { id: appleIdentityId, user_id: owner.id, provider: 'apple', issuer: Buffer.from('https://appleid.apple.com'), scope: 'synthetic', subject: Buffer.from(randomUUID()), status: 'VERIFIED', verified_at: await tx.now() } });
    await tx.prisma.apple_provider_credentials.create({ data: { id: appleCredentialId, transaction_id: appleCredentialId, identity_id: appleIdentityId, user_id: owner.id, audience: 'synthetic.test', token: new AppleSeal(baseKey, auth.audience).seal(appleToken, appleCredentialId, 'refresh'), status: 'RETAINED', expires_at: new Date(Date.now() + 3600000) } });
  });
  const device = { deviceId: randomUUID(), cacheId: randomUUID() };
  api = await startApi(original.href, authFile, oldEpochFile);
  const oldWeb = await request(api, member, '/auth/session'), oldNative = await request(api, member, '/auth/session', { native: true });
  assert.equal(oldWeb.status, 200); assert.equal(oldNative.status, 200);
  const oldSnapshot = await request(api, member, `/rooms/${rooms.aba}/snapshot?${new globalThis.URLSearchParams(device)}`);
  assert.equal(oldSnapshot.status, 200); assert.ok(oldSnapshot.body.nextCursor);
  await api.close(); api = undefined;
  const aba = await db.transactions.read(async tx => ({
    room: await tx.prisma.rooms.findUnique({ where: { id: rooms.aba }, select: { owner_member_id: true, content_epoch: true, policy_version: true } }),
    users: await tx.prisma.users.findMany({ where: { id: { in: [owner.id, member.id] } }, select: { id: true, membership_generation: true } }),
    members: await tx.prisma.room_members.findMany({ where: { room_id: rooms.aba }, select: { id: true, role: true, status: true, active_period_id: true, acl_epoch: true } }),
    periods: await tx.prisma.membership_periods.findMany({ where: { room_id: rooms.aba }, select: { id: true, left_at: true, visible_from_order: true } }),
    grants: await tx.prisma.stream_grants.findMany({ where: { room_id: rooms.aba }, select: { id: true, can_read: true, can_send: true, revoked_at: true } }),
  }));
  const dump = await backup(admin), snapshotSha256 = sha(dump.bytes), snapshotFile = join(directory, 'backup.bin');
  await writeFile(snapshotFile, dump.bytes, { mode: 0o600 });
  const messageIntent = await db.transactions.write(tx => context.get(MessagesCoreService).authorizeDeletion(tx, rooms.private, deleted.id, removed.messageId, 'qa'));
  const guards = new IdentityGuardService(new IdentityGuardRepository());
  const intents = [messageIntent, { schemaVersion: 2, environment: 'qa', scope: 'ACCOUNT', roomId: null, actorUserId: deleted.id, targetId: deleted.id,
    requestId: accountDeletionId('qa', deleted.id), requestedAt: new Date().toISOString(), subjectGuard: guards.evidence(deleted.subject, deleted.identityId, guardKey) }];
  const records = intents.map(intent => ({ key: deletionIntentKey('qa', intent.requestId), canonicalBase64: encodeDeletionIntent(intent).toString('base64') })).sort((a, b) => a.key < b.key ? -1 : 1);
  await db.close();
  await admin.query(`CREATE DATABASE ${identifier(target)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`); targetCreated = true;
  const password = randomBytes(24).toString('hex'); await admin.query("CREATE USER ?@'%' IDENTIFIED BY ?", [account, password]); accountCreated = true;
  await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${identifier(target)}.* TO ?@'%'`, [account]);
  await admin.query(`USE ${identifier(target)}`);
  const restoredBytes = await readFile(snapshotFile); assert.equal(sha(restoredBytes), snapshotSha256); await restore(admin, restoredBytes);
  await admin.query(`USE ${identifier(original.pathname.slice(1))}`); // No foreign root connection on target during custody.
  const targetUrl = new URL(original); targetUrl.pathname = '/' + target; targetUrl.username = account; targetUrl.password = password;
  const targetAdminUrl = new URL(adminUrl); targetAdminUrl.pathname = '/' + target;
  const sourceRoot = await realpath(resolve('../../../runtime')), sourceCommit = '7b559b645ef2b71fc5492d79895142745d0d6ead';
  assert.equal(execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceCommit);
  const expectedDist = '5c711fee7fc14edd42f121c9b8c38757ab3113a6633417919ee5e32f4c2a6057';
  assert.equal(await compiledTreeHash(join(sourceRoot, 'apps/api/dist')), expectedDist);
  assert.equal(await compiledTreeHash(resolve('dist')), expectedDist);
  const authority = generateKeyPairSync('ed25519'), verifier = generateKeyPairSync('ed25519');
  const fixture = { directory, sourceRoot, sourceCommit, distSha256: await compiledTreeHash(join(sourceRoot, 'apps/api/dist')), schemaSha256: restoreSchemaSha256(),
    snapshotSha256, target, authFile, oldEpoch, people, rooms, media, records, aba, device, oldSnapshot: oldSnapshot.body, oldWeb: oldWeb.body, oldNative: oldNative.body,
    retainedPrivate: retainedPrivate.messageId, removed: removed.messageId, appleCredentialId, appleIdentityId, appleToken,
    authorityKey: authority.privateKey.export({ type: 'pkcs8', format: 'pem' }), authorityPublic: authority.publicKey.export({ type: 'spki', format: 'pem' }),
    verifierKey: verifier.privateKey.export({ type: 'pkcs8', format: 'pem' }), verifierPublic: verifier.publicKey.export({ type: 'spki', format: 'pem' }) };
  const fixtureFile = join(directory, 'fixture.bin'); await writeFile(fixtureFile, serialize(fixture), { mode: 0o600 });
  const env = { ...process.env, DATABASE_URL: targetUrl.href, TEST_ADMIN_URL: targetAdminUrl.href, M12_RESTORE_FIXTURE_FILE: fixtureFile };
  const preserved = ['PATH', 'GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT', 'RUNNER_OS', 'GITHUB_SERVER_URL', 'GITHUB_REPOSITORY', 'APP_ENV', 'NODE_ENV', 'DB_TLS_MODE', 'ROGICHAT_TEST_MYSQL', 'DATABASE_URL', 'TEST_ADMIN_URL', 'M12_SOURCE_SHA', 'M12_EVIDENCE_DIR', 'M12_RESTORE_FIXTURE_FILE'].join(',');
  childProcess = spawn('sudo', [`--preserve-env=${preserved}`, '/usr/bin/python3', 'test/support/restore-driver/restore_storage_namespace.py', '--objects', objects, '--', process.execPath, 'test/restore/joined-child.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', diagnostic = ''; childProcess.stdout.on('data', bytes => { output += bytes; }); childProcess.stderr.on('data', bytes => { diagnostic += bytes; });
  const [code] = await once(childProcess, 'exit');
  const line = output.split('\n').find(value => value.startsWith('M12_JOINED '));
  const result = line ? JSON.parse(line.slice(11)) : { outcome: 'failed', phase: 'namespace-or-child-start', diagnostic: diagnostic.slice(-500) };
  await evidence('joined-restore', { ...result, sourceSha: sourceCommit, runtimeBuildSha256: fixture.distSha256, schemaSha256: fixture.schemaSha256,
    backupTables: dump.tables, backupBytes: dump.bytes.length, snapshotSha256, elapsedMs: performance.now() - began,
    limitations: ['disposable logical MySQL backup, not Aurora PITR', 'kernel-custodied local media bytes, not live R2 custody', 'synthetic adversarial permission/session-row resurrection only inside isolated fixture'] });
  assert.equal(code, 0, `joined restore failed at ${result.phase}`); assert.equal(result.outcome, 'passed');
});
