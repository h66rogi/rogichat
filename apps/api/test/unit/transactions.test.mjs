import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Transactions } from '../../dist/infrastructure/database/transactions.js';
import { DatabaseUnavailableError } from '../../dist/infrastructure/database/database-unavailable.js';

function harness(overrides = {}) {
  const context = new AsyncLocalStorage();
  const counts = { acquired: 0, queries: 0, committed: 0, rolledBack: 0 };
  const client = {
    async $transaction(callback) {
      counts.acquired++;
      const state = context.getStore();
      await overrides.acquire?.();
      try {
        const result = await callback({
          $queryRaw: async (...args) => { counts.queries++; return overrides.query?.(...args) ?? []; },
          $executeRaw: async (...args) => { counts.queries++; return overrides.execute?.(...args) ?? 1; },
        });
        state.commitStarted = true;
        counts.committed++;
        await overrides.commit?.();
        return result;
      } catch (error) {
        if (!state.commitStarted) {
          counts.rolledBack++;
          try { await overrides.rollback?.(); state.rollbackConfirmed = true; }
          catch (rollbackError) { if (!overrides.preserveOriginal) throw rollbackError; }
        }
        throw error;
      }
    },
  };
  return { transactions: new Transactions(client, context, overrides.maxPending ?? 25), counts };
}
function shortDeadline(t) {
  const schedule = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, milliseconds, ...args) => schedule(callback, milliseconds === 8000 ? 25 : milliseconds, ...args));
}
const turn = () => new Promise(resolve => setTimeout(resolve, 0));

test('callback timeout invalidates the handle and prevents late commit or queries', { timeout: 2000 }, async t => {
  shortDeadline(t);
  const { transactions, counts } = harness();
  let handle, resume;
  const pending = transactions.write(async tx => { handle = tx; await new Promise(resolve => { resume = resolve; }); });
  await assert.rejects(pending, /transaction_timeout/);
  await assert.rejects(handle.rows('SELECT 1'), /transaction_finished/);
  await assert.rejects(handle.execute('UPDATE fixture SET value=1'), /transaction_not_writable/);
  assert.throws(() => handle.prisma, /transaction_finished/);
  resume(); await turn();
  assert.equal(counts.committed, 0); assert.equal(counts.acquired, 1); assert.equal(counts.queries, 0);
});

test('read handles reject explicit mutation and all handles close after success', async () => {
  const { transactions, counts } = harness(); let handle;
  await transactions.read(async tx => { handle = tx; await assert.rejects(tx.execute('UPDATE fixture SET value=1'), /transaction_not_writable/); });
  await assert.rejects(handle.rows('SELECT 1'), /transaction_finished/);
  assert.equal(counts.queries, 0);
});

test('deadline during commit has unknown outcome and never retries', { timeout: 2000 }, async t => {
  shortDeadline(t);
  const { transactions, counts } = harness({ commit: () => new Promise(() => {}) });
  await assert.rejects(transactions.write(async () => {}), /commit_outcome_unknown/);
  assert.equal(counts.acquired, 1); assert.equal(counts.committed, 1);
});

const deadlock = () => Object.assign(new Error('deadlock'), { code: 'P2034' });
const lockTimeout = () => Object.assign(new Error('lock timeout'), { code: 'P2039', meta: { driverAdapterError: { cause: { kind: 'mysql', code: 1205 } } } });
for (const failure of [deadlock, lockTimeout]) {
  test(`confirmed rollback retries ${failure.name} at most three attempts`, async () => {
    const { transactions, counts } = harness(); const error = failure();
    await assert.rejects(transactions.write(async () => { throw error; }), e => e === error);
    assert.equal(counts.acquired, 3); assert.equal(counts.rolledBack, 3); assert.equal(counts.committed, 0);
  });
  test(`commit ${failure.name} is never replayed`, async () => {
    const cause = failure(); const { transactions, counts } = harness({ commit: async () => { throw cause; } });
    await assert.rejects(transactions.write(async () => {}), e => e.message === 'commit_outcome_unknown' && e.cause === cause);
    assert.equal(counts.acquired, 1);
  });
  test(`unconfirmed rollback cannot retry ${failure.name}`, async () => {
    const { transactions, counts } = harness({ rollback: async () => { throw new Error('connection_lost'); } });
    await assert.rejects(transactions.write(async () => { throw failure(); }), /connection_lost/);
    assert.equal(counts.acquired, 1);
  });
}

test('ordinary callback error and P2028 are not retryable', async () => {
  for (const error of [new Error('validation'), Object.assign(new Error('closed'), { code: 'P2028' })]) {
    const { transactions, counts } = harness();
    await assert.rejects(transactions.write(async () => { throw error; }), e => e === error);
    assert.equal(counts.acquired, 1); assert.equal(counts.rolledBack, 1);
  }
});

test('raw exceptions preserve bound values and legacy byte/counter field contracts', async () => {
  const { transactions } = harness({ query: async sql => {
    assert.equal(sql.sql, 'SELECT ? AS value'); assert.deepEqual(sql.values, ["x' OR 1=1"]);
    return [{ counter: 9007199254740993n, bytes: new Uint8Array([0, 128, 255]) }];
  } });
  const [row] = await transactions.read(tx => tx.rows('SELECT ? AS value', ["x' OR 1=1"]));
  assert.equal(row.counter, '9007199254740993'); assert.deepEqual(row.bytes, Buffer.from([0, 128, 255]));
});

for (const rollbackFails of [false, true]) {
  test(`unique violation rollback evidence is ${!rollbackFails} even when Prisma preserves callback error`, async () => {
    const { transactions, counts } = harness({ preserveOriginal: true, rollback: async () => { if (rollbackFails) throw new Error('lost_rollback'); } });
    const error = Object.assign(new Error('unique'), { code: 'P2002' });
    await assert.rejects(transactions.write(async () => { throw error; }), e => e === error);
    assert.equal(transactions.rollbackConfirmed(error), !rollbackFails);
    assert.equal(counts.acquired, 1);
  });
}

test('short readiness budget includes cold startup and suppresses its late callback', async () => {
  let resume, called = false;
  const { transactions, counts } = harness({ acquire: () => new Promise(resolve => { resume = resolve; }) });
  await assert.rejects(transactions.read(async () => { called = true; }, 20), /transaction_timeout/);
  resume(); await turn();
  assert.equal(called, false); assert.equal(counts.committed, 0); assert.equal(counts.queries, 0);
  for (const budget of [0, -1, 8001, Infinity]) assert.throws(() => transactions.read(async () => {}, budget), /invalid_transaction_deadline/);
});

test('admission bounds driver work and recovers after both success and failure', async () => {
  let resume;
  const { transactions, counts } = harness({ maxPending: 1 });
  const pending = transactions.read(() => new Promise(resolve => { resume = resolve; }));
  await turn();
  await assert.rejects(transactions.write(async () => assert.fail('must not execute')), error => error instanceof DatabaseUnavailableError && error.reason === 'database_admission');
  assert.equal(counts.acquired, 1);
  resume(); await pending;
  await assert.rejects(transactions.write(async () => { throw new Error('ordinary'); }), /ordinary/);
  assert.equal(await transactions.read(async () => 'recovered'), 'recovered');
});

test('timed out checkout retains admission until driver settlement and cannot execute late', async () => {
  let resume, called = false;
  const { transactions, counts } = harness({ maxPending: 1, acquire: () => new Promise(resolve => { resume = resolve; }) });
  await assert.rejects(transactions.read(async () => { called = true; }, 20), /transaction_timeout/);
  await assert.rejects(transactions.read(async () => {}), /database_admission/);
  assert.equal(counts.acquired, 1);
  resume(); await turn();
  assert.equal(called, false);
  const next = transactions.read(async () => 'recovered');
  await turn(); resume(); assert.equal(await next, 'recovered');
});

test('pre-callback acquisition failures are unavailable without replay; callback P2028 remains unchanged', async () => {
  for (const code of ['P2024', 'P2028']) {
    const { transactions, counts } = harness({ acquire: async () => { throw Object.assign(new Error('private-marker'), { code }); } });
    await assert.rejects(transactions.write(async () => assert.fail('must not execute')), error => error instanceof DatabaseUnavailableError && error.reason === 'database_acquisition');
    assert.equal(counts.acquired, 1);
  }
});
