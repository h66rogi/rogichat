import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { reportInput, resolutionInput } from '../../dist/modules/moderation/moderation.dto.js';
import { ModerationCoreService, reportReceipt } from '../../dist/modules/moderation/moderation-core.service.js';
import { BlockPolicyRepository } from '../../dist/modules/access/block-policy.repository.js';
import { ModerationRetentionService } from '../../dist/modules/moderation/moderation-retention.service.js';
import { ModerationRepository } from '../../dist/modules/moderation/moderation.repository.js';

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
