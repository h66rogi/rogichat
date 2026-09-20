import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessagesQueryService } from '../../dist/modules/messages/messages-query.service.js';

const eligibility = { project: async (_tx, _viewer, ids, now) => {
  assert.deepEqual(now, new Date(0));
  return new Map(ids.map(id => [id, { counterpart: null, allowedActions: { reply: false, publish: false, delete: false } }]));
} };
const viewer = { id: 'actor', room_id: 'room', visible_from_order: '0' };
function row(input = {}) {
  return { id: 'message', version: '2', created_order: '9007199254740994', event_order: '9007199254740995',
    created_at: new Date('2026-09-20T00:00:00Z'), blocked: 0, content_kind: 'TEXT', kind: 'ROOM_SHARED',
    text_content: 'visible', deletion_root_id: 'private-source', sender_member_id: 'private-actor', nickname: 'private-name',
    avatar_id: 'private-avatar', quote_id: null, object_key: 'private-key', ...input };
}

test('message query port passes the exact authorized snapshot and returns only canonical DTO/position envelopes', async () => {
  const tx = { now: async () => new Date(0) }; const window = { kind: 'snapshot', from: '9007199254740999' };
  const stored = row({ quote_id: 'private-quote', quote_text: 'private-quote-body' }); const calls = [];
  const query = new MessagesQueryService({ page: async (...args) => { calls.push(args); return [stored, row({ content_kind: 'unknown-lookahead' })]; } }, eligibility);
  const result = await query.page(tx, viewer, window, 1);
  assert.deepEqual(calls, [[tx, viewer.id, viewer.room_id, viewer.visible_from_order, window, 2, new Date(0)]]);
  assert.equal(result.hasMore, true); assert.equal(result.items.length, 1);
  assert.deepEqual(Object.keys(result.items[0]).sort(), ['blocked', 'createdOrder', 'eventOrder', 'id', 'message', 'version']);
  assert.equal(result.items[0].createdOrder, '9007199254740994');
  assert.deepEqual(result.items[0].message.author, { kind: 'anonymous' });
  assert.equal(result.items[0].message.quote, null);
  assert.doesNotMatch(JSON.stringify(result), /private-source|private-actor|private-name|private-avatar|private-key|private-quote/);
  stored.text_content = 'later mutation';
  assert.equal(result.items[0].message.content.text, 'visible');
  assert.equal('project' in query, false);
});

test('deleted event envelope never projects content and source invalidation returns only a boolean', async () => {
  const tx = { now: async () => new Date(0) }; const stored = row({ blocked: 1, content_kind: 'invalid-but-deleted', text_content: 'deleted-private-body' });
  const query = new MessagesQueryService({ page: async () => [stored], affected: async (...args) => {
    assert.deepEqual(args, [tx, viewer.room_id, viewer.id, viewer.visible_from_order, '1', '3', new Date(0)]);
    return [{ id: 'private-source' }];
  } }, eligibility);
  const result = await query.page(tx, viewer, { kind: 'events', from: '1', high: '3' }, 10);
  assert.deepEqual(result.items[0], { id: 'message', version: '2', createdOrder: '9007199254740994', eventOrder: '9007199254740995', blocked: true, message: null });
  assert.equal(await query.affected(tx, viewer, '1', '3'), true);
  await assert.rejects(query.page(tx, viewer, { kind: 'snapshot', from: '3' }, 10));
});
