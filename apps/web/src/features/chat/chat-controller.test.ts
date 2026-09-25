import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChatMemory, sessionChatMemory, forgetChatMemory, MAX_PARKED_ROOMS } from './chat-memory';
import { ChatController } from './chat-controller';
import { actor, membership, mergeMessages, message, projectMessages } from './contract';
import type { ChatRequest, ServerMessage } from './contract';

const scopes = { membershipScope: 'A'.repeat(43), authorizationRevision: 'B'.repeat(42) + 'A' };
const sync = { schemaVersion: 2, resetRequired: false, ...scopes };
const session = { authenticated: true, soopLinkStatus: 'VERIFIED', csrfToken: 'synthetic-csrf-session-A', accountPartition: 'C'.repeat(42) + 'A' };
void test('six-field API session authorizes chat and a later capability denial clears it', async () => {
  let allowed = true;
  const controller = new ChatController(room.roomId, backend(async path => path === '/v1/auth/session'
    ? { ...session, onboardingState: 'READY', capabilities: { chat: allowed } } : undefined));
  try {
    await controller.refresh();
    assert.equal(controller.getSnapshot().phase, 'ready');
    assert.ok(controller.getSnapshot().items.length > 0);
    allowed = false;
    await controller.refresh();
    assert.equal(controller.getSnapshot().phase, 'error');
    assert.deepEqual(controller.getSnapshot().items, []);
  } finally { controller.dispose(); }
});
const room = { roomId: '00000000-0000-4000-8000-000000000001', name: '테스트 채널', actorId: '00000000-0000-4000-8000-000000000002', mode: 'FAN', role: 'FAN', ...scopes };
const profiles = [{ actorId: '00000000-0000-4000-8000-000000000002', nickname: '테스트 팬', role: 'FAN', avatar: null }, { actorId: '00000000-0000-4000-8000-000000000003', nickname: '테스트 운영자', role: 'STREAMER', avatar: null }];
const source = (id = '00000000-0000-4000-8000-000000000004', date = '2026-09-01T00:00:00.000Z'): ServerMessage => ({ id, version: '1', createdAt: date, audience: 'PRIVATE', author: { kind: 'member', actorId: '00000000-0000-4000-8000-000000000003', nickname: '테스트 운영자', avatar: null }, counterpart: { actorId: profiles[1]!.actorId }, allowedActions: { reply: true, publish: false, delete: false }, content: { type: 'TEXT', text: '테스트 메시지' }, quote: null });
const submission = { target: { scope: 'PRIVATE' as const, recipient: { actorId: '00000000-0000-4000-8000-000000000003', displayName: '테스트 운영자', avatarUrl: null, role: 'STREAMER' as const } }, body: '테스트 전송' };
function backend(override?: ChatRequest): ChatRequest {
  return async (path, options) => {
    if (override) { const result = await override(path, options); if (result !== undefined) return result; }
    const data = sync;
    if (path === '/v1/auth/session') return session;
    if (path.includes('/message-commands/')) throw Object.assign(new Error('unknown'), { status: 404 });
    if (path.startsWith('/v1/sync?')) return { schemaVersion: 2, resetRequired: false, rooms: [room], generation: 'membership-1', nextCursor: null, complete: true };
    if (path.includes('/private-recipients')) return { recipients: [{ actorId: profiles[1]!.actorId, nickname: profiles[1]!.nickname, avatar: null }], next: null };
    if (path.includes('/profile-sync?')) return { ...data, profiles, generation: 'profiles-1', nextCursor: null, complete: true };
    if (path.includes('/snapshot?')) return { ...data, messages: [source()], nextCursor: 'events-1', historyCursor: 'history-1' };
    if (path.includes('/events?')) return { ...data, events: [], nextCursor: 'events-2', hasMore: false };
    if (/\/messages\/[0-9a-f-]+$/.test(path)) return source(path.split('/').at(-1), path.endsWith('00000000-0000-4000-8000-000000000007') ? '2026-08-01T00:00:00.000Z' : undefined);
    if (path.includes('/history?')) return { ...data, messages: [source('00000000-0000-4000-8000-000000000007', '2026-08-01T00:00:00.000Z')], nextCursor: null };
    throw new Error('Unexpected request');
  };
}
void test('server-authenticated snapshot renders immediately and resumes from its event cursor', async () => {
  let snapshots = 0, events = 0;
  const seed = { sessionBinding: session.csrfToken, accountPartition: session.accountPartition, room: membership(room),
    profiles: profiles.map(actor).filter(value => value !== null), recipients: [{ actorId: profiles[1]!.actorId, displayName: profiles[1]!.nickname, avatarUrl: null, role: 'STREAMER' as const }],
    messages: [source()], eventCursor: 'events-1', historyCursor: 'history-1', manifestGeneration: 'membership-1', profileGeneration: 'profiles-1',
    deviceId: '00000000-0000-4000-8000-000000000011', cacheId: '00000000-0000-4000-8000-000000000012' };
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path.includes('/snapshot?')) snapshots++;
    if (path.includes('/events?')) events++;
    return undefined;
  }), undefined, session.csrfToken, session.accountPartition, new ChatMemory(), undefined, seed);
  try {
    assert.equal(controller.getSnapshot().phase, 'ready');
    assert.deepEqual(controller.getSnapshot().items.map(item => item.id), [source().id]);
    await controller.refresh();
    assert.equal(controller.getSnapshot().phase, 'ready');
    assert.equal(snapshots, 0);
    assert.equal(events, 1);
  } finally { controller.dispose(); }
});
void test('a wake received during an in-flight read schedules one trailing read', async () => {
  let release!: (value: unknown) => void;
  let reached!: () => void;
  const reading = new Promise<void>(resolve => { reached = resolve; });
  let eventReads = 0;
  const next = source('00000000-0000-4000-8000-000000000012');
  const controller = new ChatController(room.roomId, backend(async path => {
    if (!path.includes('/events?')) return undefined;
    eventReads++;
    if (eventReads === 1) { reached(); return new Promise(resolve => { release = resolve; }); }
    return { ...sync, events: [{ type: 'message.upsert', message: next }], nextCursor: 'after-wake', hasMore: false };
  }));
  try {
    await controller.refresh();
    const first = controller.refresh();
    await reading;
    const duplicateA = controller.refresh();
    const duplicateB = controller.refresh();
    release({ ...sync, events: [], nextCursor: 'before-wake', hasMore: false });
    await Promise.all([first, duplicateA, duplicateB]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(eventReads, 2);
    assert.ok(controller.getSnapshot().items.some(item => item.id === next.id));
  } finally { controller.dispose(); }
});
void test('route entry waits for an old read and completes a new authorization cycle', async () => {
  let release!: (value: unknown) => void;
  let reached!: () => void;
  const reading = new Promise<void>(resolve => { reached = resolve; });
  let eventReads = 0;
  const controller = new ChatController(room.roomId, backend(async path => {
    if (!path.includes('/events?')) return undefined;
    eventReads++;
    if (eventReads === 1) { reached(); return new Promise(resolve => { release = resolve; }); }
    return { ...sync, events: [], nextCursor: 'entry-authorized', hasMore: false };
  }));
  try {
    await controller.refresh();
    const oldRead = controller.refresh();
    await reading;
    const entry = controller.refreshForEntry();
    release({ ...sync, events: [], nextCursor: 'old-read', hasMore: false });
    await Promise.all([oldRead, entry]);
    assert.equal(eventReads, 2);
    assert.equal(controller.getSnapshot().phase, 'ready');
  } finally { controller.dispose(); }
});
for (const recovery of ['send', 'retry', 'reconcile'] as const) void test(`committed ${recovery} starts a fresh schema-2 read after an older in-flight sync settles`, async () => {
  let release!: (value: unknown) => void;
  let reached!: () => void;
  const reading = new Promise<void>(resolve => { reached = resolve; });
  let eventReads = 0; let posts = 0; let lookups = 0; let committed = false;
  const saved: ServerMessage = { ...source('00000000-0000-4000-8000-000000000008'), author: { kind: 'member', actorId: room.actorId, nickname: '테스트 팬', avatar: null }, content: { type: 'TEXT', text: submission.body } };
  const controller = new ChatController(room.roomId, backend(async (path, options) => {
    if (path.endsWith('/messages')) {
      posts++;
      if (recovery !== 'send') throw new TypeError('ACK lost');
      committed = true;
      const body = options?.body as { clientMessageId: string; membershipScope: string };
      assert.equal(body.membershipScope, scopes.membershipScope);
      return { clientMessageId: body.clientMessageId, messageId: saved.id, status: 'committed', version: '1' };
    }
    if (path.includes('/message-commands/')) {
      lookups++; committed = true;
      return { clientMessageId: path.split('/').at(-1), messageId: saved.id, status: 'committed', version: '1' };
    }
    if (path.includes('/events?')) {
      if (++eventReads === 1) { reached(); return new Promise(resolve => { release = resolve; }); }
      assert.equal(committed, true);
      return { ...sync, events: [{ type: 'message.upsert', message: saved }], nextCursor: 'after-send', hasMore: false };
    }
    return undefined;
  }));
  await controller.refresh();
  let retryCommandId: string | undefined;
  if (recovery !== 'send') {
    const unknown = await controller.send(submission);
    assert.equal(unknown.accepted, false); assert.ok(unknown.retryCommandId);
    retryCommandId = unknown.retryCommandId;
  }
  const oldRead = controller.refresh(); await reading;
  const action = recovery === 'reconcile' ? controller.reconcile(retryCommandId!) : controller.send({ ...submission, ...(retryCommandId ? { retryCommandId } : {}) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(committed, false); // The schema-2 authority fence waits for the old read.
  assert.equal(controller.getSnapshot().items.some(item => item.id === saved.id), false);
  release({ ...sync, events: [], nextCursor: 'before-send', hasMore: false });
  await oldRead;
  const result = await action; if (result) assert.equal(result.accepted, true);
  // No timer, socket hint or manual refresh may be needed to see the saved send.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(eventReads, 2); assert.equal(posts, 1); assert.equal(lookups, recovery === 'send' ? 0 : 1);
  assert.equal(controller.getSnapshot().items.some(item => item.id === saved.id), true);
  controller.dispose();
});
void test('actual DTO mapping does not guess private recipient, quote author, avatar or read status', () => {
  const dto = message({ ...source(), quote: { id: '00000000-0000-4000-8000-000000000005', content: { type: 'TEXT', text: '인용' } } });
  const item = projectMessages([dto], '00000000-0000-4000-8000-000000000002', [])[0]!;
  assert.equal(item.kind, 'message'); if (item.kind !== 'message') return;
  assert.equal(item.recipient, undefined); assert.equal(item.author.role, undefined);
  assert.equal(item.author.avatarUrl, null); assert.equal(item.quote?.authorName, '사용자'); assert.equal(item.status, 'saved');
  const publication = projectMessages([{ ...source(), audience: 'SHARED', author: { kind: 'anonymous' }, counterpart: null, allowedActions: { reply: false, publish: false, delete: true } }], '00000000-0000-4000-8000-000000000002', [])[0]!;
  assert.equal(publication.kind, 'publication'); assert.equal('author' in publication, false); assert.equal('quote' in publication, false);
});
void test('ambiguous send and invalid ACK retain identical retry ID until matching persisted ACK', async () => {
  const ids: string[] = [];
  const controller = new ChatController(room.roomId, backend(async (path, options) => {
    if (!path.endsWith('/messages')) return undefined;
    const body = options?.body as { clientMessageId: string }; ids.push(body.clientMessageId);
    if (ids.length === 1) throw new TypeError('network lost');
    return { clientMessageId: ids.length === 2 ? 'wrong-id' : body.clientMessageId, messageId: '00000000-0000-4000-8000-000000000006', status: 'committed', version: '1' };
  }));
  await controller.refresh();
  const first = await controller.send(submission); assert.equal(first.accepted, false);
  assert.equal(controller.getSnapshot().items.length, 1);
  assert.equal((await controller.send({ ...submission, ...(!first.accepted && first.retryCommandId ? { retryCommandId: first.retryCommandId } : {}) })).accepted, false);
  assert.equal((await controller.send({ ...submission, ...(!first.accepted && first.retryCommandId ? { retryCommandId: first.retryCommandId } : {}) })).accepted, true);
  assert.equal(new Set(ids).size, 1); controller.dispose();
});
void test('room access rejection purges private data and locks without reauthentication loops', async () => {
  let revoked = false; let invalidations = 0;
  const controller = new ChatController(room.roomId, backend(async () => { if (revoked) throw Object.assign(new Error('denied'), { status: 403 }); }), () => { invalidations++; });
  await controller.refresh(); assert.equal(controller.getSnapshot().items.length, 1);
  revoked = true; await controller.refresh();
  assert.equal(controller.getSnapshot().items.length, 0); assert.equal(controller.getSnapshot().profiles.length, 0);
  assert.equal(controller.getSnapshot().room, null); assert.equal(invalidations, 0); controller.dispose();
});
void test('cursor reset hides old cache before re-snapshot without treating it as composer authority loss', async () => {
  let snapshots = 0; let reset = false; let observedEmpty = false;
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path.includes('/snapshot?')) return { ...sync, messages: ++snapshots === 1 ? [source()] : [], nextCursor: 'fresh', historyCursor: null };
    if (path.includes('/events?') && reset) return { schemaVersion: 2, resetRequired: true, events: [], hasMore: false, nextCursor: null, membershipScope: null, authorizationRevision: null };
    return undefined;
  }));
  await controller.refresh(); const epoch = controller.getSnapshot().epoch;
  controller.subscribe(() => { if (controller.getSnapshot().phase === 'loading' && controller.getSnapshot().items.length === 0) observedEmpty = true; });
  reset = true; await controller.refresh();
  assert.equal(observedEmpty, true); assert.equal(controller.getSnapshot().epoch, epoch); assert.equal(controller.getSnapshot().phase, 'ready'); assert.deepEqual(controller.getSnapshot().items, []); controller.dispose();
});
void test('late snapshot after disposal cannot repopulate a previous session or room', async () => {
  let release!: (value: unknown) => void;
  let reached!: () => void; const pending = new Promise<void>(resolve => { reached = resolve; });
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path.includes('/snapshot?')) { reached(); return new Promise(resolve => { release = resolve; }); }
    return undefined;
  }));
  const work = controller.refresh(); await pending; controller.dispose();
  release({ ...sync, messages: [source()], nextCursor: 'stale', historyCursor: null });
  await work; assert.deepEqual(controller.getSnapshot().items, []);
});
void test('reconnect refresh resumes cursor, applies deletion, and history remains chronological', async () => {
  const paths: string[] = []; let remove = false;
  const controller = new ChatController(room.roomId, backend(async path => {
    paths.push(path);
    if (path.includes('/snapshot?') && remove) return { ...sync, messages: [source('00000000-0000-4000-8000-000000000007', '2026-08-01T00:00:00.000Z')], nextCursor: 'after-delete', historyCursor: null };
    if (path.includes('/events?') && remove) return { ...sync, events: [{ type: 'message.deleted', messageId: '00000000-0000-4000-8000-000000000004', version: '2' }], nextCursor: 'after-delete', hasMore: false };
    return undefined;
  }));
  await controller.refresh(); await controller.loadOlder();
  assert.deepEqual(controller.getSnapshot().items.map(item => item.id), ['00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000004']);
  remove = true; await controller.refresh();
  assert.ok(paths.some(path => path.includes('cursor=events-1'))); assert.deepEqual(controller.getSnapshot().items.map(item => item.id), ['00000000-0000-4000-8000-000000000007']); controller.dispose();
});
void test('upserts retain chronological position and older versions cannot overwrite newer content', () => {
  const early = source('00000000-0000-4000-8000-000000000008'); const later = source('00000000-0000-4000-8000-000000000009', '2026-09-02T00:00:00.000Z');
  const changed = { ...early, version: '3', content: { type: 'TEXT' as const, text: '수정됨' } };
  const result = mergeMessages([early, later], [changed, { ...early, version: '2' }]);
  assert.deepEqual(result.map(item => item.id), ['00000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000009']); assert.deepEqual(result[0]?.content, { type: 'TEXT', text: '수정됨' });
});

void test('uncertain send ID survives transient sync failure and profile generation reset', async () => {
  let offline = false; let generation = 'profiles-1'; const ids: string[] = [];
  const controller = new ChatController(room.roomId, backend(async (path, options) => {
    if (offline) throw new TypeError('offline');
    if (path.includes('/profile-sync?')) return { ...sync, profiles, generation, nextCursor: null, complete: true };
    if (path.endsWith('/messages')) { ids.push((options?.body as { clientMessageId: string }).clientMessageId); throw new TypeError('ack lost'); }
    return undefined;
  }));
  await controller.refresh(); const first = await controller.send(submission);
  const retry = { ...submission, ...(!first.accepted && first.retryCommandId ? { retryCommandId: first.retryCommandId } : {}) };
  offline = true; await controller.refresh(); assert.deepEqual(controller.getSnapshot().items, []);
  offline = false; await controller.refresh(); await controller.send(retry);
  generation = 'profiles-2'; await controller.refresh(); await controller.send(retry);
  assert.equal(ids.length, 3); assert.equal(new Set(ids).size, 1); controller.dispose();
});
void test('unloaded historical delta upsert uses canonical display order without replacing the cache', async () => {
  let snapshots = 0;
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path.includes('/snapshot?')) return { ...sync, messages: ++snapshots === 1 ? [source('00000000-0000-4000-8000-000000000010')] : [source('00000000-0000-4000-8000-000000000011'), source('00000000-0000-4000-8000-000000000010')], nextCursor: 'new-cursor', historyCursor: null };
    if (path.includes('/events?')) return { ...sync, events: [{ type: 'message.upsert', message: source('00000000-0000-4000-8000-000000000011') }], nextCursor: 'event-cursor', hasMore: false };
    return undefined;
  }));
  await controller.refresh(); const epoch = controller.getSnapshot().epoch;
  await controller.refresh();
  assert.equal(snapshots, 1); assert.equal(controller.getSnapshot().epoch, epoch);
  assert.deepEqual(controller.getSnapshot().items.map(item => item.id), ['00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000011']); controller.dispose();
});
void test('recipient send rejection refreshes authorization without asserting session logout', async () => {
  let invalidations = 0;
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path.endsWith('/messages')) throw Object.assign(new Error('recipient revoked'), { status: 403 });
    return undefined;
  }), () => { invalidations++; });
  await controller.refresh(); assert.equal((await controller.send(submission)).accepted, false);
  await controller.refresh(); assert.equal(invalidations, 0); assert.equal(controller.getSnapshot().phase, 'ready'); controller.dispose();
});

void test('profile visibility never authorizes a recipient omitted from private-recipients', async () => {
  let posts = 0;
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path.includes('/private-recipients')) return { recipients: [], next: null };
    if (path.endsWith('/messages')) posts++;
    return undefined;
  }));
  await controller.refresh(); assert.equal(controller.getSnapshot().profiles.length, 2);
  assert.equal((await controller.send(submission)).accepted, false); assert.equal(posts, 0);
  await controller.refresh(); assert.deepEqual(controller.getSnapshot().commands, []); controller.dispose();
});
void test('changed cookie session cannot publish another account into the original scope', async () => {
  let session = 'synthetic-csrf-session-a'; let invalidations = 0;
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path === '/v1/auth/session') return { authenticated: true, soopLinkStatus: 'VERIFIED', csrfToken: session, accountPartition: 'C'.repeat(42) + 'A' };
    return undefined;
  }), () => { invalidations++; }, session);
  await controller.refresh(); assert.equal(controller.getSnapshot().items.length, 1);
  session = 'synthetic-csrf-session-b'; await controller.refresh();
  assert.equal(invalidations, 1); assert.deepEqual(controller.getSnapshot().items, []); assert.equal(controller.getSnapshot().room, null); controller.dispose();
});

void test('shared send follows manifest role, omits recipient field, and never quotes private content into shared', async () => {
  const bodies: Record<string, unknown>[] = [];
  const controller = new ChatController(room.roomId, backend(async (path, options) => {
    if (path.startsWith('/v1/sync?')) return { schemaVersion: 2, resetRequired: false, rooms: [{ ...room, actorId: '00000000-0000-4000-8000-000000000003', role: 'STREAMER' }], generation: 'owner-membership', nextCursor: null, complete: true };
    if (path.includes('/private-recipients')) return { recipients: [{ actorId: profiles[0]!.actorId, nickname: profiles[0]!.nickname, avatar: null }], next: null };
    if (path.endsWith('/messages')) {
      const body = options?.body as Record<string, unknown>; bodies.push(body);
      return { clientMessageId: body.clientMessageId, messageId: '00000000-0000-4000-8000-000000000013', status: 'committed', version: '1' };
    }
    return undefined;
  }));
  await controller.refresh();
  assert.equal((await controller.send({ target: { scope: 'SHARED' }, body: '공개', quoteMessageId: '00000000-0000-4000-8000-000000000004' })).accepted, false);
  assert.equal(bodies.length, 0);
  assert.equal((await controller.send({ target: { scope: 'SHARED' }, body: '공개' })).accepted, true);
  assert.equal(bodies[0]?.intent, 'SHARED'); assert.equal('recipientActorId' in bodies[0]!, false);
  controller.dispose();
  const fan = new ChatController(room.roomId, backend()); await fan.refresh();
  assert.equal((await fan.send({ target: { scope: 'SHARED' }, body: '공개' })).accepted, false); fan.dispose();
});

void test('deletion refuses another author, retries same resource, and hides all derived text only after blocked ACK', async () => {
  const own = { ...source('00000000-0000-4000-8000-000000000012'), author: { kind: 'member' as const, actorId: '00000000-0000-4000-8000-000000000002', nickname: '테스트 팬', avatar: null }, allowedActions: { reply: true, publish: false, delete: true } };
  let blocked = false; let deleteCalls = 0; let observedCleared = false;
  const paths: string[] = [];
  const controller = new ChatController(room.roomId, backend(async (path, options) => {
    if (path.includes('/snapshot?')) return { ...sync, messages: blocked ? [] : [source(), own], nextCursor: 'events', historyCursor: null };
    if (path.endsWith('/delete')) {
      deleteCalls++; paths.push(path); assert.deepEqual(options?.body, {}); assert.equal(options?.method, 'POST');
      if (deleteCalls === 1) throw new TypeError('lost response');
      blocked = true; return { requestId: '00000000-0000-4000-8000-000000000014', status: 'blocked' };
    }
    return undefined;
  }));
  await controller.refresh();
  assert.equal((await controller.remove('00000000-0000-4000-8000-000000000004')).accepted, false); assert.equal(deleteCalls, 0);
  assert.equal((await controller.remove('00000000-0000-4000-8000-000000000012')).accepted, false); assert.equal(controller.getSnapshot().items.length, 2);
  controller.subscribe(() => { if (controller.getSnapshot().phase === 'loading' && controller.getSnapshot().items.length === 0) observedCleared = true; });
  assert.equal((await controller.remove('00000000-0000-4000-8000-000000000012')).accepted, true);
  assert.equal(paths[0], paths[1]); assert.equal(observedCleared, true);
  assert.deepEqual(controller.getSnapshot().items, []); assert.match(controller.getSnapshot().notice!, /차단/); controller.dispose();
});
void test('unrecognized deletion acknowledgement never hides data or claims completion', async () => {
  const own = { ...source(), author: { kind: 'member' as const, actorId: '00000000-0000-4000-8000-000000000002', nickname: '테스트 팬', avatar: null }, allowedActions: { reply: true, publish: false, delete: true } };
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path.includes('/snapshot?')) return { ...sync, messages: [own], nextCursor: 'events', historyCursor: null };
    if (path.endsWith('/delete')) return { requestId: '00000000-0000-4000-8000-000000000014', status: 'purged' };
    return undefined;
  }));
  await controller.refresh(); assert.equal((await controller.remove(own.id)).accepted, false);
  assert.equal(controller.getSnapshot().items.length, 1); controller.dispose();
});
void test('delete ACK aborts an older in-flight sync so stale private content cannot return', async () => {
  const own = { ...source(), author: { kind: 'member' as const, actorId: '00000000-0000-4000-8000-000000000002', nickname: '테스트 팬', avatar: null }, allowedActions: { reply: true, publish: false, delete: true } };
  let blocked = false; let release!: (value: unknown) => void; let reached!: () => void;
  const waiting = new Promise<void>(resolve => { reached = resolve; });
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path.includes('/snapshot?')) return { ...sync, messages: blocked ? [] : [own], nextCursor: 'events', historyCursor: null };
    if (path.includes('/events?')) { reached(); return new Promise(resolve => { release = resolve; }); }
    if (path.endsWith('/delete')) { blocked = true; return { requestId: '00000000-0000-4000-8000-000000000014', status: 'blocked' }; }
    return undefined;
  }));
  await controller.refresh(); const syncWork = controller.refresh(); await waiting;
  const removal = controller.remove(own.id);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(controller.getSnapshot().items, []);
  release({ ...sync, events: [{ type: 'message.upsert', message: own }], hasMore: false, nextCursor: 'stale' });
  await syncWork; assert.equal((await removal).accepted, true); assert.deepEqual(controller.getSnapshot().items, []); controller.dispose();
});


void test('delete 403/404 immediately hide prior private data and revalidate without global logout', async () => {
  for (const status of [403, 404]) {
    const own = { ...source(), author: { kind: 'member' as const, actorId: '00000000-0000-4000-8000-000000000002', nickname: '테스트 팬', avatar: null }, allowedActions: { reply: true, publish: false, delete: true } };
    let denied = false; let invalidations = 0; let manifests = 0;
    const controller = new ChatController(room.roomId, backend(async path => {
      if (path.startsWith('/v1/sync?')) manifests++;
      if (path.includes('/snapshot?')) return { ...sync, messages: denied ? [] : [own], nextCursor: 'events', historyCursor: null };
      if (path.endsWith('/delete')) { denied = true; throw Object.assign(new Error('access changed'), { status }); }
      return undefined;
    }), () => { invalidations++; });
    await controller.refresh(); assert.equal(controller.getSnapshot().items.length, 1);
    assert.equal((await controller.remove(own.id)).accepted, false);
    assert.deepEqual(controller.getSnapshot().items, []);
    await controller.refresh(); assert.ok(manifests >= 2); assert.equal(invalidations, 0);
    assert.deepEqual(controller.getSnapshot().items, []); controller.dispose();
  }
});

void test('remote deletion purges the complete draft epoch before recovery without forgetting uncertain sends', async () => {
  let removed = false; let observedEmpty = false; const ids: string[] = [];
  const controller = new ChatController(room.roomId, backend(async (path, options) => {
    if (path.includes('/events?') && removed) return { ...sync, events: [{ type: 'message.deleted', messageId: '00000000-0000-4000-8000-000000000004', version: '2' }], nextCursor: 'deleted', hasMore: false };
    if (path.includes('/snapshot?') && removed) return { ...sync, messages: [], nextCursor: 'deleted', historyCursor: null };
    if (path.endsWith('/messages')) { ids.push((options?.body as { clientMessageId: string }).clientMessageId); throw new TypeError('ack lost'); }
    return undefined;
  }));
  await controller.refresh(); const first = await controller.send(submission);
  const retry = { ...submission, ...(!first.accepted && first.retryCommandId ? { retryCommandId: first.retryCommandId } : {}) };
  const epoch = controller.getSnapshot().epoch;
  controller.subscribe(() => { const state = controller.getSnapshot(); if (state.epoch > epoch && state.items.length === 0) observedEmpty = true; });
  removed = true; await controller.refresh();
  assert.equal(observedEmpty, true); assert.equal(controller.getSnapshot().epoch, epoch + 1);
  assert.deepEqual(controller.getSnapshot().items, []);
  await controller.send(retry);
  assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]); controller.dispose();
});

void test('reactions read/set/change/remove use authoritative contracts without optimistic counts', async () => {
  const calls: { method: string | undefined; body: unknown }[] = [];
  let mine: string | null = null;
  const controller = new ChatController(room.roomId, backend(async (path, options) => {
    if (!path.includes('/reactions')) return undefined;
    calls.push({ method: options?.method, body: options?.body });
    if (options?.method === 'PUT') mine = (options.body as { emoji: string }).emoji;
    if (options?.method === 'DELETE') mine = null;
    return { counts: mine ? [{ emoji: mine, count: 3 }] : [], mine };
  }));
  await controller.refresh(); assert.deepEqual(controller.getSnapshot().reactions, {});
  await controller.react('unsaved'); assert.equal(calls.length, 0);
  await controller.react('00000000-0000-4000-8000-000000000004');
  assert.deepEqual(controller.getSnapshot().reactions['00000000-0000-4000-8000-000000000004']?.summary, { counts: [], mine: null });
  await controller.react('00000000-0000-4000-8000-000000000004', '👍');
  assert.equal(controller.getSnapshot().reactions['00000000-0000-4000-8000-000000000004']?.summary?.counts[0]?.count, 3);
  await controller.react('00000000-0000-4000-8000-000000000004', '❤️'); await controller.react('00000000-0000-4000-8000-000000000004', null);
  assert.deepEqual(calls.map(call => call.method), [undefined, 'PUT', 'PUT', 'DELETE']);
  assert.deepEqual(calls[2]?.body, { emoji: '❤️' });
  assert.equal(controller.getSnapshot().reactions['00000000-0000-4000-8000-000000000004']?.summary?.mine, null); controller.dispose();
});

for (const transition of ['dispose', 'deletion', 'version', 'profile'] as const) void test(`late reaction cannot survive ${transition}`, async () => {
  let release!: (value: unknown) => void; let changed = false;
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path.includes('/reactions')) return new Promise(resolve => { release = resolve; });
    if (changed && path.includes('/events?')) return { ...sync, events: transition === 'deletion' ? [{ type: 'message.deleted', messageId: '00000000-0000-4000-8000-000000000004', version: '2' }] : [{ type: 'message.upsert', message: { ...source(), version: '2' } }], nextCursor: 'new', hasMore: false };
    if (changed && path.includes('/snapshot?')) return { ...sync, messages: [], nextCursor: 'new', historyCursor: null };
    if (changed && transition === 'profile' && path.includes('/profile-sync?')) return { ...sync, profiles, generation: 'new', nextCursor: null, complete: true };
    return undefined;
  }));
  await controller.refresh(); const work = controller.react('00000000-0000-4000-8000-000000000004');
  changed = true; if (transition === 'dispose') controller.dispose(); else await controller.refresh();
  release({ counts: [{ emoji: '👍', count: 99 }], mine: '👍' }); await work;
  assert.deepEqual(controller.getSnapshot().reactions, {});
  assert.equal(controller.getSnapshot().reactionRevision, transition === 'version' ? 1 : 0); controller.dispose();
});

for (const status of [401, 403, 404, 429, 503]) void test(`reaction ${status} exposes no invented count and never retries a write`, async () => {
  let calls = 0; let invalidations = 0;
  const controller = new ChatController(room.roomId, backend(async path => {
    if (!path.includes('/reactions')) return undefined;
    calls++; throw Object.assign(new Error('private raw body'), { status });
  }), () => { invalidations++; });
  await controller.refresh(); await controller.react('00000000-0000-4000-8000-000000000004', '👍');
  assert.equal(calls, 1); assert.equal(invalidations, status === 401 ? 1 : 0);
  assert.equal(controller.getSnapshot().reactions['00000000-0000-4000-8000-000000000004']?.summary, undefined);
  if (status === 429) { await controller.react('00000000-0000-4000-8000-000000000004'); assert.equal(calls, 1); }
  assert.ok(!JSON.stringify(controller.getSnapshot()).includes('private raw body')); controller.dispose();
});

void test('reaction fanout is capped at four and deduplicated per message', async () => {
  const releases: ((value: unknown) => void)[] = [];
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path.includes('/snapshot?')) return { ...sync, messages: Array.from({ length: 8 }, (_, i) => source(`00000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}`)), nextCursor: 'events', historyCursor: null };
    if (path.includes('/reactions')) return new Promise(resolve => { releases.push(resolve); });
    return undefined;
  }));
  await controller.refresh(); const pending = Array.from({ length: 8 }, (_, i) => controller.react(`00000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}`));
  await controller.react('00000000-0000-4000-8000-000000000100', '👍'); assert.equal(releases.length, 4);
  releases.forEach(resolve => resolve({ counts: [], mine: null })); await Promise.all(pending); controller.dispose();
});

void test('intentional identical new commands get distinct identities; an explicit retry reconciles committed ACK loss without replay', async () => {
  const posts: string[] = []; let lookups = 0;
  const controller = new ChatController(room.roomId, backend(async (path, options) => {
    if (path.endsWith('/messages')) { posts.push((options?.body as { clientMessageId: string }).clientMessageId); throw new TypeError('ack lost'); }
    if (path.includes('/message-commands/')) { lookups++; return { clientMessageId: path.split('/').at(-1), status: 'committed', messageId: source().id, version: '18446744073709551615' }; }
    return undefined;
  }));
  await controller.refresh();
  const first = await controller.send(submission); const second = await controller.send(submission);
  assert.equal(first.accepted, false); assert.equal(second.accepted, false); assert.equal(new Set(posts).size, 2);
  assert.equal(lookups, 0); // No automatic replay or lookup loop.
  if (first.accepted || !first.retryCommandId) throw new Error('missing command');
  assert.equal((await controller.send({ ...submission, retryCommandId: first.retryCommandId })).accepted, true);
  assert.equal(posts.length, 2); assert.equal(lookups, 1); controller.dispose();
});

void test('deleted lookup is terminal and a forged deleted response with metadata never settles', async () => {
  for (const extra of [false, true]) {
    let posts = 0;
    const controller = new ChatController(room.roomId, backend(async (path) => {
      if (path.endsWith('/messages')) { posts++; throw new TypeError('ack lost'); }
      if (path.includes('/message-commands/')) return { clientMessageId: path.split('/').at(-1), status: 'deleted', ...(extra ? { messageId: source().id } : {}) };
      return undefined;
    }));
    await controller.refresh(); const first = await controller.send(submission);
    if (first.accepted || !first.retryCommandId) throw new Error('missing command');
    const result = await controller.send({ ...submission, retryCommandId: first.retryCommandId });
    assert.equal(result.accepted, !extra); assert.equal(posts, 1);
    if (result.accepted) assert.match(result.note!, /삭제/);
    controller.dispose();
  }
});

void test('ambiguous receipt 404 does not remint or replay without explicit retry; authorized retry preserves frozen bytes', async () => {
  const posts: unknown[] = []; let lookups = 0;
  const controller = new ChatController(room.roomId, backend(async (path, options) => {
    if (path.endsWith('/messages')) { assert.ok(Object.isFrozen(options!.body)); posts.push(structuredClone(options?.body)); throw new TypeError('ack lost'); }
    if (path.includes('/message-commands/')) { lookups++; throw Object.assign(new Error('unreadable or absent'), { status: 404 }); }
    return undefined;
  }));
  await controller.refresh(); const first = await controller.send(submission); await controller.refresh();
  assert.equal(posts.length, 1); assert.equal(lookups, 0);
  if (first.accepted || !first.retryCommandId) throw new Error('missing command');
  await controller.send({ ...submission, retryCommandId: first.retryCommandId });
  assert.equal(lookups, 1); assert.equal(posts.length, 2); assert.deepEqual(posts[0], posts[1]); controller.dispose();
});

void test('leave/rejoin and repeating M/A cannot rebind an old unknown command', async () => {
  let currentScope = scopes.membershipScope; let posts = 0;
  const base = backend();
  const request: ChatRequest = async (path, options) => {
    if (path.endsWith('/messages')) { posts++; throw new TypeError('lost'); }
    const value = await base(path, options) as Record<string, unknown>;
    if (path.startsWith('/v1/sync?')) return { ...value, rooms: [{ ...room, membershipScope: currentScope }] };
    return 'membershipScope' in value ? { ...value, membershipScope: currentScope } : value;
  };
  const controller = new ChatController(room.roomId, request); await controller.refresh();
  const first = await controller.send(submission);
  if (first.accepted || !first.retryCommandId) throw new Error('missing command');
  currentScope = 'D'.repeat(42) + 'A'; await controller.refresh();
  assert.equal((await controller.send({ ...submission, retryCommandId: first.retryCommandId })).accepted, false);
  currentScope = scopes.membershipScope; await controller.refresh();
  assert.equal((await controller.send({ ...submission, retryCommandId: first.retryCommandId })).accepted, false);
  assert.equal(posts, 1); controller.dispose();
});

void test('well-formed mismatch 409 refreshes authority without retrying or changing original M', async () => {
  let posts = 0; const payloads: unknown[] = [];
  const controller = new ChatController(room.roomId, backend(async (path, options) => {
    if (path.endsWith('/messages')) { posts++; payloads.push(options?.body); throw Object.assign(new Error('opaque'), { status: 409, code: 'MEMBERSHIP_SCOPE_MISMATCH' }); }
    return undefined;
  }));
  await controller.refresh(); const result = await controller.send(submission); await controller.refresh();
  assert.equal(result.accepted, false); assert.equal(posts, 1); assert.equal((payloads[0] as { membershipScope: string }).membershipScope, scopes.membershipScope); controller.dispose();
});

void test('equal-version whole DTO refresh removes counterpart/actions and fences late reaction results', async () => {
  let changed = false; let release!: (value: unknown) => void;
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path.includes('/reactions')) return new Promise(resolve => { release = resolve; });
    if (changed && path.includes('/events?')) return { ...sync, events: [{ type: 'message.upsert', message: { ...source(), counterpart: null, allowedActions: { reply: false, publish: false, delete: false } } }], hasMore: false, nextCursor: 'changed' };
    return undefined;
  }));
  await controller.refresh(); const reaction = controller.react(source().id);
  changed = true; await controller.refresh(); release({ counts: [{ emoji: '👍', count: 12 }], mine: null }); await reaction;
  const item = controller.getSnapshot().items[0]!;
  assert.equal(item.kind, 'message'); if (item.kind === 'message') { assert.equal(item.allowedActions?.reply, false); assert.equal(item.counterpartActorId, null); }
  assert.deepEqual(controller.getSnapshot().reactions, {}); controller.dispose();
});

void test('higher-version live events and history never resurrect a tombstone, while cursors still advance', async () => {
  let stage = 0; const paths: string[] = [];
  const controller = new ChatController(room.roomId, backend(async path => {
    paths.push(path);
    if (path.includes('/events?')) return { ...sync, events: stage++ === 0 ? [{ type: 'message.deleted', messageId: source().id, version: '2' }] : [{ type: 'message.upsert', message: { ...source(), version: '18446744073709551615' } }], hasMore: false, nextCursor: `events-${stage + 10}` };
    if (path.includes('/history?')) return { ...sync, messages: [{ ...source(), version: '9999999999999999999' }], nextCursor: null };
    return undefined;
  }));
  await controller.refresh(); const epoch = controller.getSnapshot().epoch;
  await controller.refresh(); await controller.refresh(); await controller.loadOlder();
  assert.deepEqual(controller.getSnapshot().items, []); assert.equal(controller.getSnapshot().epoch, epoch + 1);
  assert.ok(paths.some(path => path.includes('cursor=events-11'))); controller.dispose();
});

void test('fresh cache generation rejects late history and reaction results even with identical M/A', async () => {
  let release!: (value: unknown) => void; let reached!: () => void;
  const waiting = new Promise<void>(resolve => { reached = resolve; }); const caches: string[] = [];
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path.includes('/snapshot?')) caches.push(new URL(path, 'https://example.test').searchParams.get('cacheId')!);
    if (path.includes('/history?')) { reached(); return new Promise(resolve => { release = resolve; }); }
    return undefined;
  }));
  await controller.refresh(); const old = controller.loadOlder(); await waiting;
  const reset = controller.refreshHints(); release({ ...sync, messages: [{ ...source(), content: { type: 'TEXT', text: 'stale-history' } }], nextCursor: null });
  await old; await reset;
  assert.equal(new Set(caches).size, 2); assert.ok(!JSON.stringify(controller.getSnapshot()).includes('stale-history')); controller.dispose();
});

void test('outgoing PRIVATE quote targets counterpart; author alone never grants reply', async () => {
  const outgoing = { ...source(), author: { kind: 'member' as const, actorId: room.actorId, nickname: '나', avatar: null }, counterpart: { actorId: profiles[1]!.actorId }, allowedActions: { reply: true, publish: false, delete: true } };
  const bodies: unknown[] = [];
  const controller = new ChatController(room.roomId, backend(async (path, options) => {
    if (path.includes('/snapshot?')) return { ...sync, messages: [outgoing], nextCursor: 'events', historyCursor: null };
    if (path.endsWith('/messages')) { bodies.push(options?.body); return { clientMessageId: (options?.body as { clientMessageId: string }).clientMessageId, status: 'committed', messageId: outgoing.id, version: '1' }; }
    return undefined;
  }));
  await controller.refresh(); assert.equal((await controller.send({ ...submission, quoteMessageId: outgoing.id })).accepted, true);
  assert.equal((bodies[0] as { recipientActorId: string }).recipientActorId, outgoing.counterpart.actorId); controller.dispose();
});

void test('read-only recovery survives a draft reset and ambiguous 404 never issues a SEND', async () => {
  let posts = 0; let deleted = false; let reads = 0;
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path.endsWith('/messages')) { posts++; throw new TypeError('lost ack'); }
    if (path.includes('/message-commands/')) { reads++; if (deleted) return { clientMessageId: path.split('/').at(-1), status: 'deleted' }; throw Object.assign(new Error('ambiguous'), { status: 404 }); }
    return undefined;
  }));
  await controller.refresh(); const first = await controller.send(submission);
  if (first.accepted || !first.retryCommandId) throw new Error('missing command');
  await controller.refreshHints(); assert.equal(controller.getSnapshot().commands.length, 1);
  await controller.reconcile(first.retryCommandId);
  assert.equal(posts, 1); assert.equal(reads, 1); assert.equal(controller.getSnapshot().commands.length, 1);
  deleted = true; await controller.reconcile(first.retryCommandId);
  assert.equal(posts, 1); assert.deepEqual(controller.getSnapshot().commands, []); controller.dispose();
});

void test('late receipt after fresh identical-M/A generation cannot settle an unknown command', async () => {
  let release!: (value: unknown) => void; let reached!: () => void;
  const waiting = new Promise<void>(resolve => { reached = resolve; });
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path.endsWith('/messages')) throw new TypeError('lost ack');
    if (path.includes('/message-commands/')) { reached(); return new Promise(resolve => { release = resolve; }); }
    return undefined;
  }));
  await controller.refresh(); const first = await controller.send(submission);
  if (first.accepted || !first.retryCommandId) throw new Error('missing command');
  const read = controller.reconcile(first.retryCommandId); await waiting;
  const reset = controller.refreshHints();
  release({ clientMessageId: first.retryCommandId, status: 'committed', messageId: source().id, version: '99' });
  await read; await reset; await controller.refresh();
  assert.equal(controller.getSnapshot().commands.length, 1); controller.dispose();
});


void test('equal-version history hint replacement also fences a late reaction result', async () => {
  let release!: (value: unknown) => void;
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path.includes('/reactions')) return new Promise(resolve => { release = resolve; });
    if (path.includes('/history?')) return { ...sync, messages: [{ ...source(), counterpart: null, allowedActions: { reply: false, publish: false, delete: false } }], nextCursor: null };
    return undefined;
  }));
  await controller.refresh(); const reaction = controller.react(source().id);
  await controller.loadOlder(); release({ counts: [{ emoji: '👍', count: 4 }], mine: null }); await reaction;
  const item = controller.getSnapshot().items[0]!;
  assert.equal(item.kind, 'message'); if (item.kind === 'message') assert.equal(item.allowedActions?.reply, false);
  assert.deepEqual(controller.getSnapshot().reactions, {}); controller.dispose();
});

void test('generic and repeated sync tombstones do not invent durable command deletion', async () => {
  let id = ''; let removed = false;
  const controller = new ChatController(room.roomId, backend(async (path, options) => {
    if (path.endsWith('/messages')) { id = (options?.body as { clientMessageId: string }).clientMessageId; return { clientMessageId: id, status: 'committed', messageId: source().id, version: '1' }; }
    if (removed && path.includes('/events?')) return { ...sync, events: [{ type: 'message.deleted', messageId: source().id, version: '2' }], hasMore: false, nextCursor: 'after-block' };
    return undefined;
  }));
  await controller.refresh(); await controller.send(submission); await controller.refresh();
  removed = true; await controller.refresh(); const epoch = controller.getSnapshot().epoch;
  await controller.refresh(); assert.equal(controller.getSnapshot().epoch, epoch);
  const result = await controller.send({ ...submission, retryCommandId: id });
  assert.equal(result.accepted, true); if (result.accepted) assert.doesNotMatch(result.note ?? '', /삭제/);
  controller.dispose();
});

void test('confirmed room loss keeps only non-replayable outcome lookup identity after access returns', async () => {
  let denied = false; let posts = 0; let reads = 0;
  const memory = new ChatMemory();
  const controller = new ChatController(room.roomId, backend(async path => {
    if (denied && path.startsWith('/v1/sync?')) throw Object.assign(new Error('room access revoked'), { status: 403 });
    if (path.endsWith('/messages')) { posts++; throw new TypeError('ack lost'); }
    if (path.includes('/message-commands/')) { reads++; return { clientMessageId: path.split('/').at(-1), status: 'deleted' }; }
    return undefined;
  }), undefined, session.csrfToken, session.accountPartition, memory);
  await controller.refresh(); const first = await controller.send(submission);
  if (first.accepted || !first.retryCommandId) throw new Error('missing command');
  denied = true; await controller.refresh(); assert.deepEqual(controller.getSnapshot().items, []);
  assert.equal(memory.recipients, null); assert.equal(memory.authority, null); assert.equal(memory.membershipScope, null); assert.equal(memory.hints.size, 0);
  assert.deepEqual(controller.getSnapshot().commands, [{ id: first.retryCommandId, canRetry: false }]);
  denied = false; await controller.refresh();
  assert.equal((await controller.send({ ...submission, retryCommandId: first.retryCommandId })).accepted, false);
  await controller.retry(first.retryCommandId); assert.equal(posts, 1);
  await controller.reconcile(first.retryCommandId); assert.equal(reads, 1);
  assert.deepEqual(controller.getSnapshot().commands, []); controller.dispose(); memory.clearAll();
});

void test('same-authority foreground snapshots preserve parked drafts and retry identity across controller remounts', async () => {
  const memory = new ChatMemory(); const cacheIds: string[] = []; let offline = false;
  const request = backend(async path => {
    if (offline) throw new TypeError('offline during resume');
    if (path.includes('/snapshot?')) cacheIds.push(new URL(path, 'https://example.test').searchParams.get('cacheId')!);
    if (path.endsWith('/messages')) throw new TypeError('ack lost');
    return undefined;
  });
  const controller = new ChatController(room.roomId, request, undefined, session.csrfToken, session.accountPartition, memory);
  await controller.refresh(); const result = await controller.send({ ...submission, quoteMessageId: source().id });
  if (result.accepted || !result.retryCommandId) throw new Error('missing command');
  const drafts = { [`private:${profiles[1]!.actorId}`]: { body: submission.body, quote: { messageId: source().id, authorName: '테스트 운영자', excerpt: '테스트 메시지' }, retryCommandId: result.retryCommandId } };
  controller.saveComposer(drafts, submission.target, controller.getSnapshot().epoch);
  const epoch = controller.getSnapshot().epoch;
  for (let i = 0; i < 3; i++) { await controller.refreshHints(); assert.equal(controller.getSnapshot().epoch, epoch); assert.deepEqual(controller.getComposer().drafts, drafts); }
  offline = true; await controller.refreshHints(); assert.equal(controller.getSnapshot().phase, 'error'); assert.deepEqual(controller.getComposer().drafts, drafts);
  offline = false;
  controller.dispose();
  const replacement = new ChatController(room.roomId, request, undefined, session.csrfToken, session.accountPartition, memory);
  await replacement.refresh();
  controller.saveComposer({}, null, epoch); // Disposed owner cannot overwrite the parked state.
  assert.deepEqual(replacement.getComposer().drafts, drafts);
  assert.deepEqual(replacement.getSnapshot().commands, [{ id: result.retryCommandId, canRetry: true }]);
  assert.equal(new Set(cacheIds).size, 5); replacement.dispose(); memory.clearAll();
});

void test('parked quote is freshly read when outside snapshot and confirmed missing source clears it', async () => {
  const memory = new ChatMemory(); let missing = false; let snapshots = 0; let reads = 0;
  const request = backend(async path => {
    if (path.includes('/snapshot?') && snapshots++ > 0) return { ...sync, messages: [], nextCursor: 'fresh', historyCursor: null };
    if (path.endsWith(`/messages/${source().id}`)) { reads++; if (missing) throw Object.assign(new Error('unreadable'), { status: 404 }); return source(); }
    return undefined;
  });
  const controller = new ChatController(room.roomId, request, undefined, session.csrfToken, session.accountPartition, memory);
  await controller.refresh();
  const drafts = { [`private:${profiles[1]!.actorId}`]: { body: '보관 초안', quote: { messageId: source().id, authorName: '테스트 운영자', excerpt: '테스트 메시지' } } };
  controller.saveComposer(drafts, submission.target, controller.getSnapshot().epoch);
  await controller.refreshHints(); assert.deepEqual(controller.getComposer().drafts, drafts); assert.equal(reads, 1);
  missing = true; await controller.refreshHints(); assert.deepEqual(controller.getComposer().drafts, {}); assert.equal(reads, 2);
  controller.dispose(); memory.clearAll();
});

void test('parked draft survives remount; access scrub, session replacement and room capacity clear private memory', async () => {
  forgetChatMemory();
  const memory = sessionChatMemory(session.accountPartition, session.csrfToken, room.roomId);
  const controller = new ChatController(room.roomId, backend(async path => { if (path.endsWith('/messages')) throw new TypeError('lost'); return undefined; }), undefined, session.csrfToken, session.accountPartition, memory);
  await controller.refresh(); await controller.send(submission);
  controller.saveComposer({ shared: { body: 'private-parked-text', quote: null } }, null, controller.getSnapshot().epoch);
  controller.dispose();
  assert.equal(memory.drafts.shared?.body, 'private-parked-text');
  assert.equal(memory.activate(), memory.lease);
  assert.equal(memory.drafts.shared?.body, 'private-parked-text');
  memory.scrubAccess();
  assert.deepEqual(memory.drafts, {}); assert.equal('payload' in memory.commands.pending()[0]!, false);
  assert.equal(memory.recipients, null); assert.equal(memory.authority, null); assert.equal(memory.membershipScope, null); assert.equal(memory.hints.size, 0);
  const successor = sessionChatMemory(session.accountPartition, 'new-session', room.roomId);
  assert.notEqual(successor, memory); assert.deepEqual(memory.commands.pending(), []);
  for (let i = 0; i < MAX_PARKED_ROOMS; i++) sessionChatMemory(session.accountPartition, 'new-session', `room-${i}`);
  assert.notEqual(sessionChatMemory(session.accountPartition, 'new-session', room.roomId), successor);
  forgetChatMemory();
});

void test('oversized composer state keeps the last saved draft and clears its warning after correction', async () => {
  const memory = new ChatMemory();
  const controller = new ChatController(room.roomId, backend(), undefined, session.csrfToken, session.accountPartition, memory);
  try {
    await controller.refresh();
    const saved = { shared: { body: '아직 작성 중', quote: null } };
    controller.saveComposer(saved, { scope: 'SHARED' }, controller.getSnapshot().epoch);
    const tooMany = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`private:${index}`, { body: '안녕하세요', quote: null }]));
    controller.saveComposer(tooMany, { scope: 'SHARED' }, controller.getSnapshot().epoch);
    assert.deepEqual(controller.getComposer().drafts, saved);
    assert.equal(controller.getSnapshot().notice, '작성 중인 메시지가 너무 길어요. 내용을 줄여 주세요.');
    controller.saveComposer(saved, { scope: 'SHARED' }, controller.getSnapshot().epoch);
    assert.equal(controller.getSnapshot().notice, null);
  } finally { controller.dispose(); memory.clearAll(); }
});

void test('only the allowlisted membership mismatch code quarantines replayable commands on 409', async () => {
  for (const code of ['MEMBERSHIP_SCOPE_MISMATCH', 'REQUEST_FAILED']) {
    const controller = new ChatController(room.roomId, backend(async path => { if (path.endsWith('/messages')) throw Object.assign(new Error('opaque'), { status: 409, code }); return undefined; }));
    await controller.refresh(); await controller.send(submission); await controller.refresh();
    assert.equal(controller.getSnapshot().commands[0]?.canRetry, code !== 'MEMBERSHIP_SCOPE_MISMATCH'); controller.dispose();
  }
});

void test('an in-flight SEND parks its identity before unmount, preventing a reminted composer retry', async () => {
  const memory = new ChatMemory(); let postedId = ''; let release!: (value: unknown) => void; let reached!: () => void;
  const waiting = new Promise<void>(resolve => { reached = resolve; });
  const request = backend(async (path, options) => {
    if (path.endsWith('/messages')) { postedId = (options?.body as { clientMessageId: string }).clientMessageId; reached(); return new Promise(resolve => { release = resolve; }); }
    return undefined;
  });
  const old = new ChatController(room.roomId, request, undefined, session.csrfToken, session.accountPartition, memory);
  await old.refresh();
  old.saveComposer({ [`private:${profiles[1]!.actorId}`]: { body: submission.body, quote: null } }, submission.target, old.getSnapshot().epoch);
  const pending = old.send(submission); await waiting; old.dispose();
  const next = new ChatController(room.roomId, backend(), undefined, session.csrfToken, session.accountPartition, memory);
  await next.refresh();
  assert.equal(next.getComposer().drafts[`private:${profiles[1]!.actorId}`]?.retryCommandId, postedId);
  release({ clientMessageId: postedId, status: 'committed', messageId: source().id, version: '1' });
  assert.equal((await pending).accepted, false); assert.equal(next.getSnapshot().commands.length, 1);
  next.dispose(); memory.clearAll();
});

for (const churn of ['manifest', 'profiles', 'events-reset'] as const) void test(`${churn} reset uses a fresh snapshot without losing same-authority draft or retry identity`, async () => {
  const memory = new ChatMemory(); let changed = false; const caches: string[] = [];
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path.endsWith('/messages')) throw new TypeError('ACK lost');
    if (path.includes('/snapshot?')) caches.push(new URL(path, 'https://example.test').searchParams.get('cacheId')!);
    if (!changed) return undefined;
    if (churn === 'manifest' && path.startsWith('/v1/sync?')) return { schemaVersion: 2, resetRequired: false, rooms: [room], generation: 'membership-2', nextCursor: null, complete: true };
    if (churn === 'profiles' && path.includes('/profile-sync?')) return { ...sync, profiles, generation: 'profiles-2', nextCursor: null, complete: true };
    if (churn === 'events-reset' && path.includes('/events?')) return { schemaVersion: 2, resetRequired: true, events: [], hasMore: false, nextCursor: null, membershipScope: null, authorizationRevision: null };
    return undefined;
  }), undefined, session.csrfToken, session.accountPartition, memory);
  await controller.refresh(); const result = await controller.send({ ...submission, quoteMessageId: source().id });
  if (result.accepted || !result.retryCommandId) throw new Error('missing command');
  const epoch = controller.getSnapshot().epoch;
  const drafts = { [`private:${profiles[1]!.actorId}`]: { body: submission.body, quote: { messageId: source().id, authorName: '테스트 운영자', excerpt: '테스트 메시지' }, retryCommandId: result.retryCommandId } };
  controller.saveComposer(drafts, submission.target, epoch); changed = true; await controller.refresh();
  assert.equal(controller.getSnapshot().phase, 'ready'); assert.equal(controller.getSnapshot().epoch, epoch);
  assert.deepEqual(controller.getComposer().drafts, drafts); assert.equal(new Set(caches).size, 2);
  assert.equal(controller.getSnapshot().commands[0]?.canRetry, true); controller.dispose(); memory.clearAll();
});

for (const action of ['react', 'remove'] as const) for (const status of [403, 404]) void test(`${action} ${status} preserves unrelated drafts until fresh room checks confirm loss and scrub`, async () => {
  const memory = new ChatMemory(); let roomLost = false;
  const controller = new ChatController(room.roomId, backend(async path => {
    if (roomLost && path.startsWith('/v1/sync?')) throw Object.assign(new Error('room denied'), { status: 403 });
    if (path.includes('/snapshot?')) return { ...sync, messages: [{ ...source(), allowedActions: { reply: true, publish: false, delete: true } }], nextCursor: 'events-1', historyCursor: null };
    if (path.endsWith('/reactions') || path.endsWith('/delete')) throw Object.assign(new Error('message denied'), { status });
    if (path.endsWith('/messages')) throw new TypeError('ACK lost');
    return undefined;
  }), undefined, session.csrfToken, session.accountPartition, memory);
  await controller.refresh(); await controller.send(submission);
  const drafts = { [`private:${profiles[1]!.actorId}`]: { body: 'unrelated private draft', quote: null } };
  controller.saveComposer(drafts, submission.target, controller.getSnapshot().epoch);
  await controller[action](source().id);
  assert.equal(controller.getSnapshot().phase, 'ready'); assert.deepEqual(controller.getComposer().drafts, drafts);
  assert.equal('payload' in memory.commands.pending()[0]!, true);
  roomLost = true; await controller[action](source().id);
  assert.equal(controller.getSnapshot().phase, 'error'); assert.deepEqual(memory.drafts, {});
  assert.equal('payload' in memory.commands.pending()[0]!, false);
  assert.equal(memory.authority, null); assert.equal(memory.recipients, null); assert.equal(memory.membershipScope, null); assert.equal(memory.hints.size, 0);
  controller.dispose(); memory.clearAll();
});

for (const inSnapshot of [true, false]) void test(`fresh quote body replaces parked excerpt from ${inSnapshot ? 'snapshot' : 'point read'}`, async () => {
  const memory = new ChatMemory(); let changed = false;
  const fresh = { ...source(), version: '2', content: { type: 'TEXT' as const, text: '[redacted by moderation]' } };
  const request = backend(async path => {
    if (changed && path.includes('/snapshot?')) return { ...sync, messages: inSnapshot ? [fresh] : [], nextCursor: 'fresh', historyCursor: null };
    if (changed && path.endsWith(`/messages/${source().id}`)) return fresh;
    return undefined;
  });
  const controller = new ChatController(room.roomId, request, undefined, session.csrfToken, session.accountPartition, memory);
  await controller.refresh(); controller.saveComposer({ shared: { body: 'keep draft', quote: { messageId: source().id, authorName: 'old name', excerpt: 'stale private excerpt' } } }, submission.target, controller.getSnapshot().epoch);
  controller.dispose(); changed = true;
  const replacement = new ChatController(room.roomId, request, undefined, session.csrfToken, session.accountPartition, memory); await replacement.refresh();
  assert.equal(replacement.getSnapshot().phase, 'ready'); assert.equal(replacement.getComposer().drafts.shared?.body, 'keep draft');
  assert.equal(replacement.getComposer().drafts.shared?.quote?.excerpt, '[redacted by moderation]');
  assert.equal(replacement.getComposer().drafts.shared?.quote?.authorName, '테스트 운영자'); replacement.dispose(); memory.clearAll();
});

for (const corruption of ['createdAt', 'version'] as const) void test(`off-snapshot quote evidence survives sync and rejects ${corruption} corruption after remount`, async () => {
  const memory = new ChatMemory(); const id = '00000000-0000-4000-8000-000000000007';
  const controller = new ChatController(room.roomId, backend(), undefined, session.csrfToken, session.accountPartition, memory);
  await controller.refresh();
  // A bounded parked quote may outlive the latest timeline page; preserve its prior evidence.
  memory.drafts = { shared: { body: 'private draft', quote: { messageId: id, authorName: 'name', excerpt: 'private quote' } } };
  memory.hints.set(id, { createdAt: '2026-08-01T00:00:00.000Z', version: '2', counterpart: source().counterpart, allowedActions: source().allowedActions });
  await controller.refresh(); assert.equal(memory.hints.get(id)?.version, '2'); controller.dispose();
  const replacement = new ChatController(room.roomId, backend(async path => {
    if (path.endsWith(`/messages/${id}`)) return { ...source(id, corruption === 'createdAt' ? '2020-01-01T00:00:00.000Z' : '2026-08-01T00:00:00.000Z'), version: corruption === 'version' ? '1' : '2' };
    return undefined;
  }), undefined, session.csrfToken, session.accountPartition, memory);
  await replacement.refresh(); assert.equal(replacement.getSnapshot().phase, 'error'); assert.deepEqual(replacement.getSnapshot().items, []);
  replacement.dispose(); memory.clearAll();
});

void test('revoking an earlier parked quote cannot erase integrity evidence for a later quote', async () => {
  const memory = new ChatMemory(); const second = '00000000-0000-4000-8000-000000000007';
  memory.drafts = { shared: { body: 'first', quote: { messageId: source().id, authorName: 'name', excerpt: 'first quote' } }, private: { body: 'second', quote: { messageId: second, authorName: 'name', excerpt: 'second quote' } } };
  memory.hints.set(second, { createdAt: '2026-08-01T00:00:00.000Z', version: '2', counterpart: source().counterpart, allowedActions: source().allowedActions });
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path.includes('/snapshot?')) return { ...sync, messages: [{ ...source(), allowedActions: { reply: false, publish: false, delete: false } }], nextCursor: 'new', historyCursor: null };
    if (path.endsWith(`/messages/${second}`)) return { ...source(second, '2020-01-01T00:00:00.000Z'), version: '2' };
    return undefined;
  }), undefined, session.csrfToken, session.accountPartition, memory);
  await controller.refresh(); assert.equal(controller.getSnapshot().phase, 'error'); assert.deepEqual(controller.getSnapshot().items, []);
  controller.dispose(); memory.clearAll();
});

void test('reaction denial during a held SEND freshly authorizes and scrubs confirmed room loss before SEND settles', async () => {
  const memory = new ChatMemory(); let roomLost = false; let release!: () => void; let reached!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { reached = resolve; });
  const controller = new ChatController(room.roomId, backend(async path => {
    if (roomLost && path.startsWith('/v1/sync?')) throw Object.assign(new Error('room denied'), { status: 403 });
    if (path.endsWith('/reactions')) throw Object.assign(new Error('message denied'), { status: 403 });
    if (path.endsWith('/messages')) { reached(); await held; throw new TypeError('ACK lost'); }
    return undefined;
  }), undefined, session.csrfToken, session.accountPartition, memory);
  await controller.refresh(); controller.saveComposer({ shared: { body: 'private draft', quote: null } }, submission.target, controller.getSnapshot().epoch);
  const sending = controller.send(submission); await started; roomLost = true; await controller.react(source().id);
  assert.deepEqual(memory.drafts, {}); assert.equal(memory.authority, null); assert.equal(memory.recipients, null); assert.equal(memory.hints.size, 0);
  assert.equal('payload' in memory.commands.pending()[0]!, false); assert.equal(controller.getSnapshot().phase, 'error');
  release(); await sending; assert.equal(controller.getSnapshot().phase, 'error'); assert.deepEqual(controller.getSnapshot().items, []);
  controller.dispose(); memory.clearAll();
});

for (const pathKind of ['events', 'history'] as const) void test(`live ${pathKind} redaction refreshes quoted excerpts and fences stale composer writers without losing draft intent`, async () => {
  const memory = new ChatMemory(); let redacted = false;
  const fresh = { ...source(), version: '2', content: { type: 'TEXT' as const, text: '[current authorized text]' } };
  const controller = new ChatController(room.roomId, backend(async path => {
    if (redacted && path.includes('/events?')) return { ...sync, events: [{ type: 'message.upsert', message: fresh }], nextCursor: 'after-redaction', hasMore: false };
    if (redacted && path.includes('/history?')) return { ...sync, messages: [fresh], nextCursor: null };
    return undefined;
  }), undefined, session.csrfToken, session.accountPartition, memory);
  await controller.refresh(); const epoch = controller.getSnapshot().epoch;
  const drafts = { shared: { body: 'keep draft', quote: { messageId: source().id, authorName: '테스트 운영자', excerpt: '테스트 메시지' }, retryCommandId: '00000000-0000-4000-8000-000000000099' } };
  controller.saveComposer(drafts, submission.target, epoch); redacted = true;
  if (pathKind === 'events') await controller.refresh(); else await controller.loadOlder();
  assert.equal(controller.getComposer().drafts.shared?.quote?.excerpt, '[current authorized text]');
  assert.equal(controller.getComposer().drafts.shared?.body, 'keep draft'); assert.equal(controller.getComposer().drafts.shared?.retryCommandId, drafts.shared.retryCommandId);
  assert.ok(controller.getSnapshot().epoch > epoch); controller.saveComposer(drafts, submission.target, epoch);
  assert.equal(controller.getComposer().drafts.shared?.quote?.excerpt, '[current authorized text]'); controller.dispose(); memory.clearAll();
});

void test('ROOM_OWNER send and retry preserve an actor-free command under fresh FAN authority', async () => {
  let role = 'FAN'; let posts = 0; const bodies: Record<string, unknown>[] = [];
  const controller = new ChatController(room.roomId, backend(async (path, options) => {
    if (path.startsWith('/v1/sync?')) return { schemaVersion: 2, resetRequired: false, rooms: [{ ...room, role }], generation: 'membership-1', nextCursor: null, complete: true };
    if (path.includes('/private-recipients')) return { recipients: [], next: null };
    if (path.endsWith('/messages')) {
      const body = options?.body as Record<string, unknown>; bodies.push(body); posts++;
      if (posts === 1) throw new TypeError('uncertain transport');
      return { clientMessageId: body.clientMessageId, messageId: source().id, status: 'committed', version: '1' };
    }
    return undefined;
  }));
  try {
    await controller.refresh();
    const result = await controller.send({ target: { scope: 'ROOM_OWNER' }, body: '방장 수신함' });
    assert.equal(result.accepted, false); assert.ok(result.retryCommandId);
    assert.equal(bodies[0]?.intent, 'ROOM_OWNER'); assert.equal('recipientActorId' in bodies[0]!, false);
    await controller.refresh(); await controller.retry(result.retryCommandId!);
    assert.equal(posts, 2); assert.deepEqual(bodies[1], bodies[0]);
    assert.equal((await controller.send({ target: { scope: 'ROOM_OWNER' }, body: '인용 주입', quoteMessageId: source().id })).accepted, false);
    assert.equal((await controller.send({ target: { scope: 'SHARED' }, body: '전체 채팅' })).accepted, true);
    role = 'STREAMER'; await controller.refreshHints();
    assert.equal((await controller.send({ target: { scope: 'ROOM_OWNER' }, body: '역할 변경' })).accepted, false);
    assert.equal(posts, 3);
  } finally { controller.dispose(); }
});
