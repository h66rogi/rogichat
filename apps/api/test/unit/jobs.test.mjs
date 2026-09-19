import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { enqueueJob, Jobs, completeJob, retryDelayMs, runClaimedJob, JobFailure } from '../../dist/jobs.js';

function harness(rows = [], affectedRows = 1) {
  const calls = [];
  let active = false;
  const tx = {
    execute: async (sql, values = []) => { calls.push({ sql, values }); return { affectedRows }; },
    rows: async (sql, values = []) => { calls.push({ sql, values }); return rows; },
  };
  const transactions = { write: async operation => {
    assert.equal(active, false);
    active = true;
    try { return await operation(tx); } finally { active = false; }
  } };
  return { tx, transactions, calls, active: () => active };
}
function row(purpose = 'REALTIME_HINT', patch = {}) {
  return { id: randomUUID(), purpose, room_id: randomUUID(), resource_id: randomUUID(), generation: '9007199254740993', attempts: 0, max_attempts: 5, ...patch };
}
function lease(owner, patch = {}) {
  return { id: randomUUID(), purpose: 'REALTIME_HINT', roomId: null, resourceId: null,
    generation: 1n, leaseOwner: owner, leaseToken: randomUUID(), attempts: 1, maxAttempts: 5, ...patch };
}

test('enqueue accepts scoped references only and schedules from DB UTC, never content or local timestamps', async () => {
  const h = harness();
  const id = await enqueueJob(h.tx, { purpose: 'MEDIA', roomId: randomUUID(), resourceId: randomUUID(), delayMs: 2500 });
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.match(h.calls[0].sql, /TIMESTAMPADD\(MICROSECOND,\?,UTC_TIMESTAMP\(3\)\)/);
  assert.equal(h.calls[0].values.at(-1), 2_500_000);
  for (const patch of [{ payload: { text: 'private-message' } }, { body: 'private-message' },
    { purpose: 'UNKNOWN' }, { roomId: 'not-uuid' }, { resourceId: 'not-uuid' },
    { maxAttempts: 0 }, { maxAttempts: 26 }, { delayMs: -1 }, { delayMs: 86_400_001 }, { dedupeKey: randomBytes(31) }]) {
    const bad = harness();
    await assert.rejects(enqueueJob(bad.tx, { purpose: 'MEDIA', ...patch }));
    assert.equal(bad.calls.length, 0);
  }
});

test('dedupe returns existing id only for identical purpose/scope, without rescheduling its state', async () => {
  const existing = row('MEDIA');
  const h = harness([existing]);
  assert.equal(await enqueueJob(h.tx, { purpose: 'MEDIA', roomId: existing.room_id, resourceId: existing.resource_id, dedupeKey: randomBytes(32) }), existing.id);
  assert.match(h.calls[0].sql, /ON DUPLICATE KEY UPDATE id=id$/);
  assert.match(h.calls[1].sql, /purpose=\? AND dedupe_key=\? FOR UPDATE/);
  assert.doesNotMatch(h.calls[0].sql, /UPDATE .*state/);
  for (const patch of [{ roomId: randomUUID() }, { resourceId: randomUUID() }]) {
    await assert.rejects(enqueueJob(harness([existing]).tx, { purpose: 'MEDIA', roomId: existing.room_id, resourceId: existing.resource_id, dedupeKey: randomBytes(32), ...patch }), /job_dedupe_conflict/);
  }
});

test('API/worker purpose separation and bounded claims reject invalid options before querying', async () => {
  for (const [consumer, purposes] of [['api', ['MEDIA']], ['worker', ['REALTIME_HINT']], ['api', []], ['worker', ['MEDIA', 'MEDIA']]]) {
    const h = harness();
    await assert.rejects(new Jobs(h.transactions, consumer).claim({ purposes }), /job_consumer_forbidden/);
    assert.equal(h.calls.length, 0);
  }
  for (const options of [{ limit: 21 }, { limit: 0 }, { leaseMs: 999 }, { leaseMs: 300001 }]) {
    const h = harness();
    await assert.rejects(new Jobs(h.transactions, 'api').claim(options), /invalid_job_policy/);
    assert.equal(h.calls.length, 0);
  }
  assert.throws(() => new Jobs(harness().transactions, 'unknown'));
});

test('claim uses short SKIP LOCKED transaction, DB expiry and exact bigint generation fencing', async () => {
  const fixture = row();
  const h = harness([fixture]);
  const queue = new Jobs(h.transactions, 'api');
  const [claimed] = await queue.claim({ leaseMs: 2000 });
  assert.equal(h.active(), false);
  assert.match(h.calls[0].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(h.calls[0].sql, /lease_until<=UTC_TIMESTAMP\(3\)/);
  assert.deepEqual(h.calls[0].values, ['REALTIME_HINT', 20]);
  assert.equal(claimed.generation, 9007199254740994n);
  assert.equal(claimed.attempts, 1);
  assert.equal(claimed.leaseOwner, queue.ownerId);
  assert.match(claimed.leaseToken, /^[0-9a-f-]{36}$/);
  assert.ok(Object.isFrozen(claimed));
  assert.equal(h.calls[1].values[3], 2_000_000);
});

test('exhausted expired jobs fail terminally instead of being reclaimed forever', async () => {
  const h = harness([row('PURGE', { attempts: 5 })]);
  const claimed = await new Jobs(h.transactions, 'worker').claim();
  assert.deepEqual(claimed, []);
  assert.match(h.calls[1].sql, /state="FAILED"/);
  assert.match(h.calls[1].sql, /ATTEMPTS_EXHAUSTED/);
  assert.match(h.calls[1].sql, /lease_owner=NULL,lease_token=NULL,lease_until=NULL/);
});

test('complete, renew and retry all require live owner/token/generation and allowlisted purpose', async () => {
  const h = harness();
  const queue = new Jobs(h.transactions, 'api');
  const claimed = lease(queue.ownerId);
  assert.equal(await queue.complete(claimed), true);
  assert.equal(await queue.renew(claimed, 1000), true);
  assert.equal(await queue.retry(claimed, 'DEPENDENCY_TIMEOUT', { delayMs: 30 }), true);
  for (const call of h.calls) {
    assert.match(call.sql, /id=\? AND purpose=\? AND generation=\? AND lease_owner=\? AND lease_token=\? AND state="RUNNING" AND lease_until>UTC_TIMESTAMP\(3\)/);
    assert.deepEqual(call.values.slice(-5), [claimed.id, claimed.purpose, '1', queue.ownerId, claimed.leaseToken]);
  }
  assert.match(h.calls[2].sql, /attempts>=max_attempts/);
  assert.throws(() => queue.retry(claimed, 'provider response includes private body'), /invalid_job_error_code/);
  assert.throws(() => queue.complete({ ...claimed, leaseOwner: randomUUID() }), /job_consumer_forbidden/);
  assert.throws(() => queue.renew({ ...claimed, purpose: 'MEDIA' }), /job_consumer_forbidden/);
  assert.equal(await completeJob(harness([], 0).tx, claimed), false);
});

test('backoff is exponential, jittered and capped without trusting arbitrary error strings', () => {
  assert.equal(retryDelayMs(1, 0), 500);
  assert.equal(retryDelayMs(1, 1), 1500);
  assert.equal(retryDelayMs(2, 0.5), 2000);
  assert.equal(retryDelayMs(25, 1), 900000);
  for (const [attempt, jitter] of [[0, 0], [26, 0], [1, -1], [1, 2], [1, NaN]]) assert.throws(() => retryDelayMs(attempt, jitter));
  assert.throws(() => new JobFailure('private-provider-error'), /invalid_job_error_code/);
});

test('transport effect executes outside any transaction, with sanitized retry and no commit-unknown retry', async () => {
  const h = harness([row()]);
  const queue = new Jobs(h.transactions, 'api');
  const [claimed] = await queue.claim();
  assert.equal(await runClaimedJob(queue, claimed, async () => { assert.equal(h.active(), false); }), 'completed');
  assert.equal(await runClaimedJob(queue, claimed, async () => { throw new Error('private-endpoint/body'); }), 'retry_scheduled');
  assert.equal(await runClaimedJob(queue, claimed, async () => { throw new JobFailure('SOURCE_UNAVAILABLE', true); }), 'failed');
  let externalCalls = 0;
  await assert.rejects(runClaimedJob(queue, { ...claimed, leaseOwner: randomUUID() }, async () => { externalCalls++; }), /job_consumer_forbidden/);
  assert.equal(externalCalls, 0);
  assert.ok(h.calls.some(call => call.values.includes('TEMPORARY_UNAVAILABLE')));
  assert.equal(JSON.stringify(h.calls).includes('private-endpoint/body'), false);
  const original = new Error('commit_outcome_unknown');
  const failing = new Jobs({ write: async () => { throw original; } }, 'api', queue.ownerId);
  await assert.rejects(runClaimedJob(failing, claimed, async () => {}), error => error === original);
});
