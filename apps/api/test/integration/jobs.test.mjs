import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readConfig } from '../../dist/config.js';
import { MysqlDatabase } from '../../dist/database.js';
import { createRoom } from '../../dist/repositories.js';
import { enqueueJob, Jobs, completeJob, runClaimedJob, JobFailure } from '../../dist/jobs.js';

const barrier = () => { let resolve; return { wait: new Promise(ready => { resolve = ready; }), release: () => resolve() }; };

test('real MySQL job dedupe, split-purpose claims, fencing, retries and atomic domain finalization', { timeout: 30000 }, async t => {
  const db = new MysqlDatabase(readConfig('api'));
  t.after(() => db.close());
  const txs = db.transactions;
  const roomId = await txs.write(tx => createRoom(tx, '작업 검증 방', 'GROUP'));
  const secondRoom = await txs.write(tx => createRoom(tx, '다른 작업 검증 방', 'GROUP'));
  const resourceId = randomUUID();
  const dedupeKey = randomBytes(32);
  const input = { purpose: 'LEDGER_EXPORT', roomId, resourceId, dedupeKey };
  const ids = await Promise.all([txs.write(tx => enqueueJob(tx, input)), txs.write(tx => enqueueJob(tx, input))]);
  assert.equal(ids[0], ids[1]);
  await assert.rejects(txs.write(tx => enqueueJob(tx, { ...input, roomId: secondRoom })), /job_dedupe_conflict/);
  await assert.rejects(txs.write(tx => enqueueJob(tx, { ...input, resourceId: randomUUID() })), /job_dedupe_conflict/);
  const workers = [new Jobs(txs, 'worker'), new Jobs(txs, 'worker')];
  const raced = await Promise.all(workers.map(queue => queue.claim({ purposes: ['LEDGER_EXPORT'], limit: 1 })));
  assert.equal(raced.flat().length, 1);
  const winnerIndex = raced.findIndex(rows => rows.length === 1);
  const firstLease = raced[winnerIndex][0];
  const firstQueue = workers[winnerIndex];
  const secondQueue = workers[1 - winnerIndex];
  assert.equal(firstLease.id, ids[0]);
  assert.equal(firstLease.generation, 1n);
  assert.equal(await firstQueue.renew(firstLease, 3000), true);
  const [renewed] = await txs.read(tx => tx.rows('SELECT TIMESTAMPDIFF(MICROSECOND,UTC_TIMESTAMP(3),lease_until) AS remaining FROM jobs WHERE id=?', [firstLease.id]));
  assert.ok(Number(renewed.remaining) > 0 && Number(renewed.remaining) <= 3_000_000);

  // Forced DB-clock expiry, without sleeping or changing the machine clock.
  await txs.write(tx => tx.execute('UPDATE jobs SET lease_until=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE id=?', [firstLease.id]));
  assert.equal(await firstQueue.complete(firstLease), false);
  assert.equal(await firstQueue.renew(firstLease), false);
  assert.equal(await firstQueue.retry(firstLease, 'DEPENDENCY_TIMEOUT'), false);
  const [reclaimed] = await secondQueue.claim({ purposes: ['LEDGER_EXPORT'], limit: 1 });
  assert.equal(reclaimed.id, firstLease.id);
  assert.equal(reclaimed.generation, 2n);
  assert.notEqual(reclaimed.leaseToken, firstLease.leaseToken);

  // Caller follows room-before-job lock order and rolls back domain writes on a stale fence.
  await assert.rejects(txs.write(async tx => {
    await tx.rows('SELECT id FROM rooms WHERE id=? FOR UPDATE', [roomId]);
    await tx.execute('UPDATE rooms SET name=? WHERE id=?', ['반영되면 안 됨', roomId]);
    if (!await completeJob(tx, firstLease)) throw new Error('stale_job_fence');
  }), /stale_job_fence/);
  assert.equal((await txs.read(tx => tx.rows('SELECT name FROM rooms WHERE id=?', [roomId])))[0].name, '작업 검증 방');
  await txs.write(async tx => {
    await tx.rows('SELECT id FROM rooms WHERE id=? FOR UPDATE', [roomId]);
    if (!await completeJob(tx, reclaimed)) throw new Error('stale_job_fence');
    await tx.execute('UPDATE rooms SET name=? WHERE id=?', ['반영 완료', roomId]);
  });
  assert.equal(await firstQueue.complete(firstLease), false);
  assert.equal(await secondQueue.complete(reclaimed), false);
  assert.equal((await txs.read(tx => tx.rows('SELECT name FROM rooms WHERE id=?', [roomId])))[0].name, '반영 완료');
  assert.equal(await txs.write(tx => enqueueJob(tx, input)), ids[0]);
  assert.deepEqual(await secondQueue.claim({ purposes: ['LEDGER_EXPORT'] }), []);

  const retryId = await txs.write(tx => enqueueJob(tx, { purpose: 'LEDGER_EXPORT', roomId, maxAttempts: 2 }));
  const [retryLease] = await firstQueue.claim({ purposes: ['LEDGER_EXPORT'] });
  assert.equal(retryLease.id, retryId);
  assert.equal(await firstQueue.retry(retryLease, 'DEPENDENCY_TIMEOUT', { delayMs: 60000 }), true);
  assert.deepEqual(await secondQueue.claim({ purposes: ['LEDGER_EXPORT'] }), []);
  await txs.write(tx => tx.execute('UPDATE jobs SET available_at=UTC_TIMESTAMP(3) WHERE id=?', [retryId]));
  const [lastAttempt] = await secondQueue.claim({ purposes: ['LEDGER_EXPORT'] });
  assert.equal(lastAttempt.attempts, 2);
  assert.equal(await secondQueue.retry(lastAttempt, 'TEMPORARY_UNAVAILABLE', { delayMs: 0 }), true);
  assert.deepEqual(await firstQueue.claim({ purposes: ['LEDGER_EXPORT'] }), []);
  const [failed] = await txs.read(tx => tx.rows('SELECT state,last_error_code,lease_owner,lease_token,lease_until FROM jobs WHERE id=?', [retryId]));
  assert.deepEqual({ ...failed }, { state: 'FAILED', last_error_code: 'TEMPORARY_UNAVAILABLE', lease_owner: null, lease_token: null, lease_until: null });

  const crashedId = await txs.write(tx => enqueueJob(tx, { purpose: 'LEDGER_EXPORT', roomId, maxAttempts: 1 }));
  const [crashed] = await firstQueue.claim({ purposes: ['LEDGER_EXPORT'] });
  assert.equal(crashed.id, crashedId);
  await txs.write(tx => tx.execute('UPDATE jobs SET lease_until=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE id=?', [crashedId]));
  assert.deepEqual(await secondQueue.claim({ purposes: ['LEDGER_EXPORT'] }), []);
  const [exhausted] = await txs.read(tx => tx.rows('SELECT state,last_error_code,generation FROM jobs WHERE id=?', [crashedId]));
  assert.equal(exhausted.state, 'FAILED');
  assert.equal(exhausted.last_error_code, 'ATTEMPTS_EXHAUSTED');
  assert.equal(exhausted.generation, '2');

  const api = new Jobs(txs, 'api');
  await assert.rejects(api.claim({ purposes: ['LEDGER_EXPORT'] }), /job_consumer_forbidden/);
  await assert.rejects(firstQueue.claim({ purposes: ['REALTIME_HINT'] }), /job_consumer_forbidden/);
  const hintId = await txs.write(tx => enqueueJob(tx, { purpose: 'REALTIME_HINT', roomId }));
  let foundHint = false;
  // Earlier domain integration fixtures can leave valid hint jobs in this disposable DB.
  for (let batch = 0; batch < 10 && !foundHint; batch++) {
    const hints = await api.claim();
    assert.ok(hints.every(job => job.purpose === 'REALTIME_HINT'));
    foundHint = hints.some(job => job.id === hintId);
    for (const job of hints) await api.complete(job);
  }
  assert.ok(foundHint);
});

test('SKIP LOCKED passes a locked candidate and external effects do not hold a claim transaction', { timeout: 15000 }, async t => {
  const db = new MysqlDatabase(readConfig('api')); t.after(() => db.close());
  const txs = db.transactions;
  const [a, b] = await txs.write(async tx => [
    await enqueueJob(tx, { purpose: 'LEDGER_EXPORT' }),
    await enqueueJob(tx, { purpose: 'LEDGER_EXPORT' }),
  ]);
  const locked = barrier(); const unlock = barrier();
  const holding = txs.write(async tx => {
    await tx.rows('SELECT id FROM jobs WHERE id=? FOR UPDATE', [a]);
    locked.release(); await unlock.wait;
  });
  await locked.wait;
  const queue = new Jobs(txs, 'worker');
  let claimed;
  try {
    [claimed] = await queue.claim({ purposes: ['LEDGER_EXPORT'], limit: 1 });
    assert.equal(claimed.id, b);
  } finally { unlock.release(); await holding; }
  let effectEntered = false;
  assert.equal(await runClaimedJob(queue, claimed, async job => {
    // A separate transaction can acquire the exact row while the effect runs.
    await txs.write(tx => tx.rows('SELECT id FROM jobs WHERE id=? FOR UPDATE', [job.id]));
    effectEntered = true;
  }), 'completed');
  assert.equal(effectEntered, true);
  const [remaining] = await queue.claim({ purposes: ['LEDGER_EXPORT'] });
  assert.equal(remaining.id, a);
  assert.equal(await runClaimedJob(queue, remaining, async () => { throw new JobFailure('SOURCE_UNAVAILABLE', true); }), 'failed');
  assert.deepEqual(await queue.claim({ purposes: ['LEDGER_EXPORT'] }), []);
});
