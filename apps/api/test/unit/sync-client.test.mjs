import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReferenceRoomCache, ReferenceManifest, syncPolicy } from '../../../../packages/contracts/sync-client.mjs';

const message = (id, version, text = 'fixture') => ({ id, version, content: { type: 'TEXT', text } });
test('client data/cursor atomicity, replay idempotence and late history cannot revive a tombstone', () => {
  const cache = new ReferenceRoomCache('first');
  cache.snapshot('first', { messages: [message('a', '1')], nextCursor: 'one' });
  const delta = { events: [{ type: 'message.deleted', messageId: 'a', version: '2' }], nextCursor: 'two' };
  assert.throws(() => cache.delta('first', 'one', delta, () => { throw new Error('crash'); }));
  assert.equal(cache.state.cursor, 'one'); assert.equal(cache.visible().length, 1);
  cache.delta('first', 'one', delta);
  assert.equal(cache.delta('first', 'one', { events: [], nextCursor: 'stale' }), false);
  cache.history('first', { messages: [message('a', '1'), message('a', '2')] });
  assert.deepEqual(cache.visible(), []); assert.equal(cache.state.cursor, 'two');
  cache.reset('new-account');
  assert.equal(cache.delta('first', null, { events: [{ type: 'message.upsert', message: message('a', '3') }], nextCursor: 'late' }), false);
  assert.deepEqual(cache.visible(), []);
});
test('manifest only replaces on a complete stable generation and omitted birthday disappears', () => {
  const profiles = new ReferenceManifest('account-cache');
  profiles.page('account-cache', { generation: 'old', complete: true, profiles: [{ actorId: 'a', birthday: { month: 2, day: 29 } }, { actorId: 'b' }] }, 'profiles');
  assert.equal(profiles.page('account-cache', { generation: 'next', complete: false, profiles: [{ actorId: 'a' }] }, 'profiles'), false);
  assert.equal(profiles.current.size, 2);
  assert.equal(profiles.page('account-cache', { resetRequired: true }, 'profiles'), false);
  profiles.page('account-cache', { generation: 'new', complete: true, profiles: [{ actorId: 'a' }] }, 'profiles');
  assert.equal(profiles.current.size, 1); assert.equal('birthday' in profiles.current.get('a'), false);
  profiles.clear('new-account-cache'); assert.equal(profiles.current.size, 0);
  assert.equal(profiles.page('account-cache', { generation: 'old-account', complete: true, profiles: [{ actorId: 'a', birthday: { month: 2, day: 29 } }] }, 'profiles'), false);
  assert.equal(profiles.current.size, 0);
  assert.ok(syncPolicy.triggers.includes('reconnect')); assert.equal(syncPolicy.foregroundMs, 15000);
});
