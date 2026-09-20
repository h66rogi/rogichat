import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createConnection } from 'mysql2/promise';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { PrismaDatabase } from '../../dist/infrastructure/database/database.js';
import { migrationManifest } from '../../dist/infrastructure/database/schema-manifest.js';
import { DefaultRoomService } from '../../dist/modules/owner-bootstrap/default-room.service.js';
import { DefaultRoomRepository } from '../../dist/modules/owner-bootstrap/default-room.repository.js';
import { DEFAULT_ROOM_ID } from '../../dist/modules/owner-bootstrap/default-room.config.js';
import { initializeDefaultRoom } from '../../dist/modules/owner-bootstrap/default-room-initialize.js';
import { IdentityGuardService } from '../../dist/modules/auth/identity-guard.service.js';
import { IdentityGuardRepository } from '../../dist/modules/auth/identity-guard.repository.js';
import { RoomsRepository } from '../../dist/modules/rooms/rooms.repository.js';
import { createRoom, joinRoom, sendMessage, sendInput, getMessage, leaveRoom } from '../support/domain-fixture.mjs';
async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const url = new URL(process.env.TEST_ADMIN_URL), original = url.pathname.slice(1), schema = `default_${randomBytes(8).toString('hex')}`;
  assert.match(original, /^rogichat_test_[a-f0-9]+$/);
  const admin = await createConnection({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: original, multipleStatements: true });
  const runtimeUser = `inbox_${randomBytes(8).toString('hex')}`, runtimePassword = randomBytes(24).toString('hex');
  let db;
  t.after(async () => { await db?.close(); await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``); await admin.query("DROP USER IF EXISTS ?@'%'", [runtimeUser]); await admin.end(); });
  await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`); await admin.query(`USE \`${schema}\``);
  for (const migration of migrationManifest) await admin.query(await readFile(new URL(`../../prisma/migrations/${migration.name}/migration.sql`, import.meta.url), 'utf8'));
  await admin.query(`CREATE TABLE _prisma_migrations LIKE \`${original}\`._prisma_migrations`);
  await admin.query(`INSERT INTO _prisma_migrations SELECT * FROM \`${original}\`._prisma_migrations`);
  await admin.query("CREATE USER ?@'%' IDENTIFIED BY ?", [runtimeUser, runtimePassword]);
  await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON \`${schema}\`.* TO ?@'%'`, [runtimeUser]);
  url.pathname = `/${schema}`; url.username = runtimeUser; url.password = runtimePassword;
  db = new PrismaDatabase(readConfig('worker', { ...process.env, DATABASE_URL: url.href, DB_POOL_SIZE: '2' }));
  const key = randomBytes(32), subject = `isolated_${randomBytes(8).toString('hex')}`;
  const guards = new IdentityGuardService(new IdentityGuardRepository());
  const service = config => new DefaultRoomService(db.transactions, db, new DefaultRoomRepository(), { createRoom, joinRoom }, guards, config, { identityGuardKey: key });
  const seed = (handle = subject, status = 'ACTIVE', providerStatus = 'VERIFIED') => db.transactions.write(async tx => {
    const id = randomUUID(); await tx.prisma.users.create({ data: { id, status, profile: { create: { nickname: '격리 사용자' } } }, select: { id: true } });
    await tx.prisma.platform_soop.create({ data: { id: randomUUID(), user_id: id, provider_subject: Buffer.from(handle), status: providerStatus, verified_at: await tx.now() }, select: { id: true } });
    return id;
  });
  const inspect = () => db.transactions.read(async tx => ({
    rooms: await tx.prisma.rooms.findMany(), bindings: await tx.prisma.default_room_bindings.findMany(),
    counters: await tx.prisma.room_counters.findMany(), streams: await tx.prisma.message_streams.findMany(),
    users: await tx.prisma.users.count(), members: await tx.prisma.room_members.findMany(),
    creators: await tx.prisma.creator_accounts.findMany(), admins: await tx.prisma.admin_capabilities.count(),
    audits: await tx.prisma.audit_events.count({ where: { action: 'DEFAULT_ROOM_OWNER_BOUND' } }),
  }));
  return { db, service, seed, inspect, key, guards, subject };
}
test('fresh migration + automatic bootstrap creates genuine pending room without fake account, then binds only exact verified owner', async t => {
  const f = await fixture(t), bootstrap = f.service({ expectedSubject: f.subject });
  await initializeDefaultRoom(f.db); // Same awaited entrypoint as official migration completion.
  assert.equal(await bootstrap.provision(), 'awaiting_owner');
  let state = await f.inspect();
  assert.equal(state.users, 0); assert.equal(state.rooms.length, 1); assert.equal(state.rooms[0].id, DEFAULT_ROOM_ID);
  assert.equal(state.rooms[0].status, 'ACTIVE'); assert.equal(state.rooms[0].owner_member_id, null);
  assert.equal(state.counters.length, 1); assert.equal(state.streams[0].kind, 'ROOM_SHARED');
  const wrong = await f.seed('not_the_owner');
  assert.equal(await bootstrap.provision(), 'awaiting_owner');
  const fanActor = await f.db.transactions.write(tx => joinRoom(tx, DEFAULT_ROOM_ID, wrong));
  const listed = await f.db.transactions.read(tx => new RoomsRepository().visibleRooms(tx, wrong, ''));
  assert.equal(listed[0].isDefault, true); assert.equal(listed[0].availability, 'READY');
  const owner = await f.seed(); assert.equal(await bootstrap.provision(), 'bound'); state = await f.inspect();
  assert.equal(state.users, 2); assert.equal(state.rooms.length, 1); assert.equal(state.members.length, 2);
  const ownerMember = state.members.find(member => member.user_id === owner);
  assert.equal(ownerMember.role, 'STREAMER'); assert.equal(state.members.find(member => member.id === fanActor).role, 'FAN');
  assert.equal(state.rooms[0].owner_member_id, ownerMember.id); assert.equal(state.rooms[0].status, 'ACTIVE');
  assert.equal(state.creators[0].user_id, owner); assert.equal(state.admins, 0); assert.equal(state.audits, 1);
  assert.equal(await bootstrap.provision(), 'bound'); assert.deepEqual(await f.inspect(), state);
  await f.db.transactions.write(tx => tx.prisma.rooms.update({ where: { id: DEFAULT_ROOM_ID }, data: { status: 'CLOSED' } }));
  await bootstrap.provision(); assert.equal((await f.inspect()).rooms[0].status, 'CLOSED');
  await assert.rejects(f.service({ expectedSubject: 'changed_owner' }).provision(), /default_room_conflict/);
});
test('pre-owner fan inbox commits privately and idempotently; later real owner receives same backlog and pair', async t => {
  const f = await fixture(t), bootstrap = f.service({ expectedSubject: f.subject });
  await bootstrap.provision();
  const fan = await f.seed('inbox_fan'), other = await f.seed('other_fan');
  const actor = await f.db.transactions.write(tx => joinRoom(tx, DEFAULT_ROOM_ID, fan));
  await f.db.transactions.write(tx => joinRoom(tx, DEFAULT_ROOM_ID, other));
  const input = sendInput({ clientMessageId: randomUUID(), intent: 'ROOM_OWNER', content: { type: 'TEXT', text: '격리된 실제 저장 검증' } });
  const send = body => f.db.transactions.write(tx => sendMessage(tx, DEFAULT_ROOM_ID, fan, body, f.key));
  const [first, concurrent] = await Promise.all([send(input), send(input)]);
  assert.deepEqual(concurrent, first);
  assert.equal(first.status, 'committed'); assert.deepEqual(await send(input), first);
  assert.equal((await f.db.transactions.read(tx => getMessage(tx, DEFAULT_ROOM_ID, fan, first.messageId))).audience, 'PRIVATE');
  await assert.rejects(f.db.transactions.read(tx => getMessage(tx, DEFAULT_ROOM_ID, other, first.messageId)), { code: 'NOT_FOUND' });
  await assert.rejects(send({ ...input, clientMessageId: randomUUID(), intent: 'SHARED' }), { code: 'FORBIDDEN' });
  const before = await f.db.transactions.read(tx => tx.prisma.messages.findUnique({ where: { id: first.messageId }, select: { stream_id: true } }));
  assert.equal((await f.inspect()).users, 2); assert.equal((await f.inspect()).creators.length, 0);
  const owner = await f.seed();
  assert.equal(await bootstrap.provision(), 'bound');
  assert.equal((await f.db.transactions.read(tx => getMessage(tx, DEFAULT_ROOM_ID, owner, first.messageId))).content.text, input.content.text);
  assert.deepEqual(await send(input), first);
  const next = await send({ ...input, clientMessageId: randomUUID() });
  const after = await f.db.transactions.read(tx => tx.prisma.messages.findUnique({ where: { id: next.messageId }, select: { stream_id: true } }));
  assert.equal(after.stream_id, before.stream_id);
  assert.equal((await f.inspect()).members.find(member => member.id === actor).role, 'FAN');
  await f.db.transactions.write(tx => leaveRoom(tx, DEFAULT_ROOM_ID, fan));
  await f.db.transactions.write(tx => joinRoom(tx, DEFAULT_ROOM_ID, fan));
  await assert.rejects(f.db.transactions.read(tx => getMessage(tx, DEFAULT_ROOM_ID, fan, first.messageId)), { code: 'NOT_FOUND' });
});
test('pending inbox revoked grants stay revoked on repeated send and real owner binding', async t => {
  const f = await fixture(t), bootstrap = f.service({ expectedSubject: f.subject }); await bootstrap.provision();
  const fan = await f.seed('revoked_inbox_fan');
  const actor = await f.db.transactions.write(tx => joinRoom(tx, DEFAULT_ROOM_ID, fan));
  const body = () => sendInput({ clientMessageId: randomUUID(), intent: 'ROOM_OWNER', content: { type: 'TEXT', text: '격리된 메시지' } });
  await f.db.transactions.write(tx => sendMessage(tx, DEFAULT_ROOM_ID, fan, body(), f.key));
  await f.db.transactions.write(tx => tx.prisma.stream_grants.updateMany({ where: { room_id: DEFAULT_ROOM_ID, member_id: actor }, data: { revoked_at: new Date() } }));
  await assert.rejects(f.db.transactions.write(tx => sendMessage(tx, DEFAULT_ROOM_ID, fan, body(), f.key)), { code: 'FORBIDDEN' });
  await f.seed(); await bootstrap.provision();
  await assert.rejects(f.db.transactions.write(tx => sendMessage(tx, DEFAULT_ROOM_ID, fan, body(), f.key)), { code: 'FORBIDDEN' });
});
test('replicas and delayed configuration produce only one catalog graph and one owner audit', async t => {
  const f = await fixture(t);
  await Promise.all([f.service({}).provision(), f.service({}).provision()]);
  assert.equal((await f.inspect()).rooms.length, 1); await f.seed();
  await Promise.all([f.service({ expectedSubject: f.subject }).provision(), f.service({ expectedSubject: f.subject }).provision()]);
  const state = await f.inspect(); assert.equal(state.bindings.length, 1); assert.equal(state.members.length, 1); assert.equal(state.audits, 1);
});
test('nonactive/revoked/guarded identity cannot acquire owner; unrelated existing seed ID is never adopted', async t => {
  const f = await fixture(t), id = await f.seed(f.subject, 'ACTIVE', 'REVOKED');
  const bootstrap = f.service({ expectedSubject: f.subject }); assert.equal(await bootstrap.provision(), 'awaiting_owner');
  await f.db.transactions.write(async tx => {
    await tx.prisma.platform_soop.update({ where: { user_id: id }, data: { status: 'VERIFIED' } });
    await tx.prisma.users.update({ where: { id }, data: { status: 'DELETING' } });
  });
  assert.equal(await bootstrap.provision(), 'awaiting_owner'); assert.equal((await f.inspect()).members.length, 0);
  await f.db.transactions.write(async tx => {
    await tx.prisma.users.update({ where: { id }, data: { status: 'ACTIVE' } });
    const guard = f.guards.evidence(Buffer.from(f.subject), randomUUID(), f.key);
    await tx.prisma.identity_subject_guards.updateMany({ where: { subject_hmac: Buffer.from(guard.subjectHmac, 'hex') }, data: { request_id: randomUUID(), user_id: id } });
  });
  await assert.rejects(bootstrap.provision()); assert.equal((await f.inspect()).members.length, 0);
});
test('bootstrap conflict with an existing catalog ID rolls back registry and never grants capabilities', async t => {
  const f = await fixture(t); await f.seed();
  await f.db.transactions.write(async tx => { await createRoom(tx, '후로기', 'FAN', DEFAULT_ROOM_ID); await tx.prisma.rooms.update({ where: { id: DEFAULT_ROOM_ID }, data: { status: 'CLOSED' } }); });
  await assert.rejects(f.service({ expectedSubject: f.subject }).provision(), /default_room_conflict/);
  const state = await f.inspect(); assert.equal(state.bindings.length, 0); assert.equal(state.members.length, 0); assert.equal(state.admins, 0);
});
test('closed never-bound catalog is not silently reopened; arbitrary ownerless rooms cannot accept ROOM_OWNER', async t => {
  const f = await fixture(t), bootstrap = f.service({ expectedSubject: f.subject });
  await bootstrap.provision(); const fan = await f.seed('closed_catalog_fan');
  const other = await f.db.transactions.write(async tx => {
    await tx.prisma.rooms.update({ where: { id: DEFAULT_ROOM_ID }, data: { status: 'CLOSED' } });
    const room = await createRoom(tx, '격리된 별도 방', 'FAN'); await joinRoom(tx, room, fan); return room;
  });
  await assert.rejects(bootstrap.provision(), /default_room_conflict/);
  assert.equal((await f.inspect()).rooms.find(room => room.id === DEFAULT_ROOM_ID).status, 'CLOSED');
  const input = sendInput({ clientMessageId: randomUUID(), intent: 'ROOM_OWNER', content: { type: 'TEXT', text: '허가 없는 수신함' } });
  await assert.rejects(f.db.transactions.write(tx => sendMessage(tx, other, fan, input, f.key)), { code: 'NOT_FOUND' });
  assert.equal(await f.db.transactions.read(tx => tx.prisma.messages.count()), 0);
});
