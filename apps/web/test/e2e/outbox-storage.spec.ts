import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';
import type * as StorageModule from '../../src/features/chat/outbox/indexeddb';
import type * as TransportModule from '../../src/features/chat/outbox/transport';

// Isolated browser module harness: real native IDB, no application routes/globals,
// runtime fixtures, dependencies, or fake-indexeddb. Production UI tests are separate.
test.beforeEach(async ({ page, context }) => {
  await context.route('**/__outbox_test/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/__outbox_test/')[1]!;
    if (name === 'harness') { await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated storage test</title>' }); return; }
    if (!['outbox/indexeddb', 'outbox/model', 'outbox/transport', 'contract'].includes(name.replace(/\.js$/, ''))) throw new Error('Unexpected isolated module');
    const source = await readFile(resolve('src/features/chat', name.replace(/\.js$/, '') + '.ts'), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
    await route.fulfill({ contentType: 'text/javascript', body: output.replace(/from '([^']+)'/g, "from '$1.js'") });
  });
  await page.goto('/__outbox_test/harness');
});

test('native IDB cold restart locks data, GET404 cannot send, explicit retry preserves frozen identity', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/__outbox_test/outbox/indexeddb.js';
    const transportPath = '/__outbox_test/outbox/transport.js';
    const { DurableOutbox } = await import(modulePath) as typeof StorageModule;
    const { reconcileOutbox, retryOutbox, sendOutbox } = await import(transportPath) as typeof TransportModule;
    const token = 'A'.repeat(43), roomId = crypto.randomUUID(), clientMessageId = crypto.randomUUID();
    const authority = { accountPartition: token, sessionKey: 'a'.repeat(64), rooms: [{ roomId, membershipScope: token, authorizationRevision: token }] };
    const payload = { clientMessageId, membershipScope: token, intent: 'SHARED' as const, content: { type: 'TEXT' as const, text: 'private draft test' } };
    const first = await DurableOutbox.open('restart'); await first.authorize(authority);
    const calls: string[] = [];
    const transport = { verify: async () => {}, lookup: async () => { calls.push('GET'); throw { status: 404 }; }, send: async (body: unknown) => { calls.push('SEND'); if (JSON.stringify(body) !== JSON.stringify(payload)) throw Error('Changed payload'); throw Error('ACK lost'); } };
    await sendOutbox(first, roomId, payload, transport).catch(() => {});
    first.suspend(); await new Promise(resolve => setTimeout(resolve, 20)); first.close();
    const second = await DurableOutbox.open('restart');
    const locked = await second.recover(roomId).then(() => false, () => true);
    await second.authorize(authority);
    const recovered = await second.recover(roomId);
    const blockedSend = await second.beforeSend(clientMessageId).then(() => false, () => true);
    await reconcileOutbox(second, clientMessageId, transport).catch(() => {});
    const afterRead = [...calls];
    await retryOutbox(second, clientMessageId, transport).catch(() => {});
    second.close(); return { locked, recovered: recovered[0]?.clientMessageId, clientMessageId, blockedSend, afterRead, calls };
  });
  expect(result.locked).toBe(true); expect(result.blockedSend).toBe(true);
  expect(result.recovered).toBe(result.clientMessageId);
  expect(result.afterRead).toEqual(['SEND', 'GET']); expect(result.calls).toEqual(['SEND', 'GET', 'GET', 'SEND']);
});

test('native atomic ownership, session ABA scrub, stale ACK and lifecycle locks', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/__outbox_test/outbox/indexeddb.js';
    const { DurableOutbox } = await import(modulePath) as typeof StorageModule;
    const token = 'A'.repeat(43), roomId = crypto.randomUUID(), clientMessageId = crypto.randomUUID();
    const a = { accountPartition: token, sessionKey: 'a'.repeat(64), rooms: [{ roomId, membershipScope: token, authorizationRevision: token }] };
    const first = await DurableOutbox.open('ownership'), second = await DurableOutbox.open('ownership');
    await first.authorize(a);
    await first.prepare(roomId, { clientMessageId, membershipScope: token, intent: 'SHARED', content: { type: 'TEXT', text: 'erase me' } });
    const busy = await second.authorize(a).then(() => false, () => true);
    await second.authorize({ ...a, sessionKey: 'b'.repeat(64) });
    const fenced = await first.settle({ clientMessageId, status: 'deleted' }).then(() => false, () => true);
    await second.authorize(a);
    const record = (await second.recover(roomId))[0]!;
    const noResurrection = await second.prepare(roomId, { clientMessageId, membershipScope: token, intent: 'SHARED', content: { type: 'TEXT', text: 'erase me' } }).then(() => false, () => true);
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    const suspended = await second.beforeLookup(clientMessageId).then(() => false, () => true);
    first.close(); second.close(); return { busy, fenced, scrubbed: !record.payload, noResurrection, suspended };
  });
  expect(result).toEqual({ busy: true, fenced: true, scrubbed: true, noResurrection: true, suspended: true });
});

test('versionchange closes old writer and newer schema is preserved with update-required', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/__outbox_test/outbox/indexeddb.js';
    const { DurableOutbox } = await import(modulePath) as typeof StorageModule;
    const outbox = await DurableOutbox.open('upgrade');
    const newer = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('rogichat-outbox-upgrade', 2);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(Error('upgrade failed'));
    });
    const stopped = await outbox.assertCurrent().then(() => false, () => true);
    const required = await DurableOutbox.open('upgrade').then(() => false, error => error.code === 'UPDATE_REQUIRED');
    const version = newer.version; newer.close(); return { stopped, required, version };
  });
  expect(result).toEqual({ stopped: true, required: true, version: 2 });
});

test('native aborted persistence refuses network and leaves composer input intact', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/__outbox_test/outbox/indexeddb.js', transportPath = '/__outbox_test/outbox/transport.js';
    const { DurableOutbox } = await import(modulePath) as typeof StorageModule;
    const { sendOutbox } = await import(transportPath) as typeof TransportModule;
    const token = 'A'.repeat(43), roomId = crypto.randomUUID();
    const outbox = await DurableOutbox.open('quota');
    await outbox.authorize({ accountPartition: token, sessionKey: 'a'.repeat(64), rooms: [{ roomId, membershipScope: token, authorizationRevision: token }] });
    const input = { clientMessageId: crypto.randomUUID(), membershipScope: token, intent: 'SHARED' as const, content: { type: 'TEXT' as const, text: 'keep composer input' } };
    let sends = 0;
    const original = IDBObjectStore.prototype.put;
    // Fault injection at the native IDB boundary; real transaction must abort.
    IDBObjectStore.prototype.put = function () { throw new DOMException('Isolated quota fault', 'QuotaExceededError'); };
    let failed: boolean;
    try { failed = await sendOutbox(outbox, roomId, input, { verify: async () => {}, lookup: async () => {}, send: async () => { sends++; } }).then(() => false, () => true); }
    finally { IDBObjectStore.prototype.put = original; }
    const rows = await outbox.recover(roomId); outbox.close();
    return { failed, sends, input: input.content.text, count: rows.length };
  });
  expect(result).toEqual({ failed: true, sends: 0, input: 'keep composer input', count: 0 });
});

test('two browser tabs cannot acquire concurrent same-account writer leases', async ({ page, context }) => {
  await page.evaluate(async () => {
    const modulePath = '/__outbox_test/outbox/indexeddb.js';
    const { DurableOutbox } = await import(modulePath) as typeof StorageModule;
    const outbox = await DurableOutbox.open('tabs');
    await outbox.authorize({ accountPartition: 'A'.repeat(43), sessionKey: 'a'.repeat(64), rooms: [] });
  });
  const second = await context.newPage(); await second.goto('/__outbox_test/harness');
  expect(await second.evaluate(async () => {
    const modulePath = '/__outbox_test/outbox/indexeddb.js';
    const { DurableOutbox } = await import(modulePath) as typeof StorageModule;
    const outbox = await DurableOutbox.open('tabs');
    const busy = await outbox.authorize({ accountPartition: 'A'.repeat(43), sessionKey: 'a'.repeat(64), rooms: [] }).then(() => false, error => error.code === 'BUSY');
    outbox.close(); return busy;
  })).toBe(true);
});

test('late network ACK after lease takeover cannot mutate durable command outcome', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/__outbox_test/outbox/indexeddb.js', transportPath = '/__outbox_test/outbox/transport.js';
    const { DurableOutbox } = await import(modulePath) as typeof StorageModule;
    const { sendOutbox } = await import(transportPath) as typeof TransportModule;
    const token = 'A'.repeat(43), roomId = crypto.randomUUID(), clientMessageId = crypto.randomUUID();
    const authority = { accountPartition: token, sessionKey: 'a'.repeat(64), rooms: [{ roomId, membershipScope: token, authorizationRevision: token }] };
    const first = await DurableOutbox.open('late'), second = await DurableOutbox.open('late');
    await first.authorize(authority);
    const failed = await sendOutbox(first, roomId, { clientMessageId, membershipScope: token, intent: 'SHARED', content: { type: 'TEXT', text: 'late private' } }, {
      verify: async () => {}, lookup: async () => {}, send: async () => {
        await second.authorize({ ...authority, sessionKey: 'b'.repeat(64) });
        return { clientMessageId, status: 'committed', messageId: crypto.randomUUID(), version: '1' };
      },
    }).then(() => false, () => true);
    const record = (await second.recover(roomId))[0]!;
    first.close(); second.close(); return { failed, payload: Boolean(record.payload), result: Boolean(record.result) };
  });
  expect(result).toEqual({ failed: true, payload: false, result: false });
});

test('missing native store state refuses writes instead of recreating evicted commands', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/__outbox_test/outbox/indexeddb.js';
    const { DurableOutbox } = await import(modulePath) as typeof StorageModule;
    const outbox = await DurableOutbox.open('eviction');
    await outbox.authorize({ accountPartition: 'A'.repeat(43), sessionKey: 'a'.repeat(64), rooms: [] });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('rogichat-outbox-eviction', 1);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('state', 'readwrite');
        tx.objectStore('state').clear();
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(Error('clear failed'));
      };
    });
    const refused = await outbox.assertCurrent().then(() => false, error => error.code === 'UPDATE_REQUIRED');
    outbox.close(); return refused;
  });
  expect(result).toBe(true);
});

test('confirmed revoke crosses same-session lease handoff but cannot cross authority ABA', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/__outbox_test/outbox/indexeddb.js';
    const { DurableOutbox } = await import(modulePath) as typeof StorageModule;
    const token = 'A'.repeat(43), roomId = crypto.randomUUID();
    const authority = { accountPartition: token, sessionKey: 'a'.repeat(64), rooms: [{ roomId, membershipScope: token, authorizationRevision: token }] };
    const payload = { clientMessageId: crypto.randomUUID(), membershipScope: token, intent: 'SHARED' as const, content: { type: 'TEXT' as const, text: 'erase on logout' } };
    const first = await DurableOutbox.open('revoke'), second = await DurableOutbox.open('revoke');
    await first.authorize(authority); await first.prepare(roomId, payload); first.suspend();
    await second.authorize(authority); await first.revoke();
    const fenced = await second.assertCurrent().then(() => false, () => true);
    await second.authorize(authority);
    const erased = !(await second.recover(roomId))[0]!.payload;
    second.suspend(); await first.authorize(authority); first.suspend();
    await second.authorize({ ...authority, sessionKey: 'b'.repeat(64) });
    await second.authorize(authority);
    const newId = crypto.randomUUID(); await second.prepare(roomId, { ...payload, clientMessageId: newId });
    await first.revoke();
    const retained = Boolean((await second.recover(roomId)).find(record => record.clientMessageId === newId)?.payload);
    first.close(); second.close(); return { fenced, erased, retained };
  });
  expect(result).toEqual({ fenced: true, erased: true, retained: true });
});
