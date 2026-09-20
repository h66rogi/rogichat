import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { TransactionAdapter, poolOptions } from '../../dist/infrastructure/database/prisma-provider.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { sampleEnv } from '../helpers.mjs';

function fixture(t, options = {}) {
  const statements = [], counts = { destroyed: 0, committed: 0, rolledBack: 0, submitted: 0 };
  const info = {}; const connection = { info, release: async () => {}, query: async sql => { statements.push(sql); await options.query?.(sql); }, destroy: () => { counts.destroyed++; } };
  const pool = { getConnection: async () => { await options.acquire?.(); return connection; } };
  t.mock.method(PrismaMariaDb.prototype, 'connect', async () => ({
    underlyingDriver: () => pool,
    startTransaction: async () => {
      const conn = await pool.getConnection();
      await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await conn.query('BEGIN');
      return {
        queryRaw: async () => { counts.submitted++; await options.statement?.(); return {}; }, executeRaw: async () => { counts.submitted++; return 1; },
        commit: async () => { counts.committed++; await options.commit?.(); await conn.release(); },
        rollback: async () => { counts.rolledBack++; await options.rollback?.(); await conn.release(); },
      };
    },
  }));
  const context = new AsyncLocalStorage(), state = { writable: false, closed: false, commitStarted: false, rollbackConfirmed: false };
  const factory = new TransactionAdapter(poolOptions(readConfig('api', sampleEnv, [])), context);
  return { context, state, factory, statements, counts };
}

test('checkout configures next read-only transaction before BEGIN and guards actual driver submission', async t => {
  const f = fixture(t); const adapter = await f.factory.connect();
  const tx = await f.context.run(f.state, () => adapter.startTransaction('REPEATABLE READ'));
  assert.deepEqual(f.statements, ["SET SESSION time_zone = '+00:00'", 'SET SESSION innodb_lock_wait_timeout = 2', 'SET TRANSACTION READ ONLY', 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'BEGIN']);
  assert.equal(f.statements.filter(sql => sql === 'BEGIN').length, 1);
  const cached = tx.queryRaw; f.state.closed = true; f.state.abort();
  await assert.rejects(cached({}), /transaction_finished/); await assert.rejects(tx.executeRaw({}), /transaction_finished/);
  assert.equal(f.counts.submitted, 0); assert.equal(f.counts.destroyed, 1);
  await assert.rejects(tx.commit(), /transaction_finished/); assert.equal(f.counts.committed, 0); assert.equal(f.state.rollbackConfirmed, true);
});

for (const failedStep of ['time_zone', 'innodb_lock_wait_timeout', 'SET TRANSACTION READ ONLY']) {
  test(`setup failure at ${failedStep} destroys session before it can enter pool with pending characteristics`, async t => {
    const f = fixture(t, { query: sql => { if (sql.includes(failedStep)) throw new Error('setup_failed'); } });
    const adapter = await f.factory.connect();
    await assert.rejects(f.context.run(f.state, () => adapter.startTransaction('REPEATABLE READ')), /setup_failed/);
    assert.equal(f.counts.destroyed, 1); assert.equal(f.statements.includes('BEGIN'), false);
  });
}

test('late acquisition after outer cancellation destroys connection without setup or callback', async t => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { acquire: () => pending }); const adapter = await f.factory.connect();
  const start = f.context.run(f.state, () => adapter.startTransaction());
  f.state.closed = true; release();
  await assert.rejects(start, /transaction_finished/);
  assert.deepEqual(f.statements, []); assert.equal(f.counts.destroyed, 1);
});

test('commit observation precedes driver call and failed rollback is not recorded as confirmed', async t => {
  const f = fixture(t, { commit: async () => { throw new Error('network'); }, rollback: async () => { throw new Error('network'); } });
  const adapter = await f.factory.connect(); const tx = await f.context.run(f.state, () => adapter.startTransaction());
  await assert.rejects(tx.commit(), /network/); assert.equal(f.state.commitStarted, true);
  await assert.rejects(tx.rollback(), /network/); assert.equal(f.state.rollbackConfirmed, false);
});

test('busy statement wall deadline destroys session and invalidates subsequent submissions', async t => {
  const schedule = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => schedule(callback, ms === 3000 ? 20 : ms, ...args));
  const f = fixture(t, { statement: () => new Promise(() => {}) });
  const adapter = await f.factory.connect(); const tx = await f.context.run(f.state, () => adapter.startTransaction());
  await assert.rejects(tx.queryRaw({}), /database_statement_timeout/);
  assert.equal(f.state.closed, true); assert.equal(f.counts.destroyed, 1);
  await assert.rejects(tx.queryRaw({}), /transaction_finished/); assert.equal(f.counts.submitted, 1);
});

test('early startup cancellation retains owned abort and prevents late domain submission', async t => {
  let releaseBegin; const blocked = new Promise(resolve => { releaseBegin = resolve; });
  const f = fixture(t, { query: sql => sql === 'BEGIN' ? blocked : undefined });
  const adapter = await f.factory.connect();
  const start = f.context.run(f.state, () => adapter.startTransaction());
  while (!f.statements.includes('BEGIN')) await new Promise(resolve => setTimeout(resolve, 0));
  f.state.closed = true; f.state.abort(); delete f.state.abort;
  assert.equal(f.counts.destroyed, 1);
  releaseBegin(); await assert.rejects(start, /transaction_finished/);
  assert.equal(f.counts.submitted, 0);
});

test('successful release disarms both saved abort closure and shared state handle', async t => {
  const f = fixture(t); const adapter = await f.factory.connect();
  const tx = await f.context.run(f.state, () => adapter.startTransaction());
  const abort = f.state.abort; await tx.commit();
  assert.equal(f.state.abort, undefined); abort(); assert.equal(f.counts.destroyed, 0);
});
