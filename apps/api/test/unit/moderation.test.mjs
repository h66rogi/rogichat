import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { reportInput, resolutionInput } from '../../dist/modules/moderation/moderation.dto.js';
import { ModerationCoreService, reportReceipt } from '../../dist/modules/moderation/moderation-core.service.js';
import { BlockPolicyRepository } from '../../dist/modules/access/block-policy.repository.js';
import { ModerationRetentionService } from '../../dist/modules/moderation/moderation-retention.service.js';
import { ModerationRepository } from '../../dist/modules/moderation/moderation.repository.js';
import { ModerationService } from '../../dist/modules/moderation/moderation.service.js';

const body = () => ({ idempotencyKey: randomUUID(), reason: 'spam' });
test('report schema rejects identity injection, unsupported reasons, unbounded details and forged state', () => {
  const input = body(); assert.deepEqual(reportInput(input), { ...input, detail: null });
  for (const extra of [{ reason: '' }, { reason: 'admin' }, { detail: '' }, { detail: 'x'.repeat(1001) }, { detail: '\0' }, { status: 'resolved' }, { userId: randomUUID() }, { rootMessageId: randomUUID() }]) {
    assert.throws(() => reportInput({ ...input, ...extra }), { code: 'INVALID_REQUEST' });
  }
  assert.deepEqual(resolutionInput({ status: 'resolved' }), { status: 'resolved' });
  for (const value of [{ status: 'reviewing' }, { status: 'resolved', note: 'uncontracted' }, { status: 'received' }]) assert.throws(() => resolutionInput(value), { code: 'INVALID_REQUEST' });
});

test('report replay authentic receipt survives lost access and never reloads body; mismatched immutable request conflicts', async () => {
  const now = new Date(); const tx = { now: async () => now }; const room = randomUUID(), message = randomUUID(), user = randomUUID(), key = randomBytes(32);
  let receipt; let reads = 0;
  const repo = { receipt: async () => receipt, createReport: async (_tx, data) => (receipt = { ...data, status: 'received' }) };
  const core = new ModerationCoreService(repo, { requireActiveMember: async () => ({ id: 'viewer' }) }, { lockRoom: async () => ({}) }, {
    load: async () => { reads++; return { id: message, content_owner_user_id: 'hidden-owner', deletion_root_id: 'hidden-root' }; }, readable: async () => true,
  });
  const input = reportInput({ ...body(), detail: 'private optional detail' });
  const first = await core.report(tx, user, room, message, input, key);
  assert.deepEqual(await core.report(tx, user, room, message, input, key), first); assert.equal(reads, 1);
  await assert.rejects(core.report(tx, user, room, message, { ...input, detail: null }, key), { code: 'CONFLICT' });
  assert.equal(reads, 1); assert.deepEqual(Object.keys(first).sort(), ['createdAt', 'reportId', 'status']);
  assert.equal(receipt.detail_expires_at.getTime() - now.getTime(), 86400000);
  assert.doesNotMatch(JSON.stringify(first), /hidden|private/);
});

test('new report cannot write storage without current readable message authorization', async () => {
  let writes = 0;
  const core = new ModerationCoreService({ receipt: async () => null, createReport: async () => { writes++; } },
    { requireActiveMember: async () => ({}) }, { lockRoom: async () => ({}) }, { load: async () => ({}), readable: async () => false });
  await assert.rejects(core.report({}, 'user', 'room', 'message', reportInput(body()), randomBytes(32)), { code: 'NOT_FOUND' });
  assert.equal(writes, 0);
});

test('block policy uses current lock reads for writes, snapshot Prisma for reads, and directional versus bilateral predicates', async () => {
  const repo = new BlockPolicyRepository(); let captured;
  const entries = [{ blocker_actor_id: 'viewer', target_actor_id: 'peer' }, { blocker_actor_id: 'other', target_actor_id: 'viewer' }];
  const writable = { writable: true, rows: async (sql, values) => { assert.match(sql, /FOR UPDATE/); captured = values; return entries; } };
  assert.deepEqual(await repo.targets(writable, 'room', 'viewer', true), ['peer', 'other']);
  assert.deepEqual(captured, ['room', 'viewer', 'viewer', true]);
  const readable = { writable: false, prisma: { actor_blocks: { findMany: async input => { captured = input.where; return entries.slice(0, 1); } } } };
  assert.deepEqual(await repo.targets(readable, 'room', 'viewer', false), ['peer']);
  assert.deepEqual(captured.OR, [{ blocker_actor_id: 'viewer' }]);
});

test('retention ports pass bounded transaction scopes and never delete report receipts', async () => {
  const tx = { now: async () => new Date(0) }; const seen = [];
  const core = new ModerationRetentionService({ clear: async (...args) => { seen.push(args); return { changed: 2, done: false }; } });
  assert.deepEqual(await core.clearForMessage(tx, 'room', 'message'), { changed: 2, done: false });
  assert.deepEqual(seen[0], [tx, { kind: 'message', roomId: 'room', messageId: 'message' }, 100]);
  await core.clearForAccount(tx, 'user', 7); assert.equal(seen[1][2], 7);
  await core.expire(tx); assert.deepEqual(seen[2][1], { kind: 'expiry', now: new Date(0) });
  assert.throws(() => core.clearForAccount(tx, 'user', 101), /invalid_moderation_cleanup_limit/);
});

test('ban closes only target period and revokes grants while unban only returns LEFT', async () => {
  const calls = []; const models = ['membership_periods', 'stream_grants', 'room_members', 'users'];
  const tx = { now: async () => new Date(0), prisma: Object.fromEntries(models.map(name => [name, { updateMany: async input => { calls.push([name, input]); return { count: 1 }; } }])) };
  const repo = new ModerationRepository();
  await repo.ban(tx, 'room', 'target', 'old-period', true);
  assert.equal(calls[0][0], 'membership_periods'); assert.equal(calls[0][1].where.member_id, 'target');
  assert.deepEqual(calls[1][1].data, { revoked_at: new Date(0), can_read: false, can_send: false });
  assert.equal(calls[2][1].data.status, 'BANNED'); assert.equal(calls[2][1].data.active_period_id, null);
  calls.length = 0; await repo.ban(tx, 'room', 'target', null, false);
  assert.equal(calls[0][1].data.status, 'LEFT'); assert.ok(calls.every(([name]) => !['stream_grants', 'membership_periods'].includes(name)));
});

test('receipt projection never spreads repository row', () => {
  assert.deepEqual(reportReceipt({ id: 'id', created_at: new Date(0), status: 'received', room_id: 'private', detail: 'private', content_owner_user_id: 'private' }),
    { reportId: 'id', createdAt: new Date(0).toISOString(), status: 'received' });
});

test('blocked message reads stop before content, grant, attachment or sticker lookups', async () => {
  const { MessagesCoreService } = await import('../../dist/modules/messages/messages-core.service.js');
  const calls = [];
  const core = new MessagesCoreService({}, { actorBlocked: async (...args) => { calls.push(args); return true; } });
  const tx = {}; const viewer = { id: 'viewer' }; const row = { room_id: 'room', sender_member_id: 'publisher', deletion_root_id: 'hidden-source' };
  assert.equal(await core.readable(tx, viewer, row), false);
  assert.deepEqual(calls, [[tx, 'room', 'viewer', 'publisher']], 'anonymous publications never resolve or pass their hidden source');
});

test('retention completion uses current bounded locks rather than stale snapshot absence', async () => {
  const { ModerationRetentionRepository } = await import('../../dist/modules/moderation/moderation-retention.repository.js');
  const queries = []; let phase = 0;
  const tx = { rows: async (sql, values) => { queries.push([sql, values]); return phase++ ? [{ id: 'still-pending' }] : [{ id: 'selected' }]; },
    prisma: { moderation_reports: { updateMany: async query => { assert.deepEqual(query.where.id.in, ['selected']); return { count: 0 }; } } } };
  assert.deepEqual(await new ModerationRetentionRepository().clear(tx, { kind: 'message', roomId: 'room', messageId: 'message' }, 3), { changed: 0, done: false });
  assert.ok(queries.every(([sql]) => sql.endsWith('LIMIT ? FOR UPDATE')));
  assert.deepEqual(queries.map(([, values]) => values.at(-1)), [3, 1]);
});


test('message dependency drain waits for moderation scrubbing including zero-change pending work', async () => {
  const { MessageDependenciesService } = await import('../../dist/modules/deletion/message-dependencies.service.js');
  const tx = {}; const calls = [];
  const core = new MessageDependenciesService({}, { purgeMessage: async () => { assert.fail('must wait for detail cleanup'); } }, {
    clearForMessage: async (...args) => { calls.push(args); return { changed: 0, done: false }; },
  });
  assert.deepEqual(await core.page(tx, 'room', 'message', 10), { changed: 0, done: false });
  assert.deepEqual(calls, [[tx, 'room', 'message', 10]]);
});


test('recovery names are scoped to existing owned blocks and keep FAN/afterleave policy without profile grants', async () => {
  const repo = new ModerationRepository(); const calls = [];
  const member = { id: 'mine', role: 'FAN', status: 'LEFT', room: { mode: 'FAN', status: 'ACTIVE' }, user: { status: 'ACTIVE', soop: { status: 'VERIFIED' } } };
  const rows = [{ target_actor_id: 'visible', created_at: new Date(0) }, { target_actor_id: 'unavailable', created_at: new Date(0) }];
  const tx = { prisma: { room_members: { findFirst: async () => member, findMany: async query => {
    calls.push(query); return [{ id: 'visible', active_period: { member_id: 'visible' }, user: { profile: { nickname: 'current name' } } }];
  } }, actor_blocks: { findMany: async query => { assert.equal(query.where.blocker_actor_id, 'mine'); return rows; } } } };
  assert.deepEqual((await repo.ownBlocks(tx, 'room', 'caller', '')).map(row => row.displayName), ['current name', null]);
  assert.deepEqual(calls[0].where.id, { in: ['visible', 'unavailable'] }); assert.equal(calls[0].where.role, 'STREAMER');
  assert.deepEqual(calls[0].select.user, { select: { profile: { select: { nickname: true } } } });
  member.status = 'BANNED'; assert.ok((await repo.ownBlocks(tx, 'room', 'caller', '')).every(row => row.displayName === null)); assert.equal(calls.length, 1);
  tx.prisma.room_members.findFirst = async () => null; assert.deepEqual(await repo.ownBlocks(tx, 'room', 'outsider', ''), []); assert.equal(calls.length, 1);
});


test('blocked-room discovery is bounded and empty pages keep an internal continuation without exposing unrelated rooms', async () => {
  const members = Array.from({ length: 51 }, (_, i) => ({ id: `actor${i}`, room_id: `room${i}`, status: 'LEFT', active_period: null }));
  let probes = 0; let labels = 0; let match = false;
  const tx = { prisma: { room_members: { findMany: async query => { assert.equal(query.take, 51); assert.equal(query.where.user_id, 'caller'); return members; } },
    actor_blocks: { groupBy: async query => { probes++; assert.deepEqual(query.by, ['room_id', 'blocker_actor_id']); assert.equal(query.where.OR.length, 50); assert.deepEqual(query.where.OR[1], { room_id: 'room1', blocker_actor_id: 'actor1' }); return match ? [{ room_id: 'room1', blocker_actor_id: 'actor1' }] : []; } },
    rooms: { findMany: async query => { labels++; assert.deepEqual(query.where, { status: 'ACTIVE', OR: [{ id: 'room1', join_policy: 'OPEN_AUTHENTICATED' }] }); return [{ id: 'room1', name: 'current room' }]; } } } };
  const repo = new ModerationRepository();
  assert.deepEqual(await repo.blockRooms(tx, 'caller', '', true), { rooms: [], nextRoomId: 'room49' });
  assert.equal(probes, 1); assert.equal(labels, 0);
  match = true; const page = await repo.blockRooms(tx, 'caller', '', true);
  assert.deepEqual(page.rooms, [{ roomId: 'room1', displayName: 'current room' }]); assert.equal(labels, 1);
  members[1].status = 'BANNED'; assert.deepEqual((await repo.blockRooms(tx, 'caller', '', true)).rooms, [{ roomId: 'room1', displayName: null }]); assert.equal(labels, 1);
});

test('blocked-room cursor hides scan positions and rejects tampering, other accounts, sessions, audience and expiry', async () => {
  const { BlockRoomsCursor } = await import('../../dist/modules/moderation/block-rooms-cursor.js');
  const key = randomBytes(32), codec = new BlockRoomsCursor(key, 'fixture'); const now = new Date();
  const actor = { userId: randomUUID(), sessionId: randomUUID(), soopLinked: true }, room = randomUUID();
  const token = codec.next(room, actor, now); assert.equal(codec.after(token, actor, now), room);
  assert.equal(Buffer.from(token, 'base64url').includes(Buffer.from(room)), false);
  assert.notEqual(codec.next(room, actor, now), token);
  for (const principal of [{ ...actor, userId: randomUUID() }, { ...actor, sessionId: randomUUID() }]) assert.throws(() => codec.after(token, principal, now), { code: 'INVALID_CURSOR' });
  assert.throws(() => new BlockRoomsCursor(key, 'other').after(token, actor, now), { code: 'INVALID_CURSOR' });
  assert.throws(() => codec.after(token, actor, new Date(now.getTime() + 900000)), { code: 'INVALID_CURSOR' });
  const bytes = Buffer.from(token, 'base64url'); bytes[42] ^= 1;
  assert.throws(() => codec.after(bytes.toString('base64url'), actor, now), { code: 'INVALID_CURSOR' });
  assert.equal(codec.after(undefined, actor, now), ''); assert.equal(codec.next(null, actor, now), null);
});

test('blocked-room service rejects pre-restore cursors before discovery and resumes only within the current authorization epoch', async () => {
  const key = randomBytes(32), stableKey = Buffer.from(key), base = { key, audience: 'fixture' };
  const actor = { userId: randomUUID(), sessionId: randomUUID(), soopLinked: true };
  const roomId = randomUUID(), now = new Date(), positions = [];
  const transactions = { read: work => work({ now: async () => now }) };
  const auth = { require: async () => actor };
  const core = { blockRooms: async (_tx, userId, after, linked) => {
    assert.equal(userId, actor.userId); assert.equal(linked, true); positions.push(after);
    return { rooms: [], nextRoomId: after ? null : roomId };
  } };
  const service = config => new ModerationService(transactions, auth, config, core);
  const legacy = service(base), prior = service({ ...base, authorizationEpoch: randomUUID() });
  const currentConfig = { ...base, authorizationEpoch: randomUUID() }, current = service(currentConfig);
  const legacyToken = (await legacy.blockRooms({}, undefined)).nextCursor;
  const priorToken = (await prior.blockRooms({}, undefined)).nextCursor;
  const before = positions.length;
  for (const token of [legacyToken, priorToken]) {
    await assert.rejects(current.blockRooms({}, token), { code: 'INVALID_CURSOR', status: 400 });
  }
  assert.equal(positions.length, before);
  const currentToken = (await current.blockRooms({}, undefined)).nextCursor;
  assert.deepEqual(await service(currentConfig).blockRooms({}, currentToken), { rooms: [], nextCursor: null });
  assert.equal(positions.at(-1), roomId);
  await assert.rejects(prior.blockRooms({}, currentToken), { code: 'INVALID_CURSOR', status: 400 });
  assert.deepEqual(await service(base).blockRooms({}, legacyToken), { rooms: [], nextCursor: null });
  assert.deepEqual(key, stableKey);
});
