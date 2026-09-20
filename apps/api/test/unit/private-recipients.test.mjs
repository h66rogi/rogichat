import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrivateRecipientsCoreService } from '../../dist/modules/rooms/private-recipients-core.service.js';
import { PrivateRecipientsRepository } from '../../dist/modules/rooms/private-recipients.repository.js';

const roomId = randomUUID(), userId = randomUUID(), viewerId = randomUUID();
const actorId = index => `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const candidate = index => ({ id: actorId(index), user_id: randomUUID(), active_period: { member_id: actorId(index), room_id: roomId, left_at: null }, user: { profile: { nickname: `합성 ${index}`, avatar: null } } });
const access = { blockedActors: async () => [], requireActiveMember: async () => ({ id: viewerId, role: 'STREAMER', mode: 'FAN' }) };
const tx = { now: async () => new Date('2026-01-01T00:00:00Z') };
const blocked = recipient => ({ left_member_id: viewerId, right_member_id: recipient.id, stream: { room_id: roomId, kind: 'RESTRICTED', grants: [] } });

test('recipient eligibility precedes response LIMIT and next never exposes a skipped/lookahead actor', async () => {
  const rows = Array.from({ length: 160 }, (_, index) => candidate(index + 1)); let batches = 0;
  const repository = {
    candidates: async (_tx, _room, role, after) => { batches++; assert.equal(role, 'FAN'); return rows.filter(row => row.id > after).slice(0, 100); },
    pairs: async (_tx, _room, _viewer, ids) => rows.filter(row => ids.includes(row.id) && row.id <= actorId(105)).map(blocked),
  };
  const service = new PrivateRecipientsCoreService(access, repository);
  const first = await service.list(tx, roomId, userId);
  assert.equal(batches, 2); assert.equal(first.recipients.length, 50); assert.equal(first.next, actorId(155));
  assert.equal(first.recipients[0].actorId, actorId(106));
  const second = await service.list(tx, roomId, userId, first.next);
  assert.deepEqual(second.recipients.map(row => row.actorId), rows.slice(155).map(row => row.id)); assert.equal(second.next, null);
});

test('unproven exhaustion at 10000 candidates fails closed without returning partial results', async () => {
  let batches = 0, pairBatches = 0;
  const repository = {
    candidates: async () => Array.from({ length: 100 }, (_, index) => candidate(batches * 100 + index + 1)).map((row, index) => { if (index === 99) batches++; return row; }),
    pairs: async (_tx, _room, _viewer, ids) => { pairBatches++; return ids.map(id => blocked({ id })); },
  };
  await assert.rejects(new PrivateRecipientsCoreService(access, repository).list(tx, roomId, userId), error => error.getStatus() === 503);
  assert.equal(batches, 100); assert.equal(pairBatches, 100);
});

test('pair authorization requires both can_read but only viewer can_send', async () => {
  const rows = [candidate(1), candidate(2), candidate(3), candidate(4)];
  const pair = (row, viewerRead, viewerSend, targetRead, kind = 'RESTRICTED') => ({ ...blocked(row), stream: { room_id: roomId, kind, grants: [
    { member_id: viewerId, can_read: viewerRead, can_send: viewerSend },
    { member_id: row.id, can_read: targetRead, can_send: false },
  ] } });
  const repository = { candidates: async () => rows, pairs: async () => [pair(rows[0], true, true, true), pair(rows[1], false, true, true), pair(rows[2], true, false, true), pair(rows[3], true, true, false)] };
  assert.deepEqual((await new PrivateRecipientsCoreService(access, repository).list(tx, roomId, userId)).recipients.map(row => row.actorId), [rows[0].id]);
});

test('MEMBER and GROUP viewer cannot query candidates at all', async () => {
  for (const viewer of [{ id: viewerId, mode: 'FAN', role: 'MEMBER' }, { id: viewerId, mode: 'GROUP', role: 'STREAMER' }]) {
    await assert.rejects(new PrivateRecipientsCoreService({ requireActiveMember: async () => viewer }, {}).list(tx, roomId, userId), error => error.status === 403);
  }
});

test('Prisma candidate and grant queries use explicit bounded selects and exact time predicates', async () => {
  let candidates, pairs; const now = await tx.now();
  const db = { now: async () => now, prisma: { room_test_grants: { findMany: async () => [] }, room_members: { findMany: async input => { candidates = input; return []; } }, stream_pairs: { findMany: async input => { pairs = input; return []; } } } };
  const repository = new PrivateRecipientsRepository();
  await repository.candidates(db, roomId, 'FAN', actorId(1)); await repository.pairs(db, roomId, viewerId, [actorId(2)], now);
  assert.equal(candidates.take, 100); assert.deepEqual(candidates.orderBy, { id: 'asc' });
  assert.equal(candidates.where.user.OR[0].soop.is.status, 'VERIFIED'); assert.deepEqual(candidates.where.user.OR[1], { reviewer_expires_at: { gt: now } }); assert.equal(candidates.where.user.OR[2].identities.some.provider, 'apple'); assert.deepEqual(candidates.where.active_period, { is: { left_at: null } });
  assert.deepEqual(Object.keys(candidates.select.user.select.profile.select).sort(), ['avatar', 'nickname']);
  assert.deepEqual(pairs.select.stream.select.grants.where, { room_id: roomId, member_id: { in: [viewerId, actorId(2)] }, revoked_at: null, valid_from: { lte: now }, OR: [{ expires_at: null }, { expires_at: { gt: now } }] });
});

test('malformed participation references and cross-room pair streams never become recipients', async () => {
  const rows = [candidate(1), candidate(2), candidate(3)];
  rows[0].active_period.member_id = randomUUID(); rows[1].active_period.room_id = randomUUID();
  const pair = { ...blocked(rows[2]), stream: { room_id: randomUUID(), kind: 'RESTRICTED', grants: [
    { member_id: viewerId, can_read: true, can_send: true }, { member_id: rows[2].id, can_read: true, can_send: true },
  ] } };
  assert.deepEqual(await new PrivateRecipientsCoreService(access, { candidates: async () => rows, pairs: async () => [pair] }).list(tx, roomId, userId), { recipients: [], next: null });
});
