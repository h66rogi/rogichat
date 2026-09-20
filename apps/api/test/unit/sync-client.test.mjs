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

test('tombstones are terminal for every live version while newer tombstones and checkpoints advance', () => {
  const cache = new ReferenceRoomCache('terminal');
  cache.snapshot('terminal', { ...envelope, messages: [message('a', '1')], nextCursor: 'one' });
  cache.delta('terminal', 'one', { ...envelope, events: [{ type: 'message.deleted', messageId: 'a', version: '2' }], nextCursor: 'two' });
  const tombstone = structuredClone(cache.state.messages.get('a'));
  for (const version of ['1', '2', '3', '9007199254740993', '18446744073709551615']) {
    assert.equal(cache.history('terminal', { ...envelope, messages: [message('a', version)] }), true);
    assert.equal(cache.delta('terminal', cache.state.cursor, { ...envelope, events: [{ type: 'message.upsert', message: message('a', version) }], nextCursor: `ignored-${version}` }), true);
    assert.deepEqual(cache.state.messages.get('a'), tombstone);
    assert.deepEqual(cache.visible(), []); assert.equal(cache.state.cursor, `ignored-${version}`);
  }
  cache.delta('terminal', cache.state.cursor, { ...envelope, events: [{ type: 'message.deleted', messageId: 'a', version: '9007199254740993' }], nextCursor: 'newer-deletion' });
  assert.deepEqual(cache.state.messages.get('a'), { ...tombstone, version: '9007199254740993' });
  cache.delta('terminal', 'newer-deletion', { ...envelope, events: [{ type: 'message.deleted', messageId: 'a', version: '2' }], nextCursor: 'older-deletion' });
  assert.equal(cache.state.messages.get('a').version, '9007199254740993');
  const state = structuredClone(cache.state);
  assert.throws(() => cache.delta('terminal', 'older-deletion', { ...envelope, events: [{ type: 'message.upsert', message: { ...message('a', '18446744073709551615'), createdAt: '2026-09-20T00:00:00.001Z' } }], nextCursor: 'invalid-key' }), /immutable_display_key/);
  assert.deepEqual(cache.state, state);
});

test('only a fresh fenced cache generation can replace tombstones with an authorized snapshot', () => {
  const cache = new ReferenceRoomCache('generation-before');
  cache.snapshot('generation-before', { ...envelope, messages: [message('a', '1')], nextCursor: 'one' });
  cache.delta('generation-before', 'one', { ...envelope, events: [{ type: 'message.deleted', messageId: 'a', version: '2' }], nextCursor: 'two' });
  const state = structuredClone(cache.state);
  assert.throws(() => cache.reset('generation-before'), /new_cache_generation_required/);
  assert.deepEqual(cache.state, state);
  assert.equal(cache.snapshot('generation-before', { ...envelope, messages: [message('a', '3')], nextCursor: 'same-generation' }), false);
  const authority = { ...envelope, authorizationRevision: 'B'.repeat(42) + 'A' };
  assert.equal(cache.history('generation-before', { ...authority, messages: [message('a', '3')] }), false);
  cache.reset('generation-after');
  assert.equal(cache.snapshot('generation-before', { ...envelope, messages: [message('a', '3')], nextCursor: 'late' }), false);
  assert.equal(cache.snapshot('generation-after', { ...authority, resetRequired: true, membershipScope: null, authorizationRevision: null, messages: [], nextCursor: null }), false);
  assert.equal(cache.snapshot('generation-after', { ...authority, messages: [message('a', '3')], nextCursor: 'authorized' }), true);
  assert.equal(cache.history('generation-before', { ...envelope, messages: [message('a', '4')] }), false);
  assert.deepEqual(cache.visible(), [message('a', '3')]); assert.equal(cache.state.cursor, 'authorized');
});
