import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChatController } from './chat-controller';
import { mergeMessages, message, projectMessages } from './contract';
import type { ChatRequest, ServerMessage } from './contract';

const room = { roomId: 'room-test', name: '테스트 채널', actorId: 'fan-test', mode: 'FAN', role: 'FAN' };
const profiles = [{ actorId: 'fan-test', nickname: '테스트 팬', role: 'FAN', avatar: null }, { actorId: 'streamer-test', nickname: '테스트 운영자', role: 'STREAMER', avatar: null }];
const source = (id = 'message-test', date = '2026-09-01T00:00:00.000Z'): ServerMessage => ({ id, version: '1', createdAt: date, audience: 'PRIVATE', author: { kind: 'member', actorId: 'streamer-test', nickname: '테스트 운영자' }, content: { type: 'TEXT', text: '테스트 메시지' }, quote: null });
const submission = { target: { scope: 'PRIVATE' as const, recipient: { actorId: 'streamer-test', displayName: '테스트 운영자', avatarUrl: null, role: 'STREAMER' as const } }, body: '테스트 전송' };
function backend(override?: ChatRequest): ChatRequest {
  return async (path, options) => {
    if (override) { const result = await override(path, options); if (result !== undefined) return result; }
    const data = { schemaVersion: 1, resetRequired: false };
    if (path.startsWith('/v1/sync?')) return { ...data, rooms: [room], generation: 'membership-1', nextCursor: null, complete: true };
    if (path.includes('/private-recipients')) return { recipients: [profiles[1]], next: null };
    if (path.includes('/profile-sync?')) return { ...data, profiles, generation: 'profiles-1', nextCursor: null, complete: true };
    if (path.includes('/snapshot?')) return { ...data, messages: [source()], nextCursor: 'events-1', historyCursor: 'history-1' };
    if (path.includes('/events?')) return { ...data, events: [], nextCursor: 'events-2', hasMore: false };
    if (path.includes('/history?')) return { ...data, messages: [source('older-test', '2026-08-01T00:00:00.000Z')], nextCursor: null };
    throw new Error('Unexpected request');
  };
}
void test('actual DTO mapping does not guess private recipient, quote author, avatar or read status', () => {
  const dto = message({ ...source(), quote: { id: 'quote-test', content: { type: 'TEXT', text: '인용' } } });
  const item = projectMessages([dto], 'fan-test', [])[0]!;
  assert.equal(item.kind, 'message'); if (item.kind !== 'message') return;
  assert.equal(item.recipient, undefined); assert.equal(item.author.role, undefined);
  assert.equal(item.author.avatarUrl, null); assert.equal(item.quote?.authorName, '인용 메시지'); assert.equal(item.status, 'saved');
  const publication = projectMessages([{ ...source(), audience: 'SHARED', author: { kind: 'anonymous' } }], 'fan-test', [])[0]!;
  assert.equal(publication.kind, 'publication'); assert.equal('author' in publication, false); assert.equal('quote' in publication, false);
});
void test('ambiguous send and invalid ACK retain identical retry ID until matching persisted ACK', async () => {
  const ids: string[] = [];
  const controller = new ChatController(room.roomId, backend(async (path, options) => {
    if (!path.endsWith('/messages')) return undefined;
    const body = options?.body as { clientMessageId: string }; ids.push(body.clientMessageId);
    if (ids.length === 1) throw new TypeError('network lost');
    return { clientMessageId: ids.length === 2 ? 'wrong-id' : body.clientMessageId, messageId: 'saved-test', status: 'committed', version: '1' };
  }));
  await controller.refresh();
  assert.equal((await controller.send(submission)).accepted, false);
  assert.equal(controller.getSnapshot().items.length, 1);
  assert.equal((await controller.send(submission)).accepted, false);
  assert.equal((await controller.send(submission)).accepted, true);
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
void test('cursor reset drops old epoch before re-snapshot and replaces private content', async () => {
  let snapshots = 0; let reset = false; let observedEmpty = false;
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path.includes('/snapshot?')) return { schemaVersion: 1, resetRequired: false, messages: ++snapshots === 1 ? [source()] : [], nextCursor: 'fresh', historyCursor: null };
    if (path.includes('/events?') && reset) return { schemaVersion: 1, resetRequired: true };
    return undefined;
  }));
  await controller.refresh(); const epoch = controller.getSnapshot().epoch;
  controller.subscribe(() => { if (controller.getSnapshot().epoch > epoch && controller.getSnapshot().items.length === 0) observedEmpty = true; });
  reset = true; await controller.refresh();
  assert.equal(observedEmpty, true); assert.equal(controller.getSnapshot().phase, 'ready'); assert.deepEqual(controller.getSnapshot().items, []); controller.dispose();
});
void test('late snapshot after disposal cannot repopulate a previous session or room', async () => {
  let release!: (value: unknown) => void;
  let reached!: () => void; const pending = new Promise<void>(resolve => { reached = resolve; });
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path.includes('/snapshot?')) { reached(); return new Promise(resolve => { release = resolve; }); }
    return undefined;
  }));
  const work = controller.refresh(); await pending; controller.dispose();
  release({ schemaVersion: 1, resetRequired: false, messages: [source()], nextCursor: 'stale', historyCursor: null });
  await work; assert.deepEqual(controller.getSnapshot().items, []);
});
void test('reconnect refresh resumes cursor, applies deletion, and history remains chronological', async () => {
  const paths: string[] = []; let remove = false;
  const controller = new ChatController(room.roomId, backend(async path => {
    paths.push(path);
    if (path.includes('/events?') && remove) return { schemaVersion: 1, resetRequired: false, events: [{ type: 'message.deleted', messageId: 'message-test', version: '2' }], nextCursor: 'after-delete', hasMore: false };
    return undefined;
  }));
  await controller.refresh(); await controller.loadOlder();
  assert.deepEqual(controller.getSnapshot().items.map(item => item.id), ['older-test', 'message-test']);
  remove = true; await controller.refresh();
  assert.ok(paths.some(path => path.includes('cursor=events-1'))); assert.deepEqual(controller.getSnapshot().items.map(item => item.id), ['older-test']); controller.dispose();
});
void test('upserts retain chronological position and older versions cannot overwrite newer content', () => {
  const early = source('early'); const later = source('later', '2026-09-02T00:00:00.000Z');
  const changed = { ...early, version: '3', content: { type: 'TEXT', text: '수정됨' } };
  const result = mergeMessages([early, later], [changed, { ...early, version: '2' }]);
  assert.deepEqual(result.map(item => item.id), ['early', 'later']); assert.equal(result[0]?.content.text, '수정됨');
});

void test('uncertain send ID survives transient sync failure and profile generation reset', async () => {
  let offline = false; let generation = 'profiles-1'; const ids: string[] = [];
  const controller = new ChatController(room.roomId, backend(async (path, options) => {
    if (offline) throw new TypeError('offline');
    if (path.includes('/profile-sync?')) return { schemaVersion: 1, resetRequired: false, profiles, generation, nextCursor: null, complete: true };
    if (path.endsWith('/messages')) { ids.push((options?.body as { clientMessageId: string }).clientMessageId); throw new TypeError('ack lost'); }
    return undefined;
  }));
  await controller.refresh(); await controller.send(submission);
  offline = true; await controller.refresh(); assert.deepEqual(controller.getSnapshot().items, []);
  offline = false; await controller.refresh(); await controller.send(submission);
  generation = 'profiles-2'; await controller.refresh(); await controller.send(submission);
  assert.equal(ids.length, 3); assert.equal(new Set(ids).size, 1); controller.dispose();
});
void test('unloaded historical delta upsert reloads authoritative creation ordering without changing draft epoch', async () => {
  let snapshots = 0;
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path.includes('/snapshot?')) return { schemaVersion: 1, resetRequired: false, messages: ++snapshots === 1 ? [source('recent')] : [source('past'), source('recent')], nextCursor: 'new-cursor', historyCursor: null };
    if (path.includes('/events?')) return { schemaVersion: 1, resetRequired: false, events: [{ type: 'message.upsert', message: source('past') }], nextCursor: 'event-cursor', hasMore: false };
    return undefined;
  }));
  await controller.refresh(); const epoch = controller.getSnapshot().epoch;
  await controller.refresh();
  assert.equal(snapshots, 2); assert.equal(controller.getSnapshot().epoch, epoch);
  assert.deepEqual(controller.getSnapshot().items.map(item => item.id), ['past', 'recent']); controller.dispose();
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
  assert.equal((await controller.send(submission)).accepted, false); assert.equal(posts, 0); controller.dispose();
});
void test('changed cookie session cannot publish another account into the original scope', async () => {
  let session = 'session-a'; let invalidations = 0;
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path === '/v1/auth/session') return { authenticated: true, soopLinkStatus: 'VERIFIED', csrfToken: session };
    return undefined;
  }), () => { invalidations++; }, session);
  await controller.refresh(); assert.equal(controller.getSnapshot().items.length, 1);
  session = 'session-b'; await controller.refresh();
  assert.equal(invalidations, 1); assert.deepEqual(controller.getSnapshot().items, []); assert.equal(controller.getSnapshot().room, null); controller.dispose();
});

void test('shared send follows manifest role, omits recipient field, and never quotes private content into shared', async () => {
  const bodies: Record<string, unknown>[] = [];
  const controller = new ChatController(room.roomId, backend(async (path, options) => {
    if (path.startsWith('/v1/sync?')) return { schemaVersion: 1, resetRequired: false, rooms: [{ ...room, actorId: 'streamer-test', role: 'STREAMER' }], generation: 'owner-membership', nextCursor: null, complete: true };
    if (path.includes('/private-recipients')) return { recipients: [profiles[0]], next: null };
    if (path.endsWith('/messages')) {
      const body = options?.body as Record<string, unknown>; bodies.push(body);
      return { clientMessageId: body.clientMessageId, messageId: 'shared-test', status: 'committed', version: '1' };
    }
    return undefined;
  }));
  await controller.refresh();
  assert.equal((await controller.send({ target: { scope: 'SHARED' }, body: '공개', quoteMessageId: 'message-test' })).accepted, false);
  assert.equal(bodies.length, 0);
  assert.equal((await controller.send({ target: { scope: 'SHARED' }, body: '공개' })).accepted, true);
  assert.equal(bodies[0]?.intent, 'SHARED'); assert.equal('recipientActorId' in bodies[0]!, false);
  controller.dispose();
  const fan = new ChatController(room.roomId, backend()); await fan.refresh();
  assert.equal((await fan.send({ target: { scope: 'SHARED' }, body: '공개' })).accepted, false); fan.dispose();
});

void test('deletion refuses another author, retries same resource, and hides all derived text only after blocked ACK', async () => {
  const own = { ...source('own-test'), author: { kind: 'member' as const, actorId: 'fan-test', nickname: '테스트 팬' } };
  let blocked = false; let deleteCalls = 0; let observedCleared = false;
  const paths: string[] = [];
  const controller = new ChatController(room.roomId, backend(async (path, options) => {
    if (path.includes('/snapshot?')) return { schemaVersion: 1, resetRequired: false, messages: blocked ? [] : [source(), own], nextCursor: 'events', historyCursor: null };
    if (path.endsWith('/delete')) {
      deleteCalls++; paths.push(path); assert.deepEqual(options?.body, {}); assert.equal(options?.method, 'POST');
      if (deleteCalls === 1) throw new TypeError('lost response');
      blocked = true; return { requestId: 'request-test', status: 'blocked' };
    }
    return undefined;
  }));
  await controller.refresh();
  assert.equal((await controller.remove('message-test')).accepted, false); assert.equal(deleteCalls, 0);
  assert.equal((await controller.remove('own-test')).accepted, false); assert.equal(controller.getSnapshot().items.length, 2);
  controller.subscribe(() => { if (controller.getSnapshot().phase === 'loading' && controller.getSnapshot().items.length === 0) observedCleared = true; });
  assert.equal((await controller.remove('own-test')).accepted, true);
  assert.equal(paths[0], paths[1]); assert.equal(observedCleared, true);
  assert.deepEqual(controller.getSnapshot().items, []); assert.match(controller.getSnapshot().notice!, /차단/); controller.dispose();
});
void test('unrecognized deletion acknowledgement never hides data or claims completion', async () => {
  const own = { ...source(), author: { kind: 'member' as const, actorId: 'fan-test', nickname: '테스트 팬' } };
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path.includes('/snapshot?')) return { schemaVersion: 1, resetRequired: false, messages: [own], nextCursor: 'events', historyCursor: null };
    if (path.endsWith('/delete')) return { requestId: 'request-test', status: 'purged' };
    return undefined;
  }));
  await controller.refresh(); assert.equal((await controller.remove(own.id)).accepted, false);
  assert.equal(controller.getSnapshot().items.length, 1); controller.dispose();
});
void test('delete ACK aborts an older in-flight sync so stale private content cannot return', async () => {
  const own = { ...source(), author: { kind: 'member' as const, actorId: 'fan-test', nickname: '테스트 팬' } };
  let blocked = false; let release!: (value: unknown) => void; let reached!: () => void;
  const waiting = new Promise<void>(resolve => { reached = resolve; });
  const controller = new ChatController(room.roomId, backend(async path => {
    if (path.includes('/snapshot?')) return { schemaVersion: 1, resetRequired: false, messages: blocked ? [] : [own], nextCursor: 'events', historyCursor: null };
    if (path.includes('/events?')) { reached(); return new Promise(resolve => { release = resolve; }); }
    if (path.endsWith('/delete')) { blocked = true; return { requestId: 'request-test', status: 'blocked' }; }
    return undefined;
  }));
  await controller.refresh(); const sync = controller.refresh(); await waiting;
  const removal = controller.remove(own.id);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(controller.getSnapshot().items, []);
  release({ schemaVersion: 1, resetRequired: false, events: [{ type: 'message.upsert', message: own }], hasMore: false, nextCursor: 'stale' });
  await sync; assert.equal((await removal).accepted, true); assert.deepEqual(controller.getSnapshot().items, []); controller.dispose();
});


void test('delete 403/404 immediately hide prior private data and revalidate without global logout', async () => {
  for (const status of [403, 404]) {
    const own = { ...source(), author: { kind: 'member' as const, actorId: 'fan-test', nickname: '테스트 팬' } };
    let denied = false; let invalidations = 0; let manifests = 0;
    const controller = new ChatController(room.roomId, backend(async path => {
      if (path.startsWith('/v1/sync?')) manifests++;
      if (path.includes('/snapshot?')) return { schemaVersion: 1, resetRequired: false, messages: denied ? [] : [own], nextCursor: 'events', historyCursor: null };
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
