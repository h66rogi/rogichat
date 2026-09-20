import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { serialize, deserialize } from 'node:v8';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'mysql2/promise';
import { NestFactory } from '@nestjs/core';
import { MessagesCoreModule } from '../../dist/modules/messages/messages-core.module.js';
import { MessagesCoreService } from '../../dist/modules/messages/messages-core.service.js';
import { DeletionApplyService } from '../../dist/modules/deletion/deletion-apply.service.js';
import { DeletionRepository } from '../../dist/modules/deletion/deletion.repository.js';
import { AccountDeletionRepository } from '../../dist/modules/deletion/account-deletion.repository.js';
import { IdentityGuardService } from '../../dist/modules/auth/identity-guard.service.js';
import { IdentityGuardRepository } from '../../dist/modules/auth/identity-guard.repository.js';
import { accountDeletionId } from '../../dist/modules/deletion/deletion-ledger.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { createApi } from '../../dist/application.js';
import { SafeLogger } from '../../dist/infrastructure/observability/logging.js';
import { createUser, createRoom, assignRoomOwner, joinRoom, sendMessage, sendInput } from '../support/domain-fixture.mjs';
import { deletionFixture } from '../support/deletion-fixture.mjs';
import { isolated, evidence } from './evidence.mjs';

const identifier = value => { assert.match(value, /^[A-Za-z0-9_]+$/); return `\`${value}\``; };

test('logical backup restore rejects missing deletion evidence, invalidates sessions and reconstructs current permissions', { timeout: 90000 }, async t => {
  isolated();
  const db = new MysqlDatabase(readConfig('api'));
  const adminUrl = new URL(process.env.TEST_ADMIN_URL), runtimeUrl = new URL(process.env.DATABASE_URL);
  assert.equal(adminUrl.hostname, '127.0.0.1'); assert.equal(adminUrl.pathname, runtimeUrl.pathname);
  const admin = await createConnection({ host: adminUrl.hostname, port: Number(adminUrl.port),
    user: decodeURIComponent(adminUrl.username), password: decodeURIComponent(adminUrl.password),
    database: adminUrl.pathname.slice(1), supportBigNumbers: true, bigNumberStrings: true });
  const restoreName = `rogichat_test_${randomBytes(8).toString('hex')}`;
  const directory = await mkdtemp(join(tmpdir(), 'rogi-m12-backup-'));
  let restored, app, created = false;
  const context = await NestFactory.createApplicationContext(MessagesCoreModule, { logger: false, abortOnError: false });
  t.after(async () => {
    await app?.close(); await restored?.close(); await context.close(); await db.close();
    if (created) await admin.query(`DROP DATABASE ${identifier(restoreName)}`);
    await admin.end(); await rm(directory, { recursive: true, force: true });
  });
  const config = { audience: 'm12-restore', origin: 'http://localhost:3001', secure: false, key: randomBytes(32) };
  const sessions = new SessionService(new SessionRepository(), config.audience, config.key);
  const people = [];
  for (let i = 0; i < 4; i++) people.push(await db.transactions.write(async tx => {
    const id = await createUser(tx, `M12 restore ${i}`), identityId = randomUUID(), subject = randomBytes(24);
    await tx.prisma.platform_soop.create({ data: { id: identityId, user_id: id, provider_subject: subject, verified_at: await tx.now() } });
    return { id, identityId, subject, ...await sessions.issue(tx, id), native: await sessions.issueNative(tx, id, 'ios') };
  }));
  const [owner, sender, member, outsider] = people;
  const room = await db.transactions.write(async tx => {
    const room = await createRoom(tx, 'M12 restored FAN room', 'FAN');
    for (const person of [owner, sender, member]) person.actor = await joinRoom(tx, room, person.id);
    await assignRoomOwner(tx, room, owner.actor); return room;
  });
  const send = (person, intent, text, target) => db.transactions.write(tx => sendMessage(tx, room, person.id,
    sendInput({ clientMessageId: randomUUID(), intent, ...(target ? { recipientActorId: target.actor } : {}), content: { type: 'TEXT', text } }), config.key));
  const shared = await send(owner, 'SHARED', 'M12 surviving shared');
  const privateMessage = await send(sender, 'PRIVATE', 'M12 deleted private', owner);
  const revokedPrivate = await send(member, 'PRIVATE', 'M12 old positive grant', owner);
  await db.transactions.write(async tx => {
    await tx.prisma.admin_capabilities.create({ data: { user_id: owner.id, manage_rooms: true, manage_users: true, manage_stickers: true } });
    await tx.prisma.creator_accounts.create({ data: { user_id: owner.id, enabled: true } });
    await tx.prisma.user_profiles.update({ where: { user_id: member.id }, data: { birthday_month: 1, birthday_day: 2, birthday_visible_to_streamers: true } });
  });
  const device = { deviceId: randomUUID(), cacheId: randomUUID() };
  app = await createApi(db, new SafeLogger('api', () => {}), undefined, { sessions, config });
  await app.listen(0, '127.0.0.1');
  const oldSnapshotResponse = await fetch(`${await app.getUrl()}/v1/rooms/${room}/snapshot?${new globalThis.URLSearchParams(device)}`, { headers: { Cookie: `rogi_session=${member.token}`, Origin: config.origin } });
  assert.equal(oldSnapshotResponse.status, 200); const oldSnapshot = await oldSnapshotResponse.json();
  assert.ok(oldSnapshot.messages.some(message => message.id === revokedPrivate.messageId));
  await app.close(); app = undefined;
  // Consistent logical table backup on a quiescent, exclusively owned database.
  const backupStart = performance.now();
  await admin.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await admin.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
  const [tables] = await admin.query('SHOW TABLES');
  const dump = [];
  for (const row of tables) {
    const name = Object.values(row)[0];
    const [definition] = await admin.query(`SHOW CREATE TABLE ${identifier(name)}`);
    const [rows] = await admin.query(`SELECT * FROM ${identifier(name)}`);
    dump.push({ name, ddl: definition[0]['Create Table'], rows });
  }
  await admin.commit();
  const bytes = serialize(dump), backupPath = join(directory, 'synthetic-backup.bin');
  await writeFile(backupPath, bytes, { mode: 0o600 });
  const backupMs = performance.now() - backupStart;
  // Changes after backup must not be undone by restoring positive permissions.
  // The fixture retains a separate operator approval only for the current owner.
  const approvedOwnerUserId = member.id;
  await db.transactions.write(async tx => {
    await assignRoomOwner(tx, room, member.actor);
    await tx.prisma.room_members.update({ where: { id: owner.actor }, data: { role: 'FAN', status: 'BANNED', active_period_id: null } });
    await tx.prisma.stream_grants.updateMany({ data: { can_read: false, can_send: false, revoked_at: await tx.now() } });
    await tx.prisma.admin_capabilities.update({ where: { user_id: owner.id }, data: { manage_rooms: false, manage_users: false, manage_stickers: false } });
    await tx.prisma.user_profiles.update({ where: { user_id: member.id }, data: { birthday_visible_to_streamers: false } });
  });
  // Immutable external obligations are created AFTER the backup and survive it.
  const deletion = deletionFixture(), guardKey = randomBytes(32);
  const guards = new IdentityGuardService(new IdentityGuardRepository());
  const messageIntent = await db.transactions.write(tx => context.get(MessagesCoreService).authorizeDeletion(tx, room, sender.id, privateMessage.messageId, 'qa'));
  await deletion.ledger.ensureIntent(messageIntent);
  await deletion.ledger.ensureIntent({ schemaVersion: 2, environment: 'qa', scope: 'ACCOUNT', roomId: null,
    actorUserId: sender.id, targetId: sender.id, requestId: accountDeletionId('qa', sender.id), requestedAt: new Date().toISOString(),
    subjectGuard: guards.evidence(sender.subject, sender.identityId, guardKey) });
  const expectedKeys = [...deletion.store.rows.keys()].sort();
  const restoreStart = performance.now();
  await admin.query(`CREATE DATABASE ${identifier(restoreName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`); created = true;
  await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${identifier(restoreName)}.* TO ?@'%'`, [runtimeUrl.username]);
  await admin.query(`USE ${identifier(restoreName)}`);
  await admin.query('SET FOREIGN_KEY_CHECKS=0');
  const recoveredBytes = await readFile(backupPath);
  assert.equal(createHash('sha256').update(recoveredBytes).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
  for (const table of deserialize(recoveredBytes)) {
    await admin.query(table.ddl);
    for (const row of table.rows) {
      const keys = Object.keys(row), values = Object.values(row).map(value => value && typeof value === 'object' && !Buffer.isBuffer(value) && !(value instanceof Date) ? JSON.stringify(value) : value);
      await admin.execute(`INSERT INTO ${identifier(table.name)} (${keys.map(identifier).join(',')}) VALUES (${keys.map(() => '?').join(',')})`, values);
    }
  }
  await admin.query('SET FOREIGN_KEY_CHECKS=1');
  runtimeUrl.pathname = `/${restoreName}`;
  restored = new MysqlDatabase(readConfig('api', { ...process.env, DATABASE_URL: runtimeUrl.href }));
  assert.equal((await restored.check()).ready, true);
  const restoreMs = performance.now() - restoreStart;
  // Prove why a restored database must remain quarantined: old sessions still work before invalidation.
  assert.equal((await restored.transactions.read(tx => sessions.require(tx, owner.token))).userId, owner.id);
  const apply = new DeletionApplyService(restored.transactions, context.get(MessagesCoreService), new DeletionRepository(), new AccountDeletionRepository(), guards);
  // Test-only release guard; the immutable manifest is external fixture evidence,
  // NOT a production restore gate or a proof of object-store inventory completeness.
  async function validatedReceipts() {
    const page = await deletion.ledger.discover();
    assert.equal(page.cursor, null); assert.equal(page.items.length, expectedKeys.length);
    assert.deepEqual(page.items.map(item => item.key).sort(), expectedKeys);
    const receipts = [];
    for (const key of expectedKeys) receipts.push(await deletion.ledger.readByKey(key));
    return receipts;
  }
  const [firstKey] = expectedKeys, original = deletion.store.rows.get(firstKey);
  deletion.store.rows.delete(firstKey); await assert.rejects(validatedReceipts); deletion.store.rows.set(firstKey, original);
  deletion.store.fail = true; await assert.rejects(validatedReceipts); deletion.store.fail = false;
  deletion.store.rows.set(firstKey, Buffer.from('{corrupt')); await assert.rejects(validatedReceipts); deletion.store.rows.set(firstKey, original);
  const replayStart = performance.now();
  for (const receipt of await validatedReceipts()) assert.equal((await apply.apply(receipt)).status, 'blocked');
  // Operational quarantine procedure in test scaffolding. No serving API is
  // started while restored positive permissions are still trusted. Unknown
  // memberships stay banned until independent explicit operator reapproval.
  const invalidated = await restored.transactions.write(async tx => {
    const now = await tx.now();
    const sessions = await tx.prisma.auth_sessions.updateMany({ data: { revoked_at: now } });
    await tx.prisma.rooms.updateMany({ data: { owner_member_id: null, content_epoch: { increment: 1n }, policy_version: { increment: 1 } } });
    await tx.prisma.room_members.updateMany({ data: { role: 'FAN', status: 'BANNED', active_period_id: null, acl_epoch: { increment: 1n } } });
    await tx.prisma.membership_periods.updateMany({ data: { left_at: now } });
    await tx.prisma.stream_grants.updateMany({ data: { can_read: false, can_send: false, revoked_at: now } });
    await tx.prisma.users.updateMany({ data: { membership_generation: { increment: 1n } } });
    await tx.prisma.admin_capabilities.updateMany({ data: { manage_rooms: false, manage_users: false, manage_stickers: false } });
    await tx.prisma.creator_accounts.updateMany({ data: { enabled: false } });
    await tx.prisma.user_profiles.updateMany({ data: { birthday_visible_to_streamers: false, revision: { increment: 1n } } });
    return sessions;
  });
  for (const person of people) {
    await assert.rejects(restored.transactions.read(tx => sessions.require(tx, person.token)), error => error.getStatus?.() === 401);
    await assert.rejects(restored.transactions.read(tx => sessions.require(tx, person.native.token, undefined, false, { transport: 'NATIVE', clientId: 'ios' })), error => error.getStatus?.() === 401);
  }
  // Fresh sessions in test scaffolding; no public mint/auth bypass exists in the serving app.
  for (const person of [owner, member, outsider]) Object.assign(person, await restored.transactions.write(tx => sessions.issue(tx, person.id)));
  const quarantined = await restored.transactions.read(async tx => ({
    members: await tx.prisma.room_members.count({ where: { status: 'ACTIVE' } }),
    owners: await tx.prisma.rooms.count({ where: { owner_member_id: { not: null } } }),
    grants: await tx.prisma.stream_grants.count({ where: { OR: [{ can_read: true }, { can_send: true }] } }),
    admins: await tx.prisma.admin_capabilities.count({ where: { OR: [{ manage_rooms: true }, { manage_users: true }, { manage_stickers: true }] } }),
    creators: await tx.prisma.creator_accounts.count({ where: { enabled: true } }),
    birthdays: await tx.prisma.user_profiles.count({ where: { birthday_visible_to_streamers: true } }),
  }));
  assert.deepEqual(quarantined, { members: 0, owners: 0, grants: 0, admins: 0, creators: 0, birthdays: 0 });
  // Only independently approved current owner gets a NEW period; old private
  // grants and administrator capabilities are never copied back from backup.
  await restored.transactions.write(async tx => {
    await tx.prisma.room_members.updateMany({ where: { user_id: approvedOwnerUserId, room_id: room }, data: { status: 'LEFT' } });
    await assignRoomOwner(tx, room, await joinRoom(tx, room, approvedOwnerUserId));
  });
  const fresh = await restored.transactions.write(tx => sendMessage(tx, room, member.id,
    sendInput({ clientMessageId: randomUUID(), intent: 'SHARED', content: { type: 'TEXT', text: 'M12 independently approved owner' } }), config.key));
  app = await createApi(restored, new SafeLogger('api', () => {}), undefined, { sessions, config }, undefined, 'test', deletion);
  await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
  const snapshot = async person => {
    const query = new globalThis.URLSearchParams(device);
    const response = await fetch(`${base}/v1/rooms/${room}/snapshot?${query}`, { headers: { Cookie: `rogi_session=${person.token}`, Origin: config.origin } });
    return { status: response.status, body: await response.json() };
  };
  {
    const result = await snapshot(member); assert.equal(result.status, 200);
    assert.ok(result.body.messages.some(message => message.id === fresh.messageId));
    assert.ok(!result.body.messages.some(message => message.id === shared.messageId));
    assert.ok(!JSON.stringify(result.body).includes('M12 deleted private'));
    assert.ok(!JSON.stringify(result.body).includes('M12 old positive grant'));
    assert.ok(!JSON.stringify(result.body).includes(sender.subject.toString('hex')));
    assert.notEqual(result.body.authorizationRevision, oldSnapshot.authorizationRevision);
    assert.notEqual(result.body.membershipScope, oldSnapshot.membershipScope);
  }
  assert.ok([403, 404].includes((await snapshot(owner)).status), 'restored former owner remains denied after fresh login');
  assert.ok([403, 404].includes((await snapshot(outsider)).status));
  assert.equal((await snapshot(sender)).status, 401);
  async function request(person, method, path, body) {
    const response = await fetch(`${base}/v1${path}`, { method, headers: { Cookie: `rogi_session=${person.token}`, Origin: config.origin,
      'X-CSRF-Token': person.csrf, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  assert.equal((await request(owner, 'POST', `/rooms/${room}/join`, {})).status, 403, 'simple rejoin must not restore unknown prior rights');
  assert.equal((await request(owner, 'POST', '/admin/rooms', {})).status, 403);
  assert.ok([403, 404].includes((await request(owner, 'POST', `/rooms/${room}/messages/${revokedPrivate.messageId}/publications`, {})).status));
  assert.equal((await request(member, 'GET', `/rooms/${room}/messages/${revokedPrivate.messageId}`)).status, 404);
  const stale = await request(member, 'GET', `/rooms/${room}/events?${new globalThis.URLSearchParams({ ...device, cursor: oldSnapshot.nextCursor })}`);
  assert.equal(stale.status, 200); assert.equal(stale.body.resetRequired, true); assert.deepEqual(stale.body.events, []);
  const obligations = await restored.transactions.read(tx => tx.prisma.account_deletion_obligations.findUniqueOrThrow({ where: { user_id: sender.id } }));
  assert.equal(obligations.state, 'BLOCKED'); assert.equal(obligations.live_purged_at, null);
  await evidence('restore', { outcome: 'passed', backupTables: dump.length, backupBytes: bytes.length, backupMs, restoreMs,
    replayAndPermissionCheckMs: performance.now() - replayStart, externalObligations: expectedKeys.length,
    rejectedEvidenceCases: ['missing', 'unavailable', 'corrupt'], invalidatedWebAndNativeSessions: invalidated.count,
    permissionChecks: ['all restored positive memberships/grants/owner/admin/creator capabilities disabled', 'birthday visibility reset OFF',
      'only independently approved owner receives fresh membership', 'former owner login/rejoin/publication denied', 'revoked private grant stays denied',
      'old cursor requires reset', 'new membership and authorization revision differ', 'deleted private body absent', 'outsider denied', 'deleted account denied'],
    quarantineCounts: quarantined,
    quarantineHazardObserved: 'old session accepted before explicit invalidation',
    limitations: ['logical disposable MySQL backup, not Aurora PITR', 'external ledger is an isolated in-memory adapter',
      'release guard is test-only; production restore orchestration unverified', 'BLOCKED is not physical purge completion'] });
});
