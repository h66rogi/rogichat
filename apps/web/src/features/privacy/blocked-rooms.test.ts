import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PrivacyClient } from './client';
import { blockedRoomPage, BlockedRoomsFlow, type BlockedRoomsState } from './blocked-rooms';
const origin = 'https://api.qa.rogi.chat';
const roomId = '11111111-1111-4111-8111-111111111111';
const session = { authenticated: true as const, soopLinkStatus: 'VERIFIED' as const, csrfToken: 'A'.repeat(43), accountPartition: 'B'.repeat(42) + 'A' };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

void test('blocked room DTO accepts nullable current labels and rejects additional private fields', () => {
  for (const displayName of ['현재 방 이름', null]) {
    assert.deepEqual(blockedRoomPage({ rooms: [{ roomId, displayName }], nextCursor: null }).rooms, [{ roomId, displayName }]);
    assert.throws(() => blockedRoomPage({ rooms: [{ roomId, displayName, ownerId: roomId }], nextCursor: null }));
  }
  assert.throws(() => blockedRoomPage({ rooms: [{ roomId }], nextCursor: null }));
  assert.throws(() => blockedRoomPage({ rooms: [], nextCursor: '' }));
  assert.equal(blockedRoomPage({ rooms: [], nextCursor: 'a'.repeat(2200) }).nextCursor?.length, 2200);
  assert.throws(() => blockedRoomPage({ rooms: [], nextCursor: 'a'.repeat(2201) }));
  assert.throws(() => blockedRoomPage({ rooms: Array(51).fill({ roomId, displayName: null }), nextCursor: null }));
});
void test('empty scanned pages with a next cursor continue without inventing empty completion', async () => {
  const paths: string[] = [], states: BlockedRoomsState[] = [];
  const client = new PrivacyClient(origin, async input => {
    const path = String(input).slice(origin.length);
    if (path.endsWith('/session')) return response(session);
    paths.push(path);
    if (paths.length < 3) return response({ rooms: [], nextCursor: `opaque-${paths.length}` });
    return response({ rooms: [{ roomId, displayName: null }], nextCursor: null });
  });
  const flow = new BlockedRoomsFlow(client, session, state => states.push(state)); await flow.load(); flow.dispose();
  assert.deepEqual(paths, ['/v1/blocked-rooms', '/v1/blocked-rooms?cursor=opaque-1', '/v1/blocked-rooms?cursor=opaque-2']);
  assert.equal(states.at(-1)?.phase, 'ready'); assert.deepEqual(states.at(-1)?.rooms, [{ roomId, displayName: null }]);
  assert.equal(states.filter(state => state.phase === 'ready').length, 1);
});
void test('expired opaque cursor restarts from the server root once and drops earlier labels', async () => {
  const paths: string[] = [], states: BlockedRoomsState[] = [];
  const client = new PrivacyClient(origin, async input => {
    const path = String(input).slice(origin.length); if (path.endsWith('/session')) return response(session); paths.push(path);
    return path.includes('?') ? response({ error: { code: 'INVALID_CURSOR' } }, 400) : response({ rooms: [{ roomId, displayName: '새 표시 이름' }], nextCursor: null });
  });
  const flow = new BlockedRoomsFlow(client, session, state => states.push(state)); await flow.load('opaque/expired'); flow.dispose();
  assert.deepEqual(paths, ['/v1/blocked-rooms?cursor=opaque%2Fexpired', '/v1/blocked-rooms']);
  assert.equal(states.at(-1)?.restarted, true); assert.equal(states.at(-1)?.rooms[0]?.displayName, '새 표시 이름');
});
void test('postresponse session switch never exposes the prior account room label', async () => {
  let changed = false; const states: BlockedRoomsState[] = [];
  const client = new PrivacyClient(origin, async input => {
    if (String(input).endsWith('/session')) return response(changed ? { ...session, accountPartition: 'C'.repeat(42) + 'A' } : session);
    changed = true; return response({ rooms: [{ roomId, displayName: '이전 계정 이름' }], nextCursor: null });
  });
  const flow = new BlockedRoomsFlow(client, session, state => states.push(state)); await flow.load(); flow.dispose();
  assert.equal(states.at(-1)?.phase, 'error'); assert.ok(states.every(state => state.rooms.length === 0));
});
void test('failed reload clears previous room names and retry starts without cached cursor', async () => {
  let failed = false; const states: BlockedRoomsState[] = [];
  const client = new PrivacyClient(origin, async input => String(input).endsWith('/session') ? response(session) : failed ? response({}, 503) : response({ rooms: [{ roomId, displayName: '현재 방' }], nextCursor: null }));
  const flow = new BlockedRoomsFlow(client, session, state => states.push(state)); await flow.load(); failed = true;
  const retry = flow.load(); assert.deepEqual(states.at(-1)?.rooms, []); await retry;
  assert.equal(states.at(-1)?.phase, 'error'); assert.deepEqual(states.at(-1)?.rooms, []); flow.dispose();
});
void test('repeated empty cursor cannot loop or show an invented room', async () => {
  let calls = 0; const states: BlockedRoomsState[] = [];
  const client = new PrivacyClient(origin, async input => { if (String(input).endsWith('/session')) return response(session); calls++; return response({ rooms: [], nextCursor: 'same' }); });
  const flow = new BlockedRoomsFlow(client, session, state => states.push(state)); await flow.load(); flow.dispose();
  assert.equal(calls, 2); assert.equal(states.at(-1)?.phase, 'error'); assert.deepEqual(states.at(-1)?.rooms, []);
});

void test('actual block client accepts a full page of 50 current unicode labels within its bounded response', async () => {
  const blocks = Array.from({ length: 50 }, (_, index) => ({ actorId: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`, blockedAt: '2026-09-20T00:00:00.000Z', displayName: '가😀'.repeat(20) }));
  const body = { blocks, next: blocks.at(-1)!.actorId };
  assert.ok(new TextEncoder().encode(JSON.stringify(body)).byteLength > 8192);
  const client = new PrivacyClient(origin, async () => response(body));
  assert.deepEqual(await client.blocks(roomId, null, new AbortController().signal), body);
});
void test('block client rejects response bytes above 32768 including streamed bodies without a declared length', async () => {
  const body = { blocks: [{ actorId: roomId, blockedAt: '2026-09-20T00:00:00.000Z', displayName: '가'.repeat(11000) }], next: null };
  const client = new PrivacyClient(origin, async () => response(body));
  await assert.rejects(client.blocks(roomId, null, new AbortController().signal), { code: 'INVALID_RESPONSE' });
});
