import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MessageEligibilityService } from '../../dist/modules/messages/message-eligibility.service.js';
import { MessageEligibilityRepository } from '../../dist/modules/messages/message-eligibility.repository.js';
import { MessagesCoreService } from '../../dist/modules/messages/messages-core.service.js';
import { MessagesQueryService } from '../../dist/modules/messages/messages-query.service.js';

function fixture() {
  const tx = { now: async () => new Date(0) }, room = randomUUID(), own = randomUUID(), peer = randomUUID(), stream = randomUUID();
  const viewer = { id: own, user_id: randomUUID(), room_id: room, active_period_id: randomUUID(), visible_from_order: '0' };
  const pair = { room_id: room, stream_id: stream, left_member_id: own, right_member_id: peer };
  const members = [
    { id: own, user_id: viewer.user_id, role: 'STREAMER', active_period_id: viewer.active_period_id, active_period: { member_id: own, visible_from_order: 0n }, room: { mode: 'FAN', owner_member_id: own } },
    { id: peer, user_id: randomUUID(), role: 'FAN', active_period_id: randomUUID(), active_period: { member_id: peer, visible_from_order: 0n } },
  ];
  const message = { id: randomUUID(), room_id: room, sender_member_id: own, sender: { user_id: viewer.user_id }, deletion_root_id: null,
    content_kind: 'TEXT', text_content: '본문', stream: { id: stream, room_id: room, kind: 'RESTRICTED', pair } };
  const state = { blocks: [], messages: [message], members, pairs: [pair], grants: [own, peer].map(member_id => ({ stream_id: stream, member_id, can_read: true, can_send: true })) };
  const calls = [];
  const repository = Object.fromEntries(['blocks', 'messages', 'members', 'pairs', 'grants'].map(method => [method, async (handle, roomId, ...args) => {
    assert.equal(handle, tx); assert.equal(roomId, room); calls.push([method, ...args]); return state[method];
  }]));
  const service = new MessageEligibilityService(repository);
  return { tx, room, own, peer, stream, viewer, pair, members, message, state, service, calls,
    hints: async () => (await service.project(tx, viewer, [message.id])).get(message.id) };
}

test('private own outgoing projects opposite participant; shared targets and FAN roles are current', async () => {
  const f = fixture();
  assert.deepEqual(await f.hints(), { counterpart: { actorId: f.peer }, allowedActions: { reply: true, publish: true, delete: true } });
  f.message.sender_member_id = f.peer; f.message.sender.user_id = f.members[1].user_id;
  assert.equal((await f.hints()).allowedActions.delete, false);
  f.message.stream.kind = 'ROOM_SHARED';
  assert.deepEqual(await f.hints(), { counterpart: null, allowedActions: { reply: true, publish: false, delete: false } });
  f.state.pairs = []; f.state.grants = []; assert.equal((await f.hints()).allowedActions.reply, true);
  f.members[0].role = 'FAN'; assert.equal((await f.hints()).allowedActions.reply, false);
  f.members[0].room.mode = 'GROUP'; assert.equal((await f.hints()).allowedActions.reply, true);
  f.message.sender_member_id = f.own; assert.equal((await f.hints()).allowedActions.reply, false);
});

test('private cross-room, nonparticipant, nonpair and wrong stream never expose counterpart', async () => {
  for (const change of [
    f => { f.message.stream.room_id = randomUUID(); }, f => { f.pair.room_id = randomUUID(); },
    f => { f.pair.stream_id = randomUUID(); }, f => { f.pair.left_member_id = randomUUID(); },
    f => { f.message.stream.pair = null; }, f => { f.message.sender_member_id = randomUUID(); },
    f => { f.state.pairs = []; }, f => { f.state.pairs = [{ ...f.pair, stream_id: randomUUID() }]; },
  ]) {
    const f = fixture(); change(f); const hint = await f.hints();
    assert.equal(hint.counterpart, null); assert.equal(hint.allowedActions.reply, false);
  }
});

test('revocation, missing peer, expired grants and rejoin never retain or repair eligibility', async () => {
  for (const change of [
    f => { f.state.grants = []; }, f => { f.state.grants[0].can_send = false; },
    f => { f.state.grants[0].can_read = false; }, f => { f.state.grants[1].can_read = false; },
    f => { f.state.members = [f.members[0]]; }, f => { f.members[1].active_period_id = null; },
    f => { f.members[0].active_period_id = randomUUID(); }, f => { f.members[0].active_period.visible_from_order = 5n; },
    f => { f.members[1].active_period_id = randomUUID(); f.state.grants = []; },
  ]) {
    const f = fixture(); assert.equal((await f.hints()).allowedActions.reply, true);
    change(f); const hint = await f.hints(); assert.equal(hint.counterpart, null); assert.equal(hint.allowedActions.reply, false);
  }
  const f = fixture(); f.state.grants[1].can_send = false;
  assert.equal((await f.hints()).allowedActions.reply, true, 'peer send permission is not required by send mutation');
});

test('anonymous publisher owns deletion, source fan does not; publish is independent of reply eligibility', async () => {
  const f = fixture(); f.message.deletion_root_id = randomUUID(); f.message.stream.kind = 'ROOM_SHARED';
  assert.deepEqual(await f.hints(), { counterpart: null, allowedActions: { reply: false, publish: false, delete: true } });
  f.message.sender.user_id = randomUUID(); assert.equal((await f.hints()).allowedActions.delete, false);
  f.message.deletion_root_id = null; f.message.stream.kind = 'RESTRICTED'; f.state.grants = [];
  for (const kind of ['TEXT', 'PHOTO', 'VIDEO', 'STICKER']) {
    f.message.content_kind = kind; const hint = await f.hints();
    assert.equal(hint.allowedActions.reply, false); assert.equal(hint.allowedActions.publish, ['TEXT', 'PHOTO'].includes(kind));
  }
  f.message.content_kind = 'TEXT'; f.message.text_content = null; assert.equal((await f.hints()).allowedActions.publish, false);
  f.message.text_content = '본문'; f.members[0].room.owner_member_id = f.peer; assert.equal((await f.hints()).allowedActions.publish, false);
  f.message.sender.user_id = f.viewer.user_id; f.state.members = [];
  assert.equal((await f.hints()).allowedActions.delete, true, 'ownership does not depend on current membership/SOOP');
});

test('GET snapshot history event parity and equal-version stale action refresh use identical transaction port', async () => {
  const f = fixture();
  const row = { ...f.message, version: '7', created_order: '1', created_at: new Date('2026-09-20T00:00:00Z'), stream_kind: 'RESTRICTED',
    kind: 'RESTRICTED', quote_id: null, avatar_id: null, nickname: '사용자', blocked: 0 };
  const core = new MessagesCoreService({}, {}, {}, {}, {}, {}, f.service);
  core.readable = async tx => { assert.equal(tx, f.tx); return true; };
  const query = new MessagesQueryService({ page: async tx => { assert.equal(tx, f.tx); return [row]; } }, f.service);
  const original = await core.project(f.tx, f.viewer, row);
  for (const window of [{ kind: 'snapshot', from: '1' }, { kind: 'history', from: '2' }, { kind: 'events', from: '0', high: '1' }]) {
    const page = await query.page(f.tx, f.viewer, window, 10); assert.deepEqual(page.items[0].message, original);
  }
  f.state.grants[0].can_send = false;
  const refreshed = await core.project(f.tx, f.viewer, row);
  assert.equal(refreshed.version, original.version); assert.equal(original.allowedActions.reply, true);
  assert.equal(refreshed.allowedActions.reply, false); assert.equal(refreshed.counterpart, null);
  row.blocked = 1;
  const before = f.calls.length;
  assert.equal((await query.page(f.tx, f.viewer, { kind: 'events', from: '0', high: '1' }, 10)).items[0].message, null);
  assert.equal(f.calls.length, before, 'tombstones do not load eligibility facts');
});

test('ORM eligibility bounds account, SOOP, exact period, room, pair and database-clock grants without writes', async () => {
  const now = new Date(); const seen = [];
  const tx = { now: async () => now, prisma: Object.fromEntries(['messages', 'room_members', 'stream_pairs', 'stream_grants'].map(model => [model, {
    findMany: async input => { seen.push([model, input]); return []; },
  }])) };
  const repo = new MessageEligibilityRepository();
  await repo.messages(tx, 'room', ['message']); await repo.members(tx, 'room', ['viewer', 'peer']);
  await repo.pairs(tx, 'room', 'viewer', ['peer']); await repo.grants(tx, 'room', ['stream'], ['viewer', 'peer']);
  assert.deepEqual(seen[0][1].where, { room_id: 'room', id: { in: ['message'] } });
  assert.deepEqual(seen[1][1].where.user, { status: 'ACTIVE', soop: { is: { status: 'VERIFIED' } } });
  assert.deepEqual(seen[1][1].where.active_period, { is: { room_id: 'room', left_at: null } });
  assert.deepEqual(seen[2][1].where.stream, { room_id: 'room', kind: 'RESTRICTED' });
  assert.deepEqual(seen[3][1].where, { room_id: 'room', stream_id: { in: ['stream'] }, member_id: { in: ['viewer', 'peer'] },
    revoked_at: null, valid_from: { lte: now }, OR: [{ expires_at: null }, { expires_at: { gt: now } }] });
});
