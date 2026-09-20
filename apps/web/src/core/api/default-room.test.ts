import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDefaultRoom } from './default-room';
const first = { roomId: '11111111-1111-4111-8111-111111111111', name: '후로기', mode: 'FAN', joined: false };
const actual = { ...first, roomId: '22222222-2222-4222-8222-222222222222', isDefault: true, availability: 'OWNER_PENDING' };
void test('only explicit configured ID or unique server marker selects a default room', async () => {
  assert.equal(await resolveDefaultRoom(async () => ({ rooms: [first], next: null }), null), null);
  assert.deepEqual(await resolveDefaultRoom(async () => ({ rooms: [first, actual], next: null }), null), actual);
  assert.deepEqual(await resolveDefaultRoom(async () => ({ rooms: [first, actual], next: null }), first.roomId), first);
  assert.equal(await resolveDefaultRoom(async () => ({ rooms: [], next: null }), first.roomId), null);
});
void test('ambiguous markers, repeated cursor and invalid availability fail closed', async () => {
  await assert.rejects(resolveDefaultRoom(async () => ({ rooms: [{ ...first, isDefault: true }, actual], next: null }), null));
  await assert.rejects(resolveDefaultRoom(async () => ({ rooms: [], next: 'repeat' }), null));
  await assert.rejects(resolveDefaultRoom(async () => ({ rooms: [{ ...actual, availability: 'invented' }], next: null }), null));
  let calls = 0;
  assert.deepEqual(await resolveDefaultRoom(async () => ++calls === 1 ? { rooms: [first], next: 'next-page' } : { rooms: [actual], next: null }, null), actual);
  assert.equal(calls, 2);
});
