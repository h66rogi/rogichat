import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import type * as ControllerModule from '../../src/features/chat/chat-controller';
import type * as MemoryModule from '../../src/features/chat/chat-memory';
import type * as StorageModule from '../../src/features/chat/outbox/indexeddb';
import type * as TransportModule from '../../src/features/chat/outbox/transport';

// Isolated browser module harness: real native IDB, no application routes/globals,
// runtime fixtures, dependencies, or fake-indexeddb. Production UI tests are separate.
test.beforeEach(async ({ page, context }) => {
  await context.route('**/__outbox_test/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/__outbox_test/')[1]!;
    if (name === 'harness') { await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated storage test</title>' }); return; }
    if (!['outbox/indexeddb', 'outbox/model', 'outbox/transport', 'contract', 'chat-controller', 'chat-memory', 'commands', 'formatters', 'reactions', 'session-contract'].includes(name.replace(/\.js$/, ''))) throw new Error('Unexpected isolated module');
    const sourcePath = name === 'session-contract.js' ? '../../src/core/api/session-contract.ts' : '../../src/features/chat/' + name.replace(/\.js$/, '') + '.ts';
    const source = await readFile(new URL(sourcePath, import.meta.url), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
    const imports: Record<string, string> = { '../../core/api/session-contract': '/__outbox_test/session-contract', '../../features/chat/contract': '/__outbox_test/contract' };
    await route.fulfill({ contentType: 'text/javascript', body: output.replace(/from '([^']+)'/g, (_match, path: string) => `from '${imports[path] ?? path}.js'`) });
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

test('concurrent tabs retain session ABA scrub, stale ACK and lifecycle locks', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/__outbox_test/outbox/indexeddb.js';
    const { DurableOutbox } = await import(modulePath) as typeof StorageModule;
    const token = 'A'.repeat(43), roomId = crypto.randomUUID(), clientMessageId = crypto.randomUUID();
    const a = { accountPartition: token, sessionKey: 'a'.repeat(64), rooms: [{ roomId, membershipScope: token, authorizationRevision: token }] };
    const first = await DurableOutbox.open('ownership'), second = await DurableOutbox.open('ownership');
    await first.authorize(a);
    await first.prepare(roomId, { clientMessageId, membershipScope: token, intent: 'SHARED', content: { type: 'TEXT', text: 'erase me' } });
    await second.authorize(a);
    const shared = (await second.recover(roomId))[0]?.payload?.content;
    await second.authorize({ ...a, sessionKey: 'b'.repeat(64) });
    const fenced = await first.settle({ clientMessageId, status: 'deleted' }).then(() => false, () => true);
    await second.authorize(a);
    const record = (await second.recover(roomId))[0]!;
    const noResurrection = await second.prepare(roomId, { clientMessageId, membershipScope: token, intent: 'SHARED', content: { type: 'TEXT', text: 'erase me' } }).then(() => false, () => true);
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    const suspended = await second.beforeLookup(clientMessageId).then(() => false, () => true);
    first.close(); second.close(); return { shared, fenced, scrubbed: !record.payload, noResurrection, suspended };
  });
  expect(result).toEqual({ shared: { type: 'TEXT', text: 'erase me' }, fenced: true, scrubbed: true, noResurrection: true, suspended: true });
});

test('versionchange closes old connection and newer schema is preserved with update-required', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/__outbox_test/outbox/indexeddb.js';
    const { DurableOutbox } = await import(modulePath) as typeof StorageModule;
    const outbox = await DurableOutbox.open('upgrade');
    const newer = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('rogichat-outbox-upgrade', 2);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(Error('upgrade failed'));
    });
    const stopped = await outbox.assertCurrent().then(() => false, () => true);
    const closed = outbox.closed;
    const required = await DurableOutbox.open('upgrade').then(() => false, error => error.code === 'UPDATE_REQUIRED');
    const version = newer.version; newer.close(); return { stopped, closed, required, version };
  });
  expect(result).toEqual({ stopped: true, closed: true, required: true, version: 2 });
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

test('two browser tabs authorize and send distinct commands concurrently', async ({ page, context }) => {
  const first = await page.evaluate(async () => {
    const modulePath = '/__outbox_test/outbox/indexeddb.js';
    const { DurableOutbox } = await import(modulePath) as typeof StorageModule;
    const token = 'A'.repeat(43), roomId = crypto.randomUUID(), id = crypto.randomUUID();
    const outbox = await DurableOutbox.open('tabs');
    await outbox.authorize({ accountPartition: token, sessionKey: 'a'.repeat(64), rooms: [{ roomId, membershipScope: token, authorizationRevision: token }] });
    await outbox.prepare(roomId, { clientMessageId: id, membershipScope: token, intent: 'SHARED', content: { type: 'TEXT', text: 'first tab' } });
    return { roomId, id };
  });
  const second = await context.newPage(); await second.goto('/__outbox_test/harness');
  const result = await second.evaluate(async ({ roomId, id }) => {
    const modulePath = '/__outbox_test/outbox/indexeddb.js';
    const { DurableOutbox } = await import(modulePath) as typeof StorageModule;
    const token = 'A'.repeat(43), otherId = crypto.randomUUID();
    const outbox = await DurableOutbox.open('tabs');
    await outbox.authorize({ accountPartition: token, sessionKey: 'a'.repeat(64), rooms: [{ roomId, membershipScope: token, authorizationRevision: token }] });
    const recovered = await outbox.recover(roomId);
    const receiptFirst = await outbox.beforeSend(id).then(() => false, error => error.code === 'RECEIPT_FIRST');
    await outbox.prepare(roomId, { clientMessageId: otherId, membershipScope: token, intent: 'SHARED', content: { type: 'TEXT', text: 'second tab' } });
    const sent = await outbox.beforeSend(otherId);
    outbox.close(); return { recovered: recovered.map(record => record.clientMessageId), receiptFirst, sent: sent.clientMessageId, otherId };
  }, first);
  expect(result).toEqual({ recovered: [first.id], receiptFirst: true, sent: result.otherId, otherId: result.otherId });
  expect(await page.evaluate(async roomId => {
    const modulePath = '/__outbox_test/outbox/indexeddb.js';
    const { DurableOutbox } = await import(modulePath) as typeof StorageModule;
    const outbox = await DurableOutbox.open('tabs');
    const token = 'A'.repeat(43);
    await outbox.authorize({ accountPartition: token, sessionKey: 'a'.repeat(64), rooms: [{ roomId, membershipScope: token, authorizationRevision: token }] });
    const records = await outbox.recover(roomId); outbox.close(); return records.map(record => record.clientMessageId);
  }, first.roomId)).toEqual([first.id, result.otherId]);
});

test('an unexpired owner from the previous client cannot block a newly opened tab', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/__outbox_test/outbox/indexeddb.js';
    const { DurableOutbox } = await import(modulePath) as typeof StorageModule;
    const token = 'A'.repeat(43), roomId = crypto.randomUUID(), id = crypto.randomUUID();
    const authority = { accountPartition: token, sessionKey: 'a'.repeat(64), rooms: [{ roomId, membershipScope: token, authorizationRevision: token }] };
    const first = await DurableOutbox.open('legacy-owner'); await first.authorize(authority); first.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('rogichat-outbox-legacy-owner', 1);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state'), read = store.get('singleton');
        read.onsuccess = () => { const state = read.result; state.owner = 'previous-tab'; state.fence = 42; state.leaseUntil = Date.now() + 30_000; store.put(state, 'singleton'); };
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(Error('legacy fixture failed')); };
      };
      request.onerror = () => reject(Error('legacy fixture failed'));
    });
    const second = await DurableOutbox.open('legacy-owner'); await second.authorize(authority);
    await second.prepare(roomId, { clientMessageId: id, membershipScope: token, intent: 'SHARED', content: { type: 'TEXT', text: 'no waiting' } });
    const body = await second.beforeSend(id); second.close(); return body.content;
  });
  expect(result).toEqual({ type: 'TEXT', text: 'no waiting' });
});

test('late network ACK after authority change cannot mutate durable command outcome', async ({ page }) => {
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

test('confirmed revoke fences every same-session tab but cannot cross authority ABA', async ({ page }) => {
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

test('same-instance authority ABA aborts the original transport before late ACK can settle', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/__outbox_test/outbox/indexeddb.js', transportPath = '/__outbox_test/outbox/transport.js';
    const { DurableOutbox } = await import(modulePath) as typeof StorageModule;
    const { sendOutbox } = await import(transportPath) as typeof TransportModule;
    const token = 'A'.repeat(43), roomId = crypto.randomUUID(), clientMessageId = crypto.randomUUID();
    const authority = { accountPartition: token, sessionKey: 'a'.repeat(64), rooms: [{ roomId, membershipScope: token, authorizationRevision: token }] };
    const outbox = await DurableOutbox.open('transport-aba'); await outbox.authorize(authority);
    const failed = await sendOutbox(outbox, roomId, { clientMessageId, membershipScope: token, intent: 'SHARED', content: { type: 'TEXT', text: 'old transport body' } }, {
      verify: async () => {}, lookup: async () => {}, send: async () => {
        await outbox.authorize({ ...authority, sessionKey: 'b'.repeat(64) }); await outbox.authorize(authority);
        return { clientMessageId, status: 'committed', messageId: crypto.randomUUID(), version: '1' };
      },
    }).then(() => false, () => true);
    const record = (await outbox.recover(roomId))[0]!; outbox.close();
    return { failed, hasResult: Boolean(record.result), hasPayload: Boolean(record.payload) };
  });
  expect(result).toEqual({ failed: true, hasResult: false, hasPayload: false });
});

test('routine same-authority refresh keeps an in-flight send and its receipt valid', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/__outbox_test/outbox/indexeddb.js';
    const { DurableOutbox } = await import(modulePath) as typeof StorageModule;
    const token = 'A'.repeat(43), roomId = crypto.randomUUID(), clientMessageId = crypto.randomUUID();
    const authority = { accountPartition: token, sessionKey: 'a'.repeat(64), rooms: [{ roomId, membershipScope: token, authorizationRevision: token }] };
    const outbox = await DurableOutbox.open('same-authority'); await outbox.authorize(authority);
    await outbox.prepare(roomId, { clientMessageId, membershipScope: token, intent: 'SHARED', content: { type: 'TEXT', text: 'keep send alive' } });
    await outbox.beforeSend(clientMessageId);
    const inFlightSignal = outbox.signal;
    await outbox.authorize(authority);
    await outbox.settle({ clientMessageId, messageId: crypto.randomUUID(), status: 'committed', version: '1' });
    const committed = (await outbox.recover(roomId))[0]?.result?.status === 'committed';
    const keptSignal = !inFlightSignal.aborted && inFlightSignal === outbox.signal;
    outbox.close(); return { committed, keptSignal };
  });
  expect(result).toEqual({ committed: true, keptSignal: true });
});

test('detached session revoke erases closed-owner payload and protects a successor session', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/__outbox_test/outbox/indexeddb.js';
    const { DurableOutbox } = await import(modulePath) as typeof StorageModule;
    const token = 'A'.repeat(43), roomId = crypto.randomUUID();
    const authority = { accountPartition: token, sessionKey: 'a'.repeat(64), rooms: [{ roomId, membershipScope: token, authorizationRevision: token }] };
    const first = await DurableOutbox.open('detached'); await first.authorize(authority);
    const oldId = crypto.randomUUID();
    await first.prepare(roomId, { clientMessageId: oldId, membershipScope: token, intent: 'SHARED', content: { type: 'TEXT', text: 'closed owner private body' } }); first.close();
    await DurableOutbox.revokeSession('detached', token, authority.sessionKey);
    const next = await DurableOutbox.open('detached'); await next.authorize({ ...authority, sessionKey: 'b'.repeat(64) });
    const erased = !(await next.recover(roomId))[0]!.payload;
    const newId = crypto.randomUUID();
    await next.prepare(roomId, { clientMessageId: newId, membershipScope: token, intent: 'SHARED', content: { type: 'TEXT', text: 'successor private body' } });
    await DurableOutbox.revokeSession('detached', token, authority.sessionKey);
    await DurableOutbox.revokeSession('detached', 'B'.repeat(42) + 'A', 'b'.repeat(64));
    await next.assertCurrent();
    const retained = Boolean((await next.recover(roomId)).find(record => record.clientMessageId === newId)?.payload);
    next.close(); return { erased, retained };
  });
  expect(result).toEqual({ erased: true, retained: true });
});

test('pending-deletion digest cleanup rejects malformed and successor keys before erasure', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/__outbox_test/outbox/indexeddb.js';
    const { DurableOutbox } = await import(modulePath) as typeof StorageModule;
    const token = 'A'.repeat(43), roomId = crypto.randomUUID();
    const authority = { accountPartition: token, sessionKey: 'a'.repeat(64), rooms: [{ roomId, membershipScope: token, authorizationRevision: token }] };
    const outbox = await DurableOutbox.open('marker'); await outbox.authorize(authority);
    await outbox.prepare(roomId, { clientMessageId: crypto.randomUUID(), membershipScope: token, intent: 'SHARED', content: { type: 'TEXT', text: 'matching session only' } });
    const invalid = await DurableOutbox.revokeSessionKey('marker', 'not-a-session-key').then(() => false, () => true);
    await DurableOutbox.revokeSessionKey('marker', 'b'.repeat(64));
    const retained = Boolean((await outbox.recover(roomId))[0]!.payload);
    await DurableOutbox.revokeSessionKey('marker', authority.sessionKey);
    const fenced = await outbox.assertCurrent().then(() => false, () => true);
    await outbox.authorize(authority); const erased = !(await outbox.recover(roomId))[0]!.payload;
    outbox.close(); return { invalid, retained, fenced, erased };
  });
  expect(result).toEqual({ invalid: true, retained: true, fenced: true, erased: true });
});


test('actual controller recovers an uncertain native record after a cold restart', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const controllerPath = '/__outbox_test/chat-controller.js', memoryPath = '/__outbox_test/chat-memory.js';
    const { ChatController } = await import(controllerPath) as typeof ControllerModule;
    const { ChatMemory } = await import(memoryPath) as typeof MemoryModule;
    const token = 'A'.repeat(43), roomId = crypto.randomUUID(), actorId = crypto.randomUUID();
    const room = { roomId, actorId, name: 'isolated', mode: 'FAN', role: 'STREAMER', membershipScope: token, authorizationRevision: token };
    let sends = 0, lookups = 0;
    const request = async (url: string, options?: { method?: string }) => {
      const path = url.split('?')[0]!;
      if (path.endsWith('/session')) return { authenticated: true, soopLinkStatus: 'VERIFIED', csrfToken: token, accountPartition: token };
      if (path === '/v1/sync') return { schemaVersion: 2, resetRequired: false, generation: 'manifest', rooms: [room], nextCursor: null, complete: true };
      const envelope = { schemaVersion: 2, resetRequired: false, membershipScope: token, authorizationRevision: token };
      if (path.endsWith('/profile-sync')) return { ...envelope, generation: 'profiles', profiles: [{ actorId, role: 'STREAMER', nickname: 'isolated', avatar: null }], nextCursor: null, complete: true };
      if (path.endsWith('/private-recipients')) return { recipients: [], next: null };
      if (path.endsWith('/snapshot')) return { ...envelope, messages: [], nextCursor: 'events', historyCursor: null };
      if (path.endsWith('/events')) return { ...envelope, events: [], nextCursor: 'events', hasMore: false };
      if (path.includes('/message-commands/')) { lookups++; throw { status: 404 }; }
      if (path.endsWith('/messages') && options?.method === 'POST') { sends++; throw { status: 503 }; }
      throw Error(path);
    };
    const first = new ChatController(roomId, request, undefined, token, token, new ChatMemory(), 'controller-cold');
    await first.refresh(); const sent = await first.send({ target: { scope: 'SHARED' }, body: 'durable cold text' });
    const before = first.getSnapshot(); first.dispose(); await new Promise(resolve => setTimeout(resolve, 30));
    const second = new ChatController(roomId, request, undefined, token, token, new ChatMemory(), 'controller-cold');
    await second.refresh(); await new Promise(resolve => setTimeout(resolve, 60));
    const after = second.getSnapshot(); second.dispose();
    return { sent, before, after, sends, lookups };
  });
  expect(result.sends).toBe(1); expect(result.sent.accepted).toBe(false);
  expect(result.before.commands).toHaveLength(1);
  expect(result.after.storageError).toBeNull(); expect(result.after.phase).toBe('ready');
  expect(result.after.commands).toHaveLength(1); expect(result.lookups).toBeGreaterThan(0);
});

test('controller automatically recovers after a temporary storage opening failure', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const controllerPath = '/__outbox_test/chat-controller.js', memoryPath = '/__outbox_test/chat-memory.js', storagePath = '/__outbox_test/outbox/indexeddb.js';
    const { ChatController } = await import(controllerPath) as typeof ControllerModule;
    const { ChatMemory } = await import(memoryPath) as typeof MemoryModule;
    const { DurableOutbox } = await import(storagePath) as typeof StorageModule;
    const token = 'A'.repeat(43), roomId = crypto.randomUUID(), actorId = crypto.randomUUID();
    const room = { roomId, actorId, name: 'isolated', mode: 'FAN', role: 'STREAMER', membershipScope: token, authorizationRevision: token };
    const request = async (url: string) => {
      const path = url.split('?')[0]!;
      if (path.endsWith('/session')) return { authenticated: true, soopLinkStatus: 'VERIFIED', csrfToken: token, accountPartition: token };
      if (path === '/v1/sync') return { schemaVersion: 2, resetRequired: false, generation: 'manifest', rooms: [room], nextCursor: null, complete: true };
      const envelope = { schemaVersion: 2, resetRequired: false, membershipScope: token, authorizationRevision: token };
      if (path.endsWith('/profile-sync')) return { ...envelope, generation: 'profiles', profiles: [{ actorId, role: 'STREAMER', nickname: 'isolated', avatar: null }], nextCursor: null, complete: true };
      if (path.endsWith('/private-recipients')) return { recipients: [], next: null };
      if (path.endsWith('/snapshot')) return { ...envelope, messages: [], nextCursor: 'events', historyCursor: null };
      if (path.endsWith('/events')) return { ...envelope, events: [], nextCursor: 'events', hasMore: false };
      throw Error(path);
    };
    const original = DurableOutbox.open;
    let opens = 0;
    DurableOutbox.open = function (environment) {
      if (++opens === 1) return Promise.reject(new Error('temporary storage failure'));
      return original.call(this, environment);
    };
    const controller = new ChatController(roomId, request, undefined, token, token, new ChatMemory(), 'temporary-failure');
    try {
      await controller.refresh();
      const blocked = controller.getSnapshot().storageError;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { unsubscribe(); reject(Error('automatic storage recovery timed out')); }, 5000);
        const unsubscribe = controller.subscribe(() => {
          if (controller.getSnapshot().storageError !== null) return;
          clearTimeout(timeout); unsubscribe(); resolve();
        });
      });
      return { blocked, recovered: controller.getSnapshot().storageError, opens };
    } finally { controller.dispose(); DurableOutbox.open = original; }
  });
  expect(result).toEqual({ blocked: '메시지를 잠시 보낼 수 없어요.', recovered: null, opens: 2 });
});

test('suspending one tab never blocks another tab or its receipt-first recovery', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/__outbox_test/outbox/indexeddb.js';
    const { DurableOutbox } = await import(modulePath) as typeof StorageModule;
    const token = 'A'.repeat(43), roomId = crypto.randomUUID();
    const authority = { accountPartition: token, sessionKey: 'a'.repeat(64), rooms: [{ roomId, membershipScope: token, authorizationRevision: token }] };
    const payload = { clientMessageId: crypto.randomUUID(), membershipScope: token, intent: 'SHARED' as const, content: { type: 'TEXT' as const, text: 'preserved command' } };
    const first = await DurableOutbox.open('reauthorize-close');
    await first.authorize(authority); await first.prepare(roomId, payload);
    const interrupted = first.authorize(authority).catch(() => {});
    first.close(); await interrupted;
    const second = await DurableOutbox.open('reauthorize-close');
    try {
      await second.authorize(authority);
      const records = await second.recover(roomId);
      const receiptFirst = await second.beforeSend(payload.clientMessageId).then(() => false, error => error.code === 'RECEIPT_FIRST');
      // Repeated suspension must not invalidate a later authorization.
      second.suspend(); second.suspend(); await second.authorize(authority);
      await second.assertCurrent();
      return { recovered: records[0]?.payload, receiptFirst };
    } finally { second.close(); }
  });
  expect(result.recovered?.content).toEqual({ type: 'TEXT', text: 'preserved command' });
  expect(result.receiptFirst).toBe(true);
});
