import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Transactions } from '../../dist/transactions.js';

function harness(overrides = {}) {
  const counts = { acquired: 0, queries: 0, committed: 0, rolledBack: 0, destroyed: 0, released: 0 };
  const pool = {
    getConnection(callback) {
      counts.acquired++;
      const connection = {
        promise: () => ({
          query: async (...args) => { counts.queries++; return overrides.query ? overrides.query(...args) : [[]]; },
          commit: async () => { counts.committed++; await overrides.commit?.(); },
          rollback: async () => { counts.rolledBack++; await overrides.rollback?.(); },
        }),
        destroy: () => { counts.destroyed++; },
        release: () => { counts.released++; },
      };
      callback(null, connection);
    },
  };
  return { transactions: new Transactions(pool), counts };
}

function shortDeadline(t) {
  const schedule = globalThis.setTimeout;
  let scheduled = 0;
  // Exercise the production timeout branch without adding eight seconds per case.
  t.mock.method(globalThis, 'setTimeout', (callback, milliseconds, ...args) => {
    if (milliseconds === 8000) scheduled++;
    return schedule(callback, milliseconds === 8000 ? 30 : milliseconds, ...args);
  });
  return () => assert.ok(scheduled > 0, 'the bounded transaction deadline must be scheduled');
}

const turn = () => new Promise(resolve => setTimeout(resolve, 0));

test('callback timeout settles promptly, invalidates late queries and forbids a late commit', { timeout: 2000 }, async t => {
  const verifyDeadline = shortDeadline(t);
  const { transactions, counts } = harness();
  let handle;
  let resume;
  const pending = transactions.write(async tx => {
    handle = tx;
    await new Promise(resolve => { resume = resolve; });
    return 'late-result';
  });
  await assert.rejects(pending, /transaction_timeout/);
  assert.ok(handle);
  const queriesAtTimeout = counts.queries;
  await assert.rejects(handle.rows('SELECT 1'), /transaction_finished/);
  await assert.rejects(handle.execute('UPDATE fixture SET value=1'), /transaction_not_writable/);
  resume();
  await turn();
  assert.equal(counts.queries, queriesAtTimeout);
  assert.equal(counts.committed, 0);
  assert.equal(counts.acquired, 1);
  assert.equal(counts.released, 0);
  assert.ok(counts.destroyed > 0);
  verifyDeadline();
});

for (const setupStep of ['SET SESSION time_zone', 'START TRANSACTION']) {
  test(`deadline bounds ${setupStep} and prevents a callback after late setup completion`, { timeout: 2000 }, async t => {
    const verifyDeadline = shortDeadline(t);
    let resume;
    let operations = 0;
    const { transactions, counts } = harness({ query: input => {
      const sql = typeof input === 'string' ? input : input.sql;
      if (sql.startsWith(setupStep)) return new Promise(resolve => { resume = resolve; });
      return [[]];
    } });
    await assert.rejects(transactions.write(async () => { operations++; }), /transaction_timeout/);
    resume([[]]);
    await turn();
    assert.equal(operations, 0);
    assert.equal(counts.committed, 0);
    assert.equal(counts.released, 0);
    assert.ok(counts.destroyed > 0);
    verifyDeadline();
  });
}

test('deadline during COMMIT settles with unknown outcome and never retries', { timeout: 2000 }, async t => {
  const verifyDeadline = shortDeadline(t);
  const { transactions, counts } = harness({ commit: () => new Promise(() => {}) });
  let operations = 0;
  await assert.rejects(transactions.write(async () => { operations++; }), /commit_outcome_unknown/);
  assert.equal(operations, 1);
  assert.equal(counts.acquired, 1);
  assert.equal(counts.committed, 1);
  assert.equal(counts.released, 0);
  assert.ok(counts.destroyed > 0);
  verifyDeadline();
});

test('COMMIT errors are never retried even when their driver code resembles a retryable lock failure', async () => {
  const cause = Object.assign(new Error('commit-fixture'), { code: 'ER_LOCK_DEADLOCK' });
  const { transactions, counts } = harness({ commit: async () => { throw cause; } });
  let operations = 0;
  await assert.rejects(transactions.write(async () => { operations++; }), error => {
    assert.equal(error.message, 'commit_outcome_unknown');
    assert.equal(error.cause, cause);
    return true;
  });
  assert.equal(operations, 1);
  assert.equal(counts.acquired, 1);
  assert.equal(counts.committed, 1);
  assert.equal(counts.released, 0);
});

for (const code of ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']) {
  test(`${code} retries at most three complete transactions`, async () => {
    const failure = Object.assign(new Error('lock-fixture'), { code });
    const { transactions, counts } = harness();
    const handles = new Set();
    await assert.rejects(transactions.write(async tx => { handles.add(tx); throw failure; }), error => error === failure);
    assert.equal(handles.size, 3);
    assert.equal(counts.acquired, 3);
    assert.equal(counts.rolledBack, 3);
    assert.equal(counts.released, 3);
    assert.equal(counts.committed, 0);
  });
}

test('non-lock callback failures are rolled back without retry', async () => {
  const failure = new Error('validation-fixture');
  const { transactions, counts } = harness();
  await assert.rejects(transactions.write(async () => { throw failure; }), error => error === failure);
  assert.equal(counts.acquired, 1);
  assert.equal(counts.rolledBack, 1);
  assert.equal(counts.released, 1);
  assert.equal(counts.committed, 0);
});

test('rollback stalls remain bounded and destroy rather than release the connection', { timeout: 2000 }, async t => {
  const verifyDeadline = shortDeadline(t);
  const failure = new Error('validation-fixture');
  const { transactions, counts } = harness({ rollback: () => new Promise(() => {}) });
  await assert.rejects(transactions.write(async () => { throw failure; }), error => error === failure);
  assert.equal(counts.acquired, 1);
  assert.equal(counts.rolledBack, 1);
  assert.equal(counts.released, 0);
  assert.equal(counts.committed, 0);
  assert.ok(counts.destroyed > 0);
  verifyDeadline();
});
