import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

import { WAKE_BIND, WAKE_SYNC, WAKE_UNBIND } from './wake-bridge';
import { WAKE_NOTIFICATION, WAKE_ONLY_PUSH } from './wake';

/**
 * `public/sw.js` is served verbatim and cannot import the module, so these run the shipped file
 * itself against stub globals and check the same rules `wake.ts` is tested for.
 */
const SOURCE = readFileSync(fileURLToPath(new URL('../../../public/sw.js', import.meta.url)), 'utf8');

interface Client { id: string; url: string; focused: boolean; messages: unknown[]; focus(): Promise<void>; postMessage(message: unknown): void }

/** Values built inside the sandbox have their own intrinsics; compare them by content. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null));

let ids = 0;

function client(url: string): Client {
  ids += 1;
  const value: Client = {
    id: `client-${ids}`,
    url,
    focused: false,
    messages: [],
    focus: async () => { value.focused = true; },
    postMessage: message => { value.messages.push(message); },
  };
  return value;
}

function worker(clients: Client[] = []) {
  const handlers = new Map<string, (event: unknown) => void>();
  const notifications: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const waits: Promise<unknown>[] = [];
  // Runs while the worker is awaiting its client list, so state can change mid-wake.
  let interleave: (() => Promise<void>) | null = null;
  const self = {
    location: { origin: 'https://qa.rogi.chat' },
    addEventListener: (type: string, handler: (event: unknown) => void) => { handlers.set(type, handler); },
    skipWaiting: () => undefined,
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => { notifications.push({ title, options }); },
    },
    clients: {
      claim: async () => undefined,
      matchAll: async () => {
        const during = interleave;
        interleave = null;
        if (during) await during();
        return clients;
      },
      openWindow: async (url: string) => { opened.push(url); },
    },
  };
  runInContext(SOURCE, createContext({ self, console, URL, TextEncoder, JSON, Object, Array, Number, Promise }));

  const fire = async (type: string, event: Record<string, unknown> = {}): Promise<void> => {
    const handler = handlers.get(type);
    assert.ok(handler, `no ${type} handler`);
    const pending: Promise<unknown>[] = [];
    handler({ ...event, waitUntil: (value: Promise<unknown>) => { pending.push(value); waits.push(value); } });
    await Promise.all(pending);
  };
  const push = (payload: unknown): Record<string, unknown> => ({ data: { text: () => (typeof payload === 'string' ? payload : JSON.stringify(payload)) } });
  const delay = (during: () => Promise<void>): void => { interleave = during; };
  return { handlers, notifications, opened, fire, push, clients, delay };
}

const BINDING = { account: 'account-one', session: 'session-one', generation: 1 };
const bind = { type: WAKE_BIND, ...BINDING };

void test('the worker registers only wake handlers and caches nothing', () => {
  const context = worker();
  assert.deepEqual([...context.handlers.keys()].sort(), ['activate', 'install', 'message', 'notificationclick', 'push']);
  assert.ok(!SOURCE.includes('caches'), 'no Cache API storage belongs in this worker');
  assert.ok(!SOURCE.includes('fetch('), 'the worker never fetches private data itself');
  assert.ok(!/localStorage|indexedDB|document\.cookie/.test(SOURCE), 'no browser storage or cookie access');
});

void test('a wake shows the generic notification and asks the bound pages to sync', async () => {
  const page = client('https://qa.rogi.chat/settings');
  const context = worker([page]);
  await context.fire('message', { data: bind, source: page });
  await context.fire('push', context.push(WAKE_ONLY_PUSH));

  assert.equal(context.notifications.length, 1);
  assert.equal(context.notifications[0]?.title, WAKE_NOTIFICATION.title);
  assert.equal(context.notifications[0]?.options.body, WAKE_NOTIFICATION.body);
  for (const claim of ['새 메시지', '님이', '도착']) assert.ok(!String(context.notifications[0]?.options.body).includes(claim), claim);
  assert.deepEqual(plain(page.messages), [{ type: WAKE_SYNC, account: 'account-one', session: 'session-one', generation: 1 }]);
});

void test('anything that is not the exact wake payload is ignored', async () => {
  for (const payload of [
    { type: 'sync_required', version: 1, roomId: '2f1a4b6c-8d3e-4f10-92a7-5c6d7e8f9a0b' },
    { type: 'sync_required', version: 2 },
    { type: 'message_created', version: 1 },
    'sync_required',
    `{"type":"sync_required","version":1,"pad":"${'x'.repeat(300)}"}`,
  ]) {
    const page = client('https://qa.rogi.chat/');
    const context = worker([page]);
    await context.fire('message', { data: bind, source: page });
    await context.fire('push', context.push(payload));
    assert.equal(context.notifications.length, 0, JSON.stringify(payload));
    assert.deepEqual(page.messages, []);
  }
});

void test('a wake without a binding still notifies the user but tells no page to sync', async () => {
  const page = client('https://qa.rogi.chat/');
  const context = worker([page]);
  await context.fire('push', context.push(WAKE_ONLY_PUSH));
  assert.equal(context.notifications.length, 1, 'a userVisibleOnly subscription still owes something visible');
  assert.deepEqual(plain(page.messages), [], 'no account is bound, so no page is asked to sync');
});

void test('a logout unbinds the worker so a later wake reaches no page', async () => {
  const page = client('https://qa.rogi.chat/');
  const context = worker([page]);
  await context.fire('message', { data: bind, source: page });
  await context.fire('message', { data: { type: WAKE_UNBIND, ...BINDING }, source: page });
  await context.fire('push', context.push(WAKE_ONLY_PUSH));
  assert.deepEqual(plain(page.messages), []);
});

void test('the binding follows the account and its generation', async () => {
  const page = client('https://qa.rogi.chat/');
  const context = worker([page]);
  await context.fire('message', { data: bind, source: page });
  await context.fire('message', { data: { type: WAKE_BIND, account: 'account-two', session: 'session-two', generation: 2 }, source: page });
  await context.fire('push', context.push(WAKE_ONLY_PUSH));
  assert.deepEqual(plain(page.messages), [{ type: WAKE_SYNC, account: 'account-two', session: 'session-two', generation: 2 }]);

  await context.fire('message', { data: { type: WAKE_BIND, account: 'account-two', session: 'session-two' }, source: page });
  await context.fire('push', context.push(WAKE_ONLY_PUSH));
  assert.equal(page.messages.length, 2, 'a malformed binding message changes nothing');
});

void test('a click focuses this origin app and never a URL from a payload', async () => {
  const page = client('https://qa.rogi.chat/chat');
  const context = worker([page]);
  await context.fire('message', { data: bind, source: page });
  let closed = false;
  await context.fire('notificationclick', { notification: { close: () => { closed = true; } } });
  assert.ok(closed);
  assert.ok(page.focused);
  assert.deepEqual(plain(context.opened), []);
  assert.deepEqual(plain(page.messages.at(-1)), { type: WAKE_SYNC, account: 'account-one', session: 'session-one', generation: 1 });
});

void test('a click with no page open opens this origin notification inbox', async () => {
  const context = worker([]);
  await context.fire('notificationclick', { notification: { close: () => undefined } });
  assert.deepEqual(plain(context.opened), ['/notifications']);
});

void test('a page of another origin is not treated as this app', async () => {
  const foreign = client('https://example.com/');
  const context = worker([foreign]);
  await context.fire('notificationclick', { notification: { close: () => undefined } });
  assert.equal(foreign.focused, false);
  assert.deepEqual(plain(context.opened), ['/notifications']);
});

void test('one page unbinding never silences another that is still signed in', async () => {
  const pageA = client('https://qa.rogi.chat/');
  const pageB = client('https://qa.rogi.chat/chat');
  const context = worker([pageA, pageB]);
  await context.fire('message', { data: { type: WAKE_BIND, account: 'account-one', session: 'session-one', generation: 1 }, source: pageA });
  await context.fire('message', { data: { type: WAKE_BIND, account: 'account-one', session: 'session-two', generation: 2 }, source: pageB });

  // The first tab signs out. It speaks only for itself.
  await context.fire('message', { data: { type: WAKE_UNBIND, account: 'account-one', session: 'session-one', generation: 1 }, source: pageA });
  await context.fire('push', context.push(WAKE_ONLY_PUSH));

  assert.deepEqual(plain(pageA.messages), [], 'the page that signed out is not told to sync');
  assert.deepEqual(plain(pageB.messages), [{ type: WAKE_SYNC, account: 'account-one', session: 'session-two', generation: 2 }]);
});

void test('each page is told to sync on its own binding', async () => {
  const pageA = client('https://qa.rogi.chat/');
  const pageB = client('https://qa.rogi.chat/chat');
  const context = worker([pageA, pageB]);
  await context.fire('message', { data: { type: WAKE_BIND, account: 'account-one', session: 'session-one', generation: 1 }, source: pageA });
  await context.fire('message', { data: { type: WAKE_BIND, account: 'account-two', session: 'session-two', generation: 5 }, source: pageB });
  await context.fire('push', context.push(WAKE_ONLY_PUSH));
  assert.deepEqual(plain(pageA.messages), [{ type: WAKE_SYNC, account: 'account-one', session: 'session-one', generation: 1 }]);
  assert.deepEqual(plain(pageB.messages), [{ type: WAKE_SYNC, account: 'account-two', session: 'session-two', generation: 5 }]);
});

void test('a message with no sending page binds nothing', async () => {
  const page = client('https://qa.rogi.chat/');
  const context = worker([page]);
  await context.fire('message', { data: bind });
  await context.fire('push', context.push(WAKE_ONLY_PUSH));
  assert.deepEqual(plain(page.messages), [], 'a binding must belong to a page');
});

void test('a page that unbinds while a wake is in flight is not told to sync', async () => {
  const page = client('https://qa.rogi.chat/');
  const context = worker([page]);
  await context.fire('message', { data: bind, source: page });
  // The page signs out between the wake arriving and the client list resolving.
  context.delay(async () => { await context.fire('message', { data: { type: WAKE_UNBIND, ...BINDING }, source: page }); });
  await context.fire('push', context.push(WAKE_ONLY_PUSH));
  assert.deepEqual(plain(page.messages), [], 'the binding is read after the await, not before');
});

void test('a page that rebinds while a wake is in flight is told its new binding', async () => {
  const page = client('https://qa.rogi.chat/');
  const context = worker([page]);
  await context.fire('message', { data: bind, source: page });
  context.delay(async () => {
    await context.fire('message', { data: { type: WAKE_BIND, account: 'account-one', session: 'session-next', generation: 9 }, source: page });
  });
  await context.fire('push', context.push(WAKE_ONLY_PUSH));
  assert.deepEqual(plain(page.messages), [{ type: WAKE_SYNC, account: 'account-one', session: 'session-next', generation: 9 }]);
});

void test('a click tells only the focused page, on its own binding', async () => {
  const pageA = client('https://qa.rogi.chat/');
  const pageB = client('https://qa.rogi.chat/chat');
  const context = worker([pageA, pageB]);
  await context.fire('message', { data: { type: WAKE_BIND, account: 'account-one', session: 'session-one', generation: 1 }, source: pageA });
  await context.fire('message', { data: { type: WAKE_BIND, account: 'account-one', session: 'session-two', generation: 2 }, source: pageB });
  await context.fire('notificationclick', { notification: { close: () => undefined } });
  assert.ok(pageA.focused);
  assert.deepEqual(plain(pageA.messages), [{ type: WAKE_SYNC, account: 'account-one', session: 'session-one', generation: 1 }]);
  assert.deepEqual(plain(pageB.messages), [], 'the page that was not focused is left alone');
});

void test('a late cleanup of one page lifecycle cannot release the next one', async () => {
  const page = client('https://qa.rogi.chat/');
  const context = worker([page]);
  await context.fire('message', { data: { type: WAKE_BIND, account: 'account-one', session: 'session-one', generation: 1 }, source: page });
  // The same tab signs in again before the previous lifecycle finished tearing down.
  await context.fire('message', { data: { type: WAKE_BIND, account: 'account-one', session: 'session-two', generation: 2 }, source: page });
  await context.fire('message', { data: { type: WAKE_UNBIND, account: 'account-one', session: 'session-one', generation: 1 }, source: page });

  await context.fire('push', context.push(WAKE_ONLY_PUSH));
  assert.deepEqual(plain(page.messages), [{ type: WAKE_SYNC, account: 'account-one', session: 'session-two', generation: 2 }], 'the newer binding survives the older cleanup');
});

void test('a page releasing the binding it actually holds is unbound', async () => {
  const page = client('https://qa.rogi.chat/');
  const context = worker([page]);
  await context.fire('message', { data: { type: WAKE_BIND, account: 'account-one', session: 'session-two', generation: 2 }, source: page });
  await context.fire('message', { data: { type: WAKE_UNBIND, account: 'account-one', session: 'session-two', generation: 2 }, source: page });
  await context.fire('push', context.push(WAKE_ONLY_PUSH));
  assert.deepEqual(plain(page.messages), []);
});

void test('an unbind that names nothing releases nothing', async () => {
  const page = client('https://qa.rogi.chat/');
  const context = worker([page]);
  await context.fire('message', { data: bind, source: page });
  for (const data of [
    { type: WAKE_UNBIND },
    { type: WAKE_UNBIND, account: 'account-one' },
    { type: WAKE_UNBIND, account: 'account-one', session: 'session-one', generation: '1' },
    { type: WAKE_UNBIND, account: 'account-two', session: 'session-one', generation: 1 },
  ]) {
    await context.fire('message', { data, source: page });
  }
  await context.fire('push', context.push(WAKE_ONLY_PUSH));
  assert.deepEqual(plain(page.messages), [{ type: WAKE_SYNC, ...BINDING }], 'only an exact release removes the binding');
});
