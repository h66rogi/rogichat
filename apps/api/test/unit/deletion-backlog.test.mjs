import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DeletionBacklogService } from '../../dist/modules/deletion/deletion-backlog.service.js';
import { DeletionBacklogRepository } from '../../dist/modules/deletion/deletion-backlog.repository.js';

const now = new Date('2026-01-02T00:00:00.000Z');
const aggregate = (seconds = null) => ({ _count: { _all: seconds === null ? 0 : 1 },
  _min: { requested_at: seconds === null ? null : new Date(now.getTime() - seconds * 1000) },
  _max: { requested_at: seconds === null ? null : new Date(now.getTime() - seconds * 1000) } });
const snapshot = () => ({ now, messages: aggregate(), accounts: aggregate(), unapplied: aggregate(),
  failedJobs: 0, uncoveredAccounts: 0, replayErrors: 0, discoveryErrors: 0, replayRetryWithFailureHistory: 0 });
function service(value, ready = true) {
  return new DeletionBacklogService({ check: async () => ({ ready }) },
    { read: fn => fn({ writable: false }), write: () => assert.fail('must never write') },
    { snapshot: async tx => { assert.equal(tx.writable, false); return value; } });
}

for (const [seconds, level] of [[0, 'below_warning'], [3599.999, 'below_warning'], [3600, 'warning'],
  [43199.999, 'warning'], [43200, 'urgent'], [86399.999, 'urgent'], [86400, 'breach'], [172800, 'breach']]) {
  test(`backlog uses original request age at ${seconds} seconds`, async () => {
    const value = snapshot(); value.messages = aggregate(seconds);
    const report = await service(value).inspect();
    assert.equal(report.level, level);
    assert.equal(report.messages.oldestAgeSeconds, Math.floor(seconds));
    assert.equal(report.requiresAttention, level !== 'below_warning');
    assert.equal(report.coverage, 'database-only');
    assert.equal(report.completionVerified, false);
  });
}
test('empty DB is not purge/ledger/restore completion evidence', async () => {
  const report = await service(snapshot()).inspect();
  assert.deepEqual(report.messages, { count: 0, oldestAgeSeconds: null, level: 'below_warning' });
  assert.equal(report.completionVerified, false);
  assert.equal(report.requiresAttention, false);
  assert.equal(report.observedAt, now.toISOString());
});
test('ACCOUNT and unblocked intent ages participate, without summing overlapping scopes', async () => {
  const value = snapshot(); value.accounts = aggregate(43200); value.unapplied = aggregate(86400);
  const report = await service(value).inspect();
  assert.equal(report.level, 'breach');
  assert.equal(report.accounts.level, 'urgent');
  assert.equal(report.unapplied.level, 'breach');
  assert.equal(Object.hasOwn(report, 'total'), false);
});
for (const field of ['failedJobs', 'uncoveredAccounts', 'replayErrors', 'discoveryErrors']) {
  test(`${field} raises attention even for a young or empty backlog`, async () => {
    const value = snapshot(); value[field] = 1;
    assert.equal((await service(value).inspect()).requiresAttention, true);
  });
}
test('unready/malformed/future/inconsistent data rejects instead of zero/green output', async () => {
  await assert.rejects(service(snapshot(), false).inspect());
  for (const invalid of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const value = snapshot(); value.failedJobs = invalid;
    await assert.rejects(service(value).inspect());
  }
  for (const mutation of [value => { value.now = new Date(NaN); },
    value => { value.messages = aggregate(-1); },
    value => { value.messages._count._all = 1; },
    value => { value.messages = aggregate(2); value.messages._count._all = 0; },
    value => { value.messages = aggregate(2); value.messages._max.requested_at = new Date(now.getTime() - 3000); },
    value => { value.accounts = aggregate(1); value.accounts._min.requested_at = new Date(NaN); }]) {
    const value = snapshot(); mutation(value);
    await assert.rejects(service(value).inspect());
  }
});
test('report projects fixed scalar keys, discarding accidental private repository metadata', async () => {
  const value = snapshot(); value.secret = 'private-marker'; value.messages.uuid = 'private-marker';
  const report = await service(value).inspect();
  assert.equal(JSON.stringify(report).includes('private-marker'), false);
  assert.deepEqual(Object.keys(report).sort(), ['accounts', 'completionVerified', 'coverage', 'errors', 'level', 'messages', 'observedAt', 'replayRetryWithFailureHistory', 'requiresAttention', 'schemaVersion', 'unapplied']);
});
test('repository uses Prisma aggregates only and samples DB clock after snapshot queries', async () => {
  const calls = [];
  const model = name => ({ aggregate: async input => { calls.push([name, 'aggregate', input]); return aggregate(); },
    count: async input => { calls.push([name, 'count', input]); return 0; } });
  const tx = { prisma: Object.fromEntries(['deletion_requests', 'account_deletion_obligations', 'deletion_intents', 'jobs',
    'deletion_replay_entries', 'deletion_replay_sources'].map(name => [name, model(name)])),
  now: async () => { calls.push(['clock']); return now; } };
  assert.deepEqual(await new DeletionBacklogRepository().snapshot(tx), snapshot());
  assert.deepEqual(calls.at(-1), ['clock']);
  assert.deepEqual(calls.find(row => row[0] === 'jobs')[2], { where: { purpose: 'PURGE', state: 'FAILED' } });
  assert.deepEqual(calls.find(row => row[0] === 'deletion_replay_sources')[2], { where: { current_failure_code: { not: null } } });
  assert.deepEqual(calls.find(row => row[0] === 'deletion_replay_entries')[2], { where: { OR: [
    { state: 'INVALID' }, { evidence_conflict: true },
  ] } });
});
test('recovered history rediscovered as RETRY stays informational, not a fabricated active error', async () => {
  const value = snapshot(); value.replayRetryWithFailureHistory = 1;
  const report = await service(value).inspect();
  assert.equal(report.replayRetryWithFailureHistory, 1);
  assert.equal(report.errors.replayErrors, 0);
  assert.equal(report.requiresAttention, false);
});
test('standalone compiled command rejects missing hosted configuration and arguments without private output', async () => {
  const command = fileURLToPath(new URL('../../dist/modules/deletion/deletion-backlog.command.js', import.meta.url));
  for (const args of [[], ['private-marker']]) {
    await assert.rejects(promisify(execFile)(process.execPath, [command, ...args], {
      env: { PATH: process.env.PATH, APP_ENV: 'qa', NODE_ENV: 'production' }, timeout: 10000, maxBuffer: 4096,
    }), error => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, '');
      assert.equal(error.stderr, 'deletion_backlog_unavailable\n');
      return true;
    });
  }
});
