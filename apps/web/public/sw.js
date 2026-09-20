/*
 * 로기챗 service worker.
 *
 * It handles Web Push wakes and nothing else. There is no `fetch` handler and no Cache API
 * storage: no API response, media or message is ever kept here, so an account switch has only
 * in-memory work to invalidate.
 *
 * The only payload the server sends is {"type":"sync_required","version":1}. It carries no
 * room, member or message id, no author, no text, no URL and no cursor, so nothing in a wake
 * can be rendered. The notification below therefore says only that there may be something to
 * check; the real content appears after the page syncs with its own credentials. This worker
 * never fetches private data itself and never stores cookies, tokens or account identifiers.
 *
 * This file mirrors apps/web/src/features/push/wake.ts, which is the source of truth and is
 * unit tested; src/features/push/service-worker.test.ts runs this file and checks the same
 * rules. Keep the two in step, see docs/web-push-integration.md.
 */
const WAKE_TYPE = 'sync_required';
const WAKE_VERSION = 1;
const WAKE_BIND = 'rogichat.push.bind';
const WAKE_UNBIND = 'rogichat.push.unbind';
const WAKE_SYNC = 'rogichat.push.sync';
const NOTIFICATION_TITLE = '로기챗';
const NOTIFICATION = {
  body: '확인할 내용이 있는지 로기챗에서 확인해 주세요.',
  tag: 'rogichat-sync',
  renotify: false,
};

/**
 * Which account and session each open page is signed in as; memory only, keyed by client id.
 *
 * One page must not speak for another: a stale tab unbinding itself cannot silence a tab that
 * is still signed in, and a page that never bound is never told to sync.
 */
const bindings = new Map();
let running = false;
let pending = false;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  const sender = event.source;
  // A message speaks only for the page that sent it.
  if (!data || typeof data !== 'object' || !sender || typeof sender.id !== 'string') return;
  if (data.type === WAKE_UNBIND) {
    // Logout in that page: it stops being told to sync; other pages keep their own binding.
    bindings.delete(sender.id);
    return;
  }
  if (data.type !== WAKE_BIND) return;
  if (typeof data.account !== 'string' || typeof data.session !== 'string' || !Number.isInteger(data.generation)) return;
  bindings.set(sender.id, { account: data.account, session: data.session, generation: data.generation });
});

self.addEventListener('push', (event) => {
  if (!isWake(event.data)) return;
  event.waitUntil(wake());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(open());
});

/** Accepts exactly the contract payload: right type, right version, no additional fields. */
function isWake(data) {
  if (!data) return false;
  let raw;
  try {
    raw = data.text();
  } catch {
    return false;
  }
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 256) return false;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  return Object.keys(payload).length === 2 && payload.type === WAKE_TYPE && payload.version === WAKE_VERSION;
}

/**
 * A `userVisibleOnly` subscription owes the user something visible for every wake, so the
 * notification is always shown; the shared tag collapses a burst into one. The sync work is
 * coalesced instead: while one run is in flight, further wakes are covered by one more run.
 */
async function wake() {
  await self.registration.showNotification(NOTIFICATION_TITLE, NOTIFICATION);
  if (running) {
    pending = true;
    return;
  }
  running = true;
  pending = false;
  try {
    do {
      pending = false;
      await notify();
    } while (pending);
  } finally {
    running = false;
    pending = false;
  }
}

/**
 * Tells each signed-in page to sync, with the binding that page is on. A page decides what to
 * read, with its own credentials. Bindings are read after the await, so a page that signed out
 * or rebound while this ran is not told to sync under what it used to be, and records of pages
 * that have gone are dropped.
 */
async function notify() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const live = new Set();
  for (const client of clients) {
    live.add(client.id);
    const current = bindings.get(client.id);
    if (current === undefined) continue;
    client.postMessage({ type: WAKE_SYNC, account: current.account, session: current.session, generation: current.generation });
  }
  for (const id of [...bindings.keys()]) {
    if (!live.has(id)) bindings.delete(id);
  }
}

/** Always this origin's app; a wake carries no URL and none is ever taken from one. */
async function open() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existing = clients.find((client) => client.url.startsWith(`${self.location.origin}/`));
  if (existing) {
    await existing.focus();
    const current = bindings.get(existing.id);
    if (current !== undefined) {
      existing.postMessage({ type: WAKE_SYNC, account: current.account, session: current.session, generation: current.generation });
    }
    return;
  }
  await self.clients.openWindow('/');
}
