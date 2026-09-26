import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WAKE_NOTIFICATION,
  WAKE_ONLY_PUSH,
  WakeBindingRegistry,
  WakeCoalescer,
  isCurrentBinding,
  isWakePayload,
  readWakePayload,
} from './wake';

void test('the wake payload is exactly the contract object', () => {
  assert.deepEqual(WAKE_ONLY_PUSH, { type: 'sync_required', version: 1 });
  assert.ok(isWakePayload({ type: 'sync_required', version: 1 }));
  assert.ok(readWakePayload(JSON.stringify(WAKE_ONLY_PUSH)));
  assert.ok(isWakePayload({ ...WAKE_ONLY_PUSH, roomId: '2f1a4b6c-8d3e-4f10-92a7-5c6d7e8f9a0b', messageId: '3f1a4b6c-8d3e-4f10-92a7-5c6d7e8f9a0b' }));
});

void test('content and incomplete or malformed targets are not accepted as a wake', () => {
  for (const payload of [
    { type: 'sync_required', version: 1, roomId: '2f1a4b6c-8d3e-4f10-92a7-5c6d7e8f9a0b' },
    { type: 'sync_required', version: 1, body: '새 메시지' },
    { type: 'sync_required', version: 1, cursor: '42' },
    { type: 'message_created', version: 1 },
    { type: 'sync_required', version: 2 },
    { type: 'sync_required' },
    ['sync_required', 1],
    'sync_required',
    null,
  ]) {
    assert.equal(isWakePayload(payload), false, JSON.stringify(payload));
    assert.equal(readWakePayload(JSON.stringify(payload)), false, JSON.stringify(payload));
  }
});

void test('unparseable, absent or oversized push data is ignored', () => {
  for (const raw of ['', 'not json', '{', `{"type":"sync_required","version":1,"pad":"${'x'.repeat(300)}"}`, null, undefined]) {
    assert.equal(readWakePayload(raw), false);
  }
});

void test('the visible notification cannot claim a new message', () => {
  assert.equal(WAKE_NOTIFICATION.title, '로기챗');
  for (const claim of ['새 메시지', '님이', '도착']) assert.ok(!WAKE_NOTIFICATION.body.includes(claim), claim);
});

void test('wakes during a sync collapse into one further run', async () => {
  const coalescer = new WakeCoalescer();
  const order: string[] = [];
  let release = (): void => {};
  // Only the first run blocks; the folded wakes must be covered by the run that follows it.
  const first = coalescer.run(async () => {
    const started = order.push('sync');
    if (started === 1) await new Promise<void>(resolve => { release = resolve; });
  });
  assert.ok(coalescer.busy);
  assert.equal(await coalescer.run(async () => { order.push('never'); }), 0, 'a wake during a sync does not start a second one');
  assert.equal(await coalescer.run(async () => { order.push('never'); }), 0);
  release();
  assert.equal(await first, 2, 'the folded wakes are covered by one extra run');
  assert.deepEqual(order, ['sync', 'sync']);
  assert.equal(coalescer.busy, false);
});

void test('a quiet sync runs once and leaves the worker idle', async () => {
  const coalescer = new WakeCoalescer();
  let runs = 0;
  assert.equal(await coalescer.run(async () => { runs += 1; }), 1);
  assert.equal(runs, 1);
  assert.equal(coalescer.busy, false);
  assert.equal(await coalescer.run(async () => { runs += 1; }), 1, 'a later wake starts a new sync');
});

void test('a failed sync surfaces and does not leave the worker wedged', async () => {
  const coalescer = new WakeCoalescer();
  await assert.rejects(coalescer.run(async () => { throw new Error('sync failed'); }), /sync failed/);
  assert.equal(coalescer.busy, false);
  assert.equal(await coalescer.run(async () => {}), 1);
});

void test('a run that completes after dispose cannot repeat itself or disturb the new cycle', async () => {
  const coalescer = new WakeCoalescer();
  let release = (): void => {};
  let abandoned = 0;
  const stale = coalescer.run(async () => {
    abandoned += 1;
    await new Promise<void>(resolve => { release = resolve; });
  });
  coalescer.dispose();
  assert.equal(coalescer.busy, false, 'the abandoned cycle no longer occupies the worker');

  let current = 0;
  let releaseCurrent = (): void => {};
  const fresh = coalescer.run(async () => {
    current += 1;
    if (current === 1) await new Promise<void>(resolve => { releaseCurrent = resolve; });
  });
  assert.ok(coalescer.busy);

  release();
  assert.equal(await stale, 1, 'the abandoned run stops after its own sync');
  assert.equal(abandoned, 1);
  assert.ok(coalescer.busy, 'the new cycle is untouched by the late completion');

  assert.equal(await coalescer.run(async () => {}), 0, 'a wake still folds into the new cycle');
  releaseCurrent();
  assert.equal(await fresh, 2);
  assert.equal(coalescer.busy, false);
});

void test('a run that fails after dispose does not clear the new cycle', async () => {
  const coalescer = new WakeCoalescer();
  let fail = (): void => {};
  const stale = coalescer.run(async () => {
    await new Promise<void>((_resolve, reject) => { fail = () => { reject(new Error('stale failure')); }; });
  });
  coalescer.dispose();
  let releaseCurrent = (): void => {};
  const fresh = coalescer.run(async () => { await new Promise<void>(resolve => { releaseCurrent = resolve; }); });
  fail();
  await assert.rejects(stale, /stale failure/);
  assert.ok(coalescer.busy, 'the late failure belongs to the abandoned cycle');
  releaseCurrent();
  assert.equal(await fresh, 1);
});

void test('a binding is distinct even when the same account signs in again', () => {
  const registry = new WakeBindingRegistry();
  assert.equal(registry.current, null);
  assert.equal(registry.isCurrent(null), false, 'no binding means nothing is current');

  const first = registry.bind('account-one', 'session-one');
  assert.ok(registry.isCurrent(first));

  registry.bind('account-two', 'session-two');
  assert.equal(registry.isCurrent(first), false, 'account switch');

  const again = registry.bind('account-one', 'session-one');
  assert.equal(registry.isCurrent(first), false, 'the same account and session after A-B-A is not the old binding');
  assert.ok(registry.isCurrent(again));
  assert.notEqual(again.generation, first.generation);

  registry.clear();
  assert.equal(registry.current, null);
  assert.equal(registry.isCurrent(again), false, 'after logout no earlier work is current');
});

void test('binding equality needs the account, the session and the generation', () => {
  const binding = { account: 'account-one', session: 'session-one', generation: 3 };
  assert.ok(isCurrentBinding(binding, { ...binding }));
  assert.equal(isCurrentBinding(binding, { ...binding, generation: 4 }), false);
  assert.equal(isCurrentBinding(binding, { ...binding, session: 'session-two' }), false);
  assert.equal(isCurrentBinding(binding, { ...binding, account: 'account-two' }), false);
  assert.equal(isCurrentBinding(binding, null), false);
  assert.equal(isCurrentBinding(null, binding), false);
});

void test('a binding is refused rather than stored when its identities are not opaque tokens', () => {
  const registry = new WakeBindingRegistry();
  assert.throws(() => registry.bind('account one', 'session-one'), TypeError);
  assert.throws(() => registry.bind('account-one', ''), TypeError);
  assert.equal(registry.current, null);
});
