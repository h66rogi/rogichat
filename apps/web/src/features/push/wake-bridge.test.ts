import assert from 'node:assert/strict';
import test from 'node:test';

import { WAKE_BIND, WAKE_SYNC, WAKE_UNBIND, startWakeBridge } from './wake-bridge';
import type { WakeWorkerPort } from './wake-bridge';
import type { WakeBinding } from './wake';

const BINDING: WakeBinding = { account: 'account-one', session: 'session-one', generation: 1 };

function bridge(options: { visible?: boolean; controlled?: boolean } = {}) {
  const posted: unknown[] = [];
  const listeners = new Map<string, Set<(event: { data?: unknown }) => void>>();
  const controller = { postMessage: (message: unknown) => { posted.push(message); } };
  let live: typeof controller | null = options.controlled === false ? null : controller;
  const worker: WakeWorkerPort = {
    get controller() { return live; },
    addEventListener: (type, listener) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type, listener) => { listeners.get(type)?.delete(listener); },
  };
  const control = (next: typeof controller | null): void => {
    live = next;
    for (const listener of [...(listeners.get('controllerchange') ?? [])]) listener({});
  };
  const resume = new EventTarget();
  let visible = options.visible ?? true;
  const runs: (() => void)[] = [];
  let started = 0;
  const sync = (): Promise<void> => {
    started += 1;
    return new Promise<void>(resolve => { runs.push(resolve); });
  };
  const deliver = (data: unknown): void => { for (const listener of [...(listeners.get('message') ?? [])]) listener({ data }); };
  return {
    posted,
    resume,
    deliver,
    runs,
    listeners,
    control,
    controller,
    attached: (): number => [...listeners.values()].reduce((total, set) => total + set.size, 0),
    started: () => started,
    show: (value: boolean) => { visible = value; },
    start: () => startWakeBridge({ binding: BINDING, sync, worker, resume, visible: () => visible }),
  };
}

const sync = (overrides: Record<string, unknown> = {}): unknown => ({ type: WAKE_SYNC, ...BINDING, ...overrides });

void test('starting binds the worker and syncs the page that is already open', async () => {
  const context = bridge();
  const stop = context.start();
  assert.deepEqual(context.posted, [{ type: WAKE_BIND, account: 'account-one', session: 'session-one', generation: 1 }]);
  assert.equal(context.started(), 1, 'a wake delivered while no page ran is covered on open');
  context.runs[0]?.();
  stop();
  assert.deepEqual(context.posted.at(-1), { type: WAKE_UNBIND, account: 'account-one', session: 'session-one', generation: 1 }, 'the release names the binding it held');
});

void test('a hidden page does not sync until it is shown again', async () => {
  const context = bridge({ visible: false });
  const stop = context.start();
  assert.equal(context.started(), 0);
  context.resume.dispatchEvent(new Event('visibilitychange'));
  assert.equal(context.started(), 0, 'still hidden');
  context.show(true);
  context.resume.dispatchEvent(new Event('visibilitychange'));
  assert.equal(context.started(), 1);
  context.runs[0]?.();
  stop();
});

void test('a wake for this binding syncs, and one for another does not', async () => {
  const context = bridge({ visible: false });
  const stop = context.start();
  context.deliver(sync());
  assert.equal(context.started(), 1);
  context.runs[0]?.();
  await Promise.resolve();

  for (const other of [
    sync({ account: 'account-two' }),
    sync({ session: 'session-two' }),
    sync({ generation: 2 }),
    { type: 'rogichat.push.sync' },
    { type: 'something-else', ...BINDING },
    'sync',
    null,
  ]) {
    context.deliver(other);
  }
  assert.equal(context.started(), 1, 'a wake for another account, session or generation is not ours');
  stop();
});

void test('wakes during a sync collapse into one further run', async () => {
  const context = bridge({ visible: false });
  const stop = context.start();
  context.deliver(sync());
  context.deliver(sync());
  context.deliver(sync());
  assert.equal(context.started(), 1, 'a burst does not start three syncs');
  context.runs[0]?.();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(context.started(), 2, 'the folded wakes are covered by one more run');
  context.runs[1]?.();
  stop();
});

void test('a resumed page syncs on focus as well as on visibility', async () => {
  const context = bridge();
  const stop = context.start();
  context.runs[0]?.();
  await Promise.resolve();
  await Promise.resolve();
  context.resume.dispatchEvent(new Event('focus'));
  assert.equal(context.started(), 2);
  context.runs[1]?.();
  stop();
});

void test('stopping detaches every listener so a later wake reaches nothing', async () => {
  const context = bridge({ visible: false });
  const stop = context.start();
  stop();
  assert.equal(context.attached(), 0);
  context.deliver(sync());
  context.show(true);
  context.resume.dispatchEvent(new Event('focus'));
  assert.equal(context.started(), 0);
});

void test('a failing sync is reported by the app and does not wedge the bridge', async () => {
  let failures = 0;
  let succeeded = 0;
  const stop = startWakeBridge({
    binding: BINDING,
    sync: async () => {
      if (failures === 0) {
        failures += 1;
        throw new Error('sync failed');
      }
      succeeded += 1;
    },
    worker: null,
    resume: null,
    visible: () => true,
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(failures, 1);
  assert.equal(succeeded, 0);
  stop();
});

void test('a page without a worker or window still syncs on open', () => {
  let started = 0;
  const stop = startWakeBridge({ binding: BINDING, sync: async () => { started += 1; }, worker: null, resume: null, visible: () => true });
  assert.equal(started, 1);
  stop();
});

void test('a page with no controller yet binds as soon as one takes over', () => {
  const context = bridge({ visible: false, controlled: false });
  const stop = context.start();
  assert.deepEqual(context.posted, [], 'there is no worker to bind to on a first load');

  context.control(context.controller);
  assert.deepEqual(context.posted, [{ type: WAKE_BIND, account: 'account-one', session: 'session-one', generation: 1 }]);
  stop();
});

void test('a worker update rebinds the replacement', () => {
  const context = bridge({ visible: false });
  const stop = context.start();
  assert.equal(context.posted.length, 1);
  context.control(context.controller);
  assert.equal(context.posted.length, 2, 'the new worker knows nothing until it is told');
  stop();
  assert.deepEqual(context.posted.at(-1), { type: WAKE_UNBIND, account: 'account-one', session: 'session-one', generation: 1 });
});

void test('a controller that appears after stopping is not bound', () => {
  const context = bridge({ visible: false, controlled: false });
  const stop = context.start();
  stop();
  context.control(context.controller);
  assert.ok(context.posted.every(message => (message as { type: string }).type !== WAKE_BIND), 'no stale listener rebinds a closed page');
});

void test('a stopped bridge stays inert, however often it is stopped or woken', async () => {
  const context = bridge({ visible: false });
  const stop = context.start();
  stop();
  const releases = context.posted.filter(message => (message as { type: string }).type === WAKE_UNBIND).length;
  stop();
  assert.equal(context.posted.filter(message => (message as { type: string }).type === WAKE_UNBIND).length, releases, 'a second stop releases nothing again');

  context.deliver(sync());
  context.show(true);
  context.resume.dispatchEvent(new Event('focus'));
  context.control(context.controller);
  assert.equal(context.started(), 0);
  assert.ok(context.posted.every(message => (message as { type: string }).type !== WAKE_BIND || context.posted.indexOf(message) === 0), 'no rebind after stop');
});
