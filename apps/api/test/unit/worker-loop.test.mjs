import { JobFailure } from '../support/domain-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WorkerLoop } from '../../dist/modules/jobs/worker-loop.js';

const barrier = () => { let release; return { wait: new Promise(resolve => { release = resolve; }), release: value => release(value) }; };
const lease = (purpose = 'PUBLICATION', patch = {}) => ({ id: randomUUID(), purpose, roomId: randomUUID(), resourceId: randomUUID(),
  generation: 1n, leaseOwner: randomUUID(), leaseToken: randomUUID(), attempts: 1, maxAttempts: 5, ...patch });
function fixture(handlers, rows = [], options = {}) {
  const lifecycle = { draining: false }; const calls = []; let checks = 0;
  const loop = new WorkerLoop({}, lifecycle, handlers, { ready: async () => { checks++; return true; }, ...options });
  loop.jobs = {
    async claim(input) { calls.push({ operation: 'claim', input }); return rows.length ? [rows.shift()] : []; },
    async retry(job, code, input) { calls.push({ operation: 'retry', id: job.id, code, input }); return true; },
    async complete() { throw new Error('loop_must_never_complete_domain_job'); },
  };
  return { loop, lifecycle, calls, rows, checks: () => checks };
}

test('only installed worker purposes are claimed; copied allowlist prioritizes PURGE and rejects API/unknown handlers', async () => {
  for (const handlers of [{ REALTIME_HINT: async () => 'completed' }, { UNKNOWN: async () => 'completed' }, { MEDIA: undefined }, null, []]) {
    assert.throws(() => new WorkerLoop({}, { draining: false }, handlers, { ready: async () => true }), /invalid_worker_handlers/);
  }
  const handlers = { PUBLICATION: async () => 'completed', PURGE: async () => 'completed' };
  const f = fixture(handlers, [lease('PURGE')]); handlers.MEDIA = async () => 'completed';
  assert.deepEqual(f.loop.stats().installedPurposes, ['PURGE', 'PUBLICATION']);
  assert.ok(Object.isFrozen(f.loop.stats().installedPurposes));
  const result = await f.loop.tick(); assert.equal(result.completed, 1);
  for (const call of f.calls) if (call.operation === 'claim') assert.deepEqual(call.input, { purposes: ['PURGE', 'PUBLICATION'], limit: 1, leaseMs: 30000 });
  const noHandlers = fixture({}); assert.deepEqual(await noHandlers.loop.tick(), { claimed: 0, completed: 0, leaseLost: 0, retried: 0, failed: 0, progress: 0, deferred: 0, subsetDrained: 0 });
  assert.deepEqual(noHandlers.calls, []); assert.equal(noHandlers.checks(), 0);
});

test('readiness fails closed before every claim and is rechecked after a handler changes readiness', async () => {
  for (const ready of [async () => false, async () => undefined]) {
    const f = fixture({ PUBLICATION: async () => 'completed' }, [lease()], { ready });
    assert.equal((await f.loop.tick()).claimed, 0); assert.deepEqual(f.calls, []);
  }
  const broken = fixture({ PUBLICATION: async () => 'completed' }, [], { ready: async () => { throw new Error('db unavailable'); } });
  await assert.rejects(broken.loop.tick(), /db unavailable/); assert.deepEqual(broken.calls, []);
  let ready = true;
  const changing = fixture({ PUBLICATION: async () => { ready = false; return 'completed'; } }, [lease(), lease()], { ready: async () => ready });
  assert.equal((await changing.loop.tick()).claimed, 1); assert.equal(changing.rows.length, 1);
  for (const options of [undefined, {}, { ready: false }, { ready: async () => true, maxPerTick: 11 },
    { ready: async () => true, leaseMs: 999 }, { ready: async () => true, pollMs: 0 }, { ready: async () => true, unexpected: true }]) {
    assert.throws(() => new WorkerLoop({}, { draining: false }, {}, options), /invalid_worker_policy/);
  }
});

test('at most ten single-flight executions per tick, with no unconditional completion by the loop', async () => {
  let active = 0; let maximum = 0;
  const f = fixture({ PUBLICATION: async () => { active++; maximum = Math.max(maximum, active); await Promise.resolve(); active--; return 'completed'; } }, Array.from({ length: 12 }, () => lease()));
  assert.deepEqual(await f.loop.tick(), { claimed: 10, completed: 10, leaseLost: 0, retried: 0, failed: 0, progress: 0, deferred: 0, subsetDrained: 0 });
  assert.equal(maximum, 1); assert.equal(f.calls.length, 10); assert.equal(f.checks(), 10);
  assert.equal((await f.loop.tick()).completed, 2); assert.equal(f.rows.length, 0);
});

test('exceptions persist only allowlisted errors and stale/committed domain fences are never overridden', async () => {
  const values = [new Error('private message, token and URL must never persist'), new JobFailure('SOURCE_UNAVAILABLE', true),
    new JobFailure('DEPENDENCY_TIMEOUT'), 'lease_lost', undefined, new Error('commit_outcome_unknown')];
  const jobs = Array.from({ length: values.length }, () => lease()); jobs[2].attempts = jobs[2].maxAttempts;
  const f = fixture({ PUBLICATION: async () => { const value = values.shift(); if (value instanceof Error) throw value; return value; } }, jobs);
  let retries = 0;
  f.loop.jobs.retry = async (job, code, input) => { f.calls.push({ operation: 'retry', id: job.id, code, input }); return ++retries !== 5; };
  assert.deepEqual(await f.loop.tick(), { claimed: 6, completed: 0, leaseLost: 2, retried: 1, failed: 3, progress: 0, deferred: 0, subsetDrained: 0 });
  const codes = f.calls.filter(call => call.operation === 'retry').map(call => call.code);
  assert.deepEqual(codes, ['TEMPORARY_UNAVAILABLE', 'SOURCE_UNAVAILABLE', 'DEPENDENCY_TIMEOUT', 'PERMANENT_FAILURE', 'TEMPORARY_UNAVAILABLE']);
  assert.ok(!JSON.stringify(f.calls).includes('private message'));
});

test('concurrent ticks share one promise and graceful stop waits for the current handler only', async () => {
  const entered = barrier(); const finish = barrier();
  const f = fixture({ PUBLICATION: async () => { entered.release(); await finish.wait; return 'completed'; } }, [lease(), lease()]);
  const first = f.loop.tick(); assert.equal(f.loop.tick(), first); await entered.wait;
  let stopped = false; const closing = f.loop.stop().then(() => { stopped = true; });
  await Promise.resolve(); assert.equal(stopped, false);
  assert.equal((await f.loop.tick()).claimed, 0);
  finish.release(); await closing;
  assert.deepEqual(await first, { claimed: 1, completed: 1, leaseLost: 0, retried: 0, failed: 0, progress: 0, deferred: 0, subsetDrained: 0 });
  assert.equal(f.rows.length, 1); assert.equal(f.loop.stats().stopped, true); assert.equal(f.loop.stats().running, false);
  assert.equal(f.loop.stop(), f.loop.stop());
});

test('stop or drain during readiness/claim never starts a newly acquired domain handler', async () => {
  const readyEntered = barrier(); const readyFinish = barrier(); let effects = 0;
  const before = fixture({ PUBLICATION: async () => { effects++; return 'completed'; } }, [lease()], {
    ready: async () => { readyEntered.release(); await readyFinish.wait; return true; },
  });
  const checking = before.loop.tick(); await readyEntered.wait; const stopping = before.loop.stop(); readyFinish.release();
  await stopping; assert.equal((await checking).claimed, 0); assert.equal(before.calls.length, 0);
  const after = fixture({ PUBLICATION: async () => { effects++; return 'completed'; } });
  after.loop.jobs.claim = async () => { after.lifecycle.draining = true; return [lease()]; };
  assert.deepEqual(await after.loop.tick(), { claimed: 1, completed: 0, leaseLost: 0, retried: 1, failed: 0, progress: 0, deferred: 0, subsetDrained: 0 });
  assert.equal(effects, 0); assert.deepEqual(after.calls[0].input, { delayMs: 0 });
});


test('bounded purge outcomes are counted truthfully without completion or retry', async () => {
  const outcomes = ['progress', 'deferred', 'subset_drained'];
  const f = fixture({ PURGE: async () => outcomes.shift() }, [lease('PURGE'), lease('PURGE'), lease('PURGE')]);
  assert.deepEqual(await f.loop.tick(), { claimed: 3, completed: 0, leaseLost: 0, retried: 0, failed: 0, progress: 1, deferred: 1, subsetDrained: 1 });
  assert.equal(f.calls.some(call => call.operation !== 'claim'), false);
});
