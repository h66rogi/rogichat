// Every test owns a fresh disposable schema; no runtime fixtures or live DB access.
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createConnection } from 'mysql2/promise';
import { NestFactory } from '@nestjs/core';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { PrismaDatabase } from '../../dist/infrastructure/database/database.js';
import { DatabaseModule } from '../../dist/infrastructure/database/database.module.js';
import { migrationManifest } from '../../dist/infrastructure/database/schema-manifest.js';
import { OwnerBootstrapModule } from '../../dist/modules/owner-bootstrap/owner-bootstrap.module.js';
import { OwnerBootstrapRepository } from '../../dist/modules/owner-bootstrap/owner-bootstrap.repository.js';
import { OwnerBootstrapService } from '../../dist/modules/owner-bootstrap/owner-bootstrap.service.js';
import { IdentityGuardService } from '../../dist/modules/auth/identity-guard.service.js';
import { IdentityGuardRepository } from '../../dist/modules/auth/identity-guard.repository.js';

async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const url = new URL(process.env.TEST_ADMIN_URL), original = url.pathname.slice(1), schema = `bootstrap_${randomBytes(8).toString('hex')}`;
  assert.match(original, /^rogichat_test_[a-f0-9]+$/);
  const admin = await createConnection({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: original, multipleStatements: true });
  let app, db, other;
  t.after(async () => { await app?.close(); await db?.close(); await other?.close(); await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``); await admin.end(); });
  await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await admin.query(`USE \`${schema}\``);
  for (const migration of migrationManifest) await admin.query(await readFile(new URL(`../../prisma/migrations/${migration.name}/migration.sql`, import.meta.url), 'utf8'));
  await admin.query(`CREATE TABLE _prisma_migrations LIKE \`${original}\`._prisma_migrations`);
  await admin.query(`INSERT INTO _prisma_migrations SELECT * FROM \`${original}\`._prisma_migrations`);
  url.pathname = `/${schema}`;
  const config = readConfig('worker', { ...process.env, DATABASE_URL: url.href, DB_POOL_SIZE: '2' });
  db = new PrismaDatabase(config); other = new PrismaDatabase(config);
  const key = randomBytes(32);
  app = await NestFactory.createApplicationContext(OwnerBootstrapModule.register(DatabaseModule.register({ database: db, externallyOwned: true }),
    { environment: 'qa', identityGuardKey: key }), { logger: false, abortOnError: false });
  const service = app.get(OwnerBootstrapService);
  const r = { version: 1, scope: 'INITIAL_OWNER', environment: 'qa', requestId: randomUUID(), ownerUserId: randomUUID(),
    expectedProvider: 'soop', expectedSubject: `isolated-${randomUUID()}`, roomId: randomUUID(), name: '격리 소유자 방', mode: 'FAN', historyPolicy: 'SINCE_JOIN', grantCreator: true, grantManageRooms: true };
  const seed = async (request = r) => db.transactions.write(async tx => {
    await tx.prisma.users.create({ data: { id: request.ownerUserId }, select: { id: true } });
    await tx.prisma.platform_soop.create({ data: { id: randomUUID(), user_id: request.ownerUserId, provider_subject: Buffer.from(request.expectedSubject), verified_at: await tx.now() }, select: { id: true } });
  });
  const inspect = () => db.transactions.read(async tx => ({
    rooms: await tx.prisma.rooms.findMany({ select: { id: true, name: true, owner_member_id: true, history_policy: true } }),
    counters: await tx.prisma.room_counters.findMany(), streams: await tx.prisma.message_streams.findMany(),
    members: await tx.prisma.room_members.findMany(), periods: await tx.prisma.membership_periods.findMany(),
    creators: await tx.prisma.creator_accounts.findMany(), admins: await tx.prisma.admin_capabilities.findMany(),
    audits: await tx.prisma.audit_events.findMany({ orderBy: { id: 'asc' } }),
    users: await tx.prisma.users.findMany({ orderBy: { id: 'asc' } }),
    sessions: await tx.prisma.auth_sessions.count(), messages: await tx.prisma.messages.count(),
  }));
  return { db, other, service, repository: app.get(OwnerBootstrapRepository), r, seed, inspect, key };
}

test('empty DB refuses fabrication; real verified binding produces full atomic room and exact replay', async t => {
  const f = await fixture(t), empty = await f.inspect();
  await assert.rejects(f.service.provision(f.r)); assert.deepEqual(await f.inspect(), empty);
  await f.seed(); const before = await f.inspect();
  await assert.rejects(f.service.provision({ ...f.r, expectedSubject: 'wrong' })); assert.deepEqual(await f.inspect(), before);
  await assert.rejects(f.service.provision({ ...f.r, grantCreator: false })); assert.deepEqual(await f.inspect(), before);
  assert.deepEqual(await f.service.provision(f.r), { status: 'applied', roomId: f.r.roomId });
  const applied = await f.inspect();
  assert.equal(applied.rooms.length, 1); assert.equal(applied.rooms[0].id, f.r.roomId);
  assert.equal(applied.counters[0].last_order, 1n); assert.equal(applied.streams[0].kind, 'ROOM_SHARED');
  assert.equal(applied.members[0].role, 'STREAMER'); assert.equal(applied.members[0].active_period_id, applied.periods[0].id);
  assert.equal(applied.rooms[0].owner_member_id, applied.members[0].id); assert.equal(applied.periods[0].visible_from_order, 1n);
  assert.equal(applied.users[0].membership_generation, 1n); assert.equal(applied.creators[0].enabled, true);
  assert.deepEqual([applied.admins[0].manage_rooms, applied.admins[0].manage_users, applied.admins[0].manage_stickers], [true, false, false]);
  assert.equal(applied.audits.length, 3); assert.equal(applied.sessions, 0); assert.equal(applied.messages, 0);
  for (let i = 0; i < 2; i++) assert.equal((await f.service.provision(f.r)).status, 'already_applied');
  assert.deepEqual(await f.inspect(), applied);
  for (const patch of [{ requestId: randomUUID() }, { name: '변경' }, { roomId: randomUUID() }, { historyPolicy: 'ALL_AVAILABLE' }, { grantManageRooms: false }]) {
    await assert.rejects(f.service.provision({ ...f.r, ...patch })); assert.deepEqual(await f.inspect(), applied);
  }
  await f.db.transactions.write(tx => tx.prisma.room_members.update({ where: { id: applied.members[0].id }, data: { role: 'FAN' } }));
  const changed = await f.inspect(); await assert.rejects(f.service.provision(f.r)); assert.deepEqual(await f.inspect(), changed);
});

test('creator-only request grants no administrator; ALL_AVAILABLE boundary reuses domain policy', async t => {
  const f = await fixture(t); await f.seed(); f.r.grantManageRooms = false; f.r.historyPolicy = 'ALL_AVAILABLE';
  await f.service.provision(f.r); const result = await f.inspect();
  assert.equal(result.admins.length, 0); assert.equal(result.periods[0].visible_from_order, 0n);
});

test('different owners/rooms race: global receipt permits exactly one and rolls back losing grants', async t => {
  const f = await fixture(t), second = { ...f.r, ownerUserId: randomUUID(), roomId: randomUUID(), requestId: randomUUID(), expectedSubject: `isolated-${randomUUID()}` };
  await f.seed(); await f.seed(second);
  const result = await Promise.allSettled([f.service.provision(f.r), f.service.provision(second)]);
  assert.equal(result.filter(x => x.status === 'fulfilled').length, 1);
  const state = await f.inspect(); assert.equal(state.rooms.length, 1); assert.equal(state.creators.length, 1); assert.equal(state.admins.length, 1); assert.equal(state.audits.length, 3);
});

test('same request race and simulated lost response safely recover one committed result', async t => {
  const f = await fixture(t); await f.seed();
  const result = await Promise.all([f.service.provision(f.r), f.service.provision(f.r)]);
  assert.deepEqual(result.map(x => x.status).sort(), ['already_applied', 'applied']);
  // Drop the first result, exactly as an operator losing the command response would.
  const before = await f.inspect(); assert.equal((await f.service.provision(f.r)).status, 'already_applied'); assert.deepEqual(await f.inspect(), before);
});

test('initial-only rejects multiple preexisting rooms without changing them or granting capabilities', async t => {
  const f = await fixture(t); await f.seed();
  await f.db.transactions.write(tx => tx.prisma.rooms.createMany({ data: [1, 2].map(() => ({ id: randomUUID(), name: f.r.name, mode: 'FAN' })) }));
  const before = await f.inspect(); await assert.rejects(f.service.provision(f.r)); assert.deepEqual(await f.inspect(), before);
});

test('identity deletion guard and nonactive account fail closed', async t => {
  const f = await fixture(t); await f.seed();
  await f.db.transactions.write(tx => tx.prisma.users.update({ where: { id: f.r.ownerUserId }, data: { status: 'DELETING' } }));
  let before = await f.inspect(); await assert.rejects(f.service.provision(f.r)); assert.deepEqual(await f.inspect(), before);
  await f.db.transactions.write(async tx => {
    await tx.prisma.users.update({ where: { id: f.r.ownerUserId }, data: { status: 'ACTIVE' } });
    const guard = new IdentityGuardService(new IdentityGuardRepository()).evidence(Buffer.from(f.r.expectedSubject), randomUUID(), f.key);
    await tx.prisma.identity_subject_guards.create({ data: { subject_hmac: Buffer.from(guard.subjectHmac, 'hex'), key_version: 1, key_fingerprint: Buffer.from(guard.keyFingerprint, 'hex'), request_id: randomUUID(), user_id: f.r.ownerUserId } });
  });
  before = await f.inspect(); await assert.rejects(f.service.provision(f.r)); assert.deepEqual(await f.inspect(), before);
});

test('NOWAIT refuses an inverse-order account holder instead of deadlocking with its room lock', async t => {
  const f = await fixture(t); await f.seed(); const held = Promise.withResolvers(), release = Promise.withResolvers();
  const owner = f.other.transactions.write(async tx => {
    await tx.rows('SELECT id FROM users WHERE id=? FOR UPDATE', [f.r.ownerUserId]); held.resolve(); await release.promise;
    await tx.rows('SELECT id FROM rooms WHERE id=? FOR UPDATE', [f.r.roomId]);
  });
  try { await held.promise; await assert.rejects(f.service.provision(f.r)); }
  finally { release.resolve(); await owner; }
  assert.equal((await f.inspect()).audits.length, 0); await f.service.provision(f.r);
});


test('failure after domain creation rolls back grants, room graph, generation and all receipts', async t => {
  const f = await fixture(t); await f.seed(); const before = await f.inspect();
  const original = f.repository.receipt.bind(f.repository);
  f.repository.receipt = async () => { throw new Error('isolated-receipt-failure'); };
  await assert.rejects(f.service.provision(f.r), /isolated-receipt-failure/);
  assert.deepEqual(await f.inspect(), before);
  f.repository.receipt = original;
  assert.equal((await f.service.provision(f.r)).status, 'applied');
});
