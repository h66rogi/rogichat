import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createConnection } from 'mysql2/promise';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaDatabase } from '../../dist/infrastructure/database/database.js';
import { createPrisma } from '../../dist/infrastructure/database/prisma-provider.js';
import { Transactions } from '../../dist/infrastructure/database/transactions.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';

const lock = () => { let release; return { promise: new Promise(resolve => { release = resolve; }), release: () => release() }; };

test('generated CRUD preserves uint64, UTC milliseconds and bytes; raw uint32 is numeric', async t => {
  const db = new PrismaDatabase(readConfig('api')); t.after(() => db.close());
  const id = randomUUID(), sessionId = randomUUID(), token = randomBytes(32), csrf = randomBytes(32);
  const now = new Date('2026-09-20T01:02:03.456Z'), generation = 18446744073709551610n;
  await db.transactions.write(async tx => {
    await tx.prisma.users.create({ data: { id, membership_generation: generation, created_at: now }, select: { id: true } });
    await tx.prisma.auth_sessions.create({ data: { id: sessionId, user_id: id, token_digest: new Uint8Array(token), csrf_digest: new Uint8Array(csrf), audience: 'test', expires_at: now }, select: { id: true } });
  });
  await db.transactions.read(async tx => {
    const row = await tx.prisma.users.findUniqueOrThrow({ where: { id }, select: { membership_generation: true, created_at: true } });
    assert.deepEqual(row, { membership_generation: generation, created_at: now });
    const session = await tx.prisma.auth_sessions.findUniqueOrThrow({ where: { id: sessionId }, select: { token_digest: true, csrf_digest: true } });
    assert.deepEqual(Buffer.from(session.token_digest), token); assert.deepEqual(Buffer.from(session.csrf_digest), csrf);
    const [raw] = await tx.rows('SELECT membership_generation FROM users WHERE id=?', [id]);
    assert.equal(raw.membership_generation, generation.toString());
  });
  const job = randomUUID();
  await db.transactions.write(tx => tx.prisma.jobs.create({ data: { id: job, purpose: 'LEDGER_EXPORT', state: 'COMPLETED' }, select: { id: true } }));
  const [row] = await db.transactions.read(tx => tx.rows('SELECT attempts,max_attempts,generation FROM jobs WHERE id=?', [job]));
  assert.equal(row.attempts, 0); assert.equal(row.max_attempts, 5); assert.equal(row.generation, '0');
});

test('database read-only RR begins before domain reads, maintains snapshot and resets session for writer', async t => {
  const config = readConfig('api', { ...process.env, DB_POOL_SIZE: '1' });
  const db = new PrismaDatabase(config); t.after(() => db.close());
  const observer = new PrismaDatabase(readConfig('api')); t.after(() => observer.close());
  const id = randomUUID();
  await db.transactions.write(tx => tx.prisma.users.create({ data: { id }, select: { id: true } }));
  await db.transactions.read(async tx => {
    assert.equal((await tx.prisma.users.findUniqueOrThrow({ where: { id }, select: { status: true } })).status, 'ACTIVE');
    await observer.transactions.write(writer => writer.prisma.users.update({ where: { id }, data: { status: 'SUSPENDED' }, select: { id: true } }));
    assert.equal((await tx.prisma.users.findUniqueOrThrow({ where: { id }, select: { status: true } })).status, 'ACTIVE');
    await assert.rejects(tx.prisma.users.update({ where: { id }, data: { status: 'DELETED' } }), error => error.meta?.driverAdapterError?.cause?.code === 1792);
    await tx.rows("SET SESSION time_zone = '+09:00'");
    await tx.rows('SET SESSION innodb_lock_wait_timeout = 19');
  });
  await db.transactions.write(async tx => {
    const [settings] = await tx.rows('SELECT @@session.time_zone AS zone,@@session.innodb_lock_wait_timeout AS lock_wait');
    assert.equal(settings.zone, '+00:00'); assert.equal(Number(settings.lock_wait), 2);
    assert.equal((await tx.prisma.users.findUniqueOrThrow({ where: { id }, select: { status: true } })).status, 'SUSPENDED');
    await tx.prisma.users.update({ where: { id }, data: { status: 'ACTIVE' }, select: { id: true } });
  });
});

test('outer deadline aborts the connection and rejects cached delegate and pre-created lazy promise', { timeout: 5000 }, async t => {
  const runtime = createPrisma(readConfig('api')); t.after(() => runtime.client.$disconnect());
  const transactions = new Transactions(runtime.client, runtime.context);
  const id = randomUUID();
  await transactions.write(tx => tx.prisma.users.create({ data: { id }, select: { id: true } }));
  // Keep Prisma's own timer longer than the application deadline to exercise our guard.
  const original = runtime.client.$transaction.bind(runtime.client);
  runtime.client.$transaction = callback => original(callback, { timeout: 3000 });
  const schedule = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, milliseconds, ...args) => schedule(callback, milliseconds === 8000 ? 100 : milliseconds, ...args));
  const resume = lock(), entered = lock(); let delegate, lazy;
  const pending = transactions.write(async tx => {
    delegate = tx.prisma.users;
    await delegate.update({ where: { id }, data: { status: 'SUSPENDED' }, select: { id: true } });
    lazy = delegate.update({ where: { id }, data: { status: 'DELETED' }, select: { id: true } });
    entered.release(); await resume.promise;
  });
  await entered.promise;
  await assert.rejects(pending, /transaction_timeout/);
  await assert.rejects(delegate.findUnique({ where: { id } }));
  await assert.rejects(lazy);
  resume.release(); await delay(20);
  assert.equal((await transactions.read(tx => tx.prisma.users.findUniqueOrThrow({ where: { id }, select: { status: true } }))).status, 'ACTIVE');
});

test('lost acknowledgement after actual COMMIT never replays the callback even with lock-shaped error', async t => {
  const original = PrismaMariaDb.prototype.connect;
  t.mock.method(PrismaMariaDb.prototype, 'connect', async function () {
    const adapter = await original.call(this), start = adapter.startTransaction.bind(adapter);
    adapter.startTransaction = async isolation => {
      const tx = await start(isolation), commit = tx.commit.bind(tx);
      tx.commit = async () => { await commit(); throw Object.assign(new Error('lost_commit_ack'), { code: 'P2034' }); };
      return tx;
    };
    return adapter;
  });
  const db = new PrismaDatabase(readConfig('api')); t.after(() => db.close());
  const observer = await createConnection(process.env.TEST_ADMIN_URL); t.after(() => observer.end());
  const id = randomUUID(); let calls = 0;
  await assert.rejects(db.transactions.write(async tx => { calls++; await tx.prisma.users.create({ data: { id }, select: { id: true } }); }), /commit_outcome_unknown/);
  assert.equal(calls, 1);
  const [rows] = await observer.query('SELECT id FROM users WHERE id=?', [id]);
  assert.equal(rows.length, 1);
});

test('statement wall deadline aborts real MySQL query and rolls back preceding ORM mutation', async t => {
  const db = new PrismaDatabase(readConfig('api')); t.after(() => db.close());
  const id = randomUUID(); await db.transactions.write(tx => tx.prisma.users.create({ data: { id }, select: { id: true } }));
  const schedule = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => schedule(callback, ms === 3000 ? 100 : ms, ...args));
  await assert.rejects(db.transactions.write(async tx => {
    await tx.prisma.users.update({ where: { id }, data: { status: 'SUSPENDED' }, select: { id: true } });
    await tx.rows('SELECT SLEEP(2) AS slept');
  }));
  assert.equal((await db.transactions.read(tx => tx.prisma.users.findUniqueOrThrow({ where: { id }, select: { status: true } }))).status, 'ACTIVE');
});

test('failed real-session checkout is discarded and next writer receives clean settings', async t => {
  const original = PrismaMariaDb.prototype.connect;
  let fail = true;
  t.mock.method(PrismaMariaDb.prototype, 'connect', async function () {
    const adapter = await original.call(this), pool = adapter.underlyingDriver(), acquire = pool.getConnection.bind(pool);
    pool.getConnection = async () => {
      const connection = await acquire(), query = connection.query.bind(connection);
      connection.query = (...args) => {
        if (fail && args[0] === 'SET TRANSACTION READ ONLY') { fail = false; return Promise.reject(new Error('injected_setup_failure')); }
        return query(...args);
      };
      return connection;
    };
    return adapter;
  });
  const config = readConfig('api', { ...process.env, DB_POOL_SIZE: '1' });
  const db = new PrismaDatabase(config); t.after(() => db.close());
  let called = false;
  await assert.rejects(db.transactions.read(async () => { called = true; }));
  assert.equal(called, false);
  await db.transactions.write(async tx => {
    const [row] = await tx.rows('SELECT @@session.time_zone AS zone,@@session.innodb_lock_wait_timeout AS lock_wait');
    assert.equal(row.zone, '+00:00'); assert.equal(Number(row.lock_wait), 2);
    await tx.prisma.users.create({ data: { id: randomUUID() }, select: { id: true } });
  });
});

test('maxWait cancellation hard-closes a checked-out connection during delayed BEGIN without late callback', async t => {
  const original = PrismaMariaDb.prototype.connect;
  const resume = lock(), entered = lock(); let paused = false, destroyed = 0, called = false;
  t.after(() => resume.release());
  t.mock.method(PrismaMariaDb.prototype, 'connect', async function () {
    const adapter = await original.call(this), pool = adapter.underlyingDriver(), acquire = pool.getConnection.bind(pool);
    pool.getConnection = async () => {
      const connection = await acquire(), query = connection.query.bind(connection), destroy = connection.destroy.bind(connection);
      connection.destroy = () => { destroyed++; destroy(); };
      connection.query = async (...args) => {
        if (!paused && args[0]?.sql === 'BEGIN') { paused = true; entered.release(); await resume.promise; }
        return query(...args);
      };
      return connection;
    };
    return adapter;
  });
  const config = readConfig('api', { ...process.env, DB_POOL_SIZE: '1' });
  const db = new PrismaDatabase(config); t.after(() => db.close());
  const pending = db.transactions.write(async () => { called = true; });
  await entered.promise;
  await assert.rejects(pending);
  assert.equal(destroyed, 1); assert.equal(called, false);
  resume.release(); await delay(20);
  await db.transactions.write(tx => tx.prisma.users.create({ data: { id: randomUUID() }, select: { id: true } }));
  assert.equal(called, false);
});
