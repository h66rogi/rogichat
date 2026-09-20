import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReferenceRoomCache, ReferenceManifest, syncPolicy } from '../../../../packages/contracts/sync-client.mjs';

const envelope = { schemaVersion: 2, resetRequired: false, membershipScope: 'A'.repeat(43), authorizationRevision: 'E'.repeat(42) + 'A' };
const message = (id, version, text = 'fixture') => ({ id, version, createdAt: '2026-09-20T00:00:00.000Z', content: { type: 'TEXT', text } });
test('client data/cursor atomicity, replay idempotence and late history cannot revive a tombstone', () => {
  const cache = new ReferenceRoomCache('first');
  cache.snapshot('first', { ...envelope, messages: [message('a', '1')], nextCursor: 'one' });
  const delta = { ...envelope, events: [{ type: 'message.deleted', messageId: 'a', version: '2' }], nextCursor: 'two' };
  assert.throws(() => cache.delta('first', 'one', delta, () => { throw new Error('crash'); }));
  assert.equal(cache.state.cursor, 'one'); assert.equal(cache.visible().length, 1);
  cache.delta('first', 'one', delta);
  assert.equal(cache.delta('first', 'one', { ...envelope, events: [], nextCursor: 'stale' }), false);
  cache.history('first', { ...envelope, messages: [message('a', '1'), message('a', '2')] });
  assert.deepEqual(cache.visible(), []); assert.equal(cache.state.cursor, 'two');
  cache.reset('new-account');
  assert.equal(cache.delta('first', null, { ...envelope, events: [{ type: 'message.upsert', message: message('a', '3') }], nextCursor: 'late' }), false);
  assert.deepEqual(cache.visible(), []);
});
test('manifest only replaces on a complete stable generation and omitted birthday disappears', () => {
  const profiles = new ReferenceManifest('account-cache');
  profiles.page('account-cache', { ...envelope, generation: 'old', complete: true, profiles: [{ actorId: 'a', birthday: { month: 2, day: 29 } }, { actorId: 'b' }] }, 'profiles');
  assert.equal(profiles.page('account-cache', { ...envelope, generation: 'next', complete: false, profiles: [{ actorId: 'a' }] }, 'profiles'), false);
  assert.equal(profiles.current.size, 2);
  assert.equal(profiles.page('account-cache', { schemaVersion: 2, resetRequired: true }, 'profiles'), false);
  profiles.page('account-cache', { ...envelope, generation: 'new', complete: true, profiles: [{ actorId: 'a' }] }, 'profiles');
  assert.equal(profiles.current.size, 1); assert.equal('birthday' in profiles.current.get('a'), false);
  profiles.clear('new-account-cache'); assert.equal(profiles.current.size, 0);
  assert.equal(profiles.page('account-cache', { ...envelope, generation: 'old-account', complete: true, profiles: [{ actorId: 'a', birthday: { month: 2, day: 29 } }] }, 'profiles'), false);
  assert.equal(profiles.current.size, 0);
  assert.ok(syncPolicy.triggers.includes('reconnect')); assert.equal(syncPolicy.foregroundMs, 15000);
});


test('schema2 binding rejects late old scopes and sorts sparse loaded set without changing immutable keys', () => {
  const cache = new ReferenceRoomCache('scope-cache');
  assert.equal(cache.snapshot('scope-cache', { ...envelope, messages: [message('b', '9007199254740993'), message('a', '1')], nextCursor: 'one' }), true);
  assert.deepEqual(cache.visible().map(m => m.id), ['a', 'b']);
  assert.equal(cache.history('scope-cache', { ...envelope, membershipScope: 'B'.repeat(42) + 'A', messages: [message('c', '1')] }), false);
  assert.equal(cache.delta('scope-cache', 'one', { ...envelope, authorizationRevision: 'C'.repeat(42) + 'A', events: [], nextCursor: 'two' }), false);
  assert.throws(() => cache.history('scope-cache', { ...envelope, messages: [{ ...message('a', '2'), createdAt: '2026-09-20T00:00:00.001Z' }] }), /immutable_display_key/);
  assert.equal(cache.state.cursor, 'one');
  cache.delta('scope-cache', 'one', { ...envelope, events: [{ type: 'message.deleted', messageId: 'b', version: '18446744073709551615' }], nextCursor: 'two' });
  cache.history('scope-cache', { ...envelope, messages: [message('b', '18446744073709551615')] });
  assert.deepEqual(cache.visible().map(m => m.id), ['a']);
});

test('A0 to A1 to A0 authority ABA cannot merge an old response after cache generation changes', () => {
  const cache = new ReferenceRoomCache('generation-0');
  const oldResponse = { ...envelope, messages: [message('old', '1')], nextCursor: 'old-cursor' };
  cache.snapshot('generation-0', oldResponse);
  cache.reset('generation-1');
  cache.snapshot('generation-1', { ...envelope, authorizationRevision: 'B'.repeat(42) + 'A', messages: [], nextCursor: 'middle' });
  cache.reset('generation-2');
  cache.snapshot('generation-2', { ...envelope, messages: [message('new', '1')], nextCursor: 'current' });
  assert.equal(cache.history('generation-0', oldResponse), false);
  assert.equal(cache.delta('generation-0', 'old-cursor', { ...envelope, events: [{ type: 'message.upsert', message: message('late', '2') }], nextCursor: 'late' }), false);
  assert.equal(cache.state.cursor, 'current'); assert.deepEqual(cache.visible().map(m => m.id), ['new']);
});
