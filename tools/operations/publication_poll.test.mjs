import assert from 'node:assert/strict';
import test from 'node:test';
import { POLL_INTERVAL_MS, waitForPublicationCheck } from './publication_poll.mjs';

test('publisher waits at most 90 seconds between exact-source checks', async () => {
  let elapsed = 0;
  const intervals = [];
  const retry = () => waitForPublicationCheck(5 * 60_000, () => elapsed, milliseconds => {
    intervals.push(milliseconds);
    elapsed += milliseconds;
  });
  assert.equal(await retry(), true);
  assert.equal(await retry(), true);
  assert.deepEqual(intervals, [POLL_INTERVAL_MS, POLL_INTERVAL_MS]);
});

test('a check is still required when the final sleep reaches the deadline', async () => {
  let elapsed = 0;
  let checks = 0;
  const deadline = 4_000;
  for (;;) {
    checks += 1;
    const retry = await waitForPublicationCheck(deadline, () => elapsed,
      milliseconds => { elapsed += milliseconds; });
    if (!retry) break;
  }
  assert.equal(elapsed, deadline);
  assert.equal(checks, 2);
  assert.equal(await waitForPublicationCheck(deadline, () => deadline,
    () => { throw new Error('must not sleep after deadline'); }), false);
});
