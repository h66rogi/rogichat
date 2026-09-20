import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { membershipScope, parseMembershipScope } from '../../dist/modules/membership-scope/membership-scope.js';
import { MembershipScopeService } from '../../dist/modules/membership-scope/membership-scope.service.js';
import { sendInput } from '../../dist/modules/messages/dto/send-message.dto.js';
import { MessagesCoreService } from '../../dist/modules/messages/messages-core.service.js';

const key = Buffer.alloc(32, 7), audience = 'scope-test';
const userId = randomUUID(), roomId = randomUUID(), periodId = randomUUID();
const scope = membershipScope(key, audience, userId, roomId, periodId);
const input = () => sendInput({ membershipScope: scope, clientMessageId: randomUUID(), intent: 'SHARED', content: { type: 'TEXT', text: 'e\u0301' } });

test('membership scope is canonical, environment/account/room/period separated; SEND rejects missing or malformed scope', () => {
  assert.equal(parseMembershipScope(scope), scope);
  for (const args of [[key, 'other', userId, roomId, periodId], [key, audience, randomUUID(), roomId, periodId], [key, audience, userId, randomUUID(), periodId], [key, audience, userId, roomId, randomUUID()]]) assert.notEqual(membershipScope(...args), scope);
  for (const bad of [undefined, null, '', 'x'.repeat(43), 'A'.repeat(42), [], 1]) {
    assert.throws(() => sendInput({ ...input(), recipientActorId: undefined, membershipScope: bad }), { code: 'INVALID_REQUEST' });
  }
});

test('A retains the exact viewer ACL vector including account generation; other-room joins change A but not M', async () => {
  const member = { id: randomUUID(), room_id: roomId, role: 'MEMBER', active_period_id: periodId, acl_epoch: 3n, active_period: { visible_from_order: 9007199254740993n }, user: { membership_generation: 2n }, room: { mode: 'GROUP', policy_version: 4 } };
  const now = new Date('2026-09-20T00:00:00.123Z');
  const grant = { member_id: member.id, stream_id: randomUUID(), can_read: true, can_send: false, valid_from: new Date(0), expires_at: now, revoked_at: null };
  const revoked = [{ room_id: roomId, id: randomUUID() }];
  const service = new MembershipScopeService({ key, audience }, { batch: async (_tx, _user, _rooms, captured) => { assert.equal(captured, now); return { members: [member], grants: [grant], revoked }; } });
  const one = await service.one({}, userId, roomId, now);
  const vector = [member.id, member.role, member.room.mode, periodId, '9007199254740993', '3', 4, '2', [{ stream_id: grant.stream_id, can_read: 1, can_send: 0, valid_from: grant.valid_from, expires_at: now, revoked_at: null, active: 0 }], [revoked[0].id]];
  assert.equal(one.authorizationRevision, createHmac('sha256', key).update('authorization-revision:v1:').update(JSON.stringify([audience, vector])).digest('base64url'));
  member.user.membership_generation++;
  const two = await service.one({}, userId, roomId, now);
  assert.equal(one.membershipScope, two.membershipScope); assert.notEqual(one.authorizationRevision, two.authorizationRevision);
});

test('locked membership and scope validation precede committed and deleted receipts; v1 hash bytes exclude scope', async () => {
  const viewer = { id: randomUUID(), room_id: roomId, active_period_id: periodId };
  for (const deleted of [0, 1]) {
    let receiptReads = 0, membership = true;
    const body = input();
    const legacy = { clientMessageId: body.clientMessageId, intent: 'SHARED', recipientActorId: null, quoteId: null, content: { type: 'TEXT', text: 'é' } };
    const digest = createHmac('sha256', key).update('message-command:v1:').update(JSON.stringify(legacy)).digest();
    const repo = { room: async () => ({ status: 'ACTIVE' }), member: async () => viewer, receipt: async () => { receiptReads++; return { deleted, message_id: 'previous', digest_version: 1, payload_digest: digest }; } };
    const core = new MessagesCoreService(repo, { requireActiveMember: async () => { if (!membership) throw Object.assign(new Error(), { code: 'NOT_FOUND' }); return viewer; } });
    core.load = async () => ({ id: 'previous', version: '18446744073709551615' }); core.readable = async () => true;
    await assert.rejects(core.send({}, roomId, userId, { ...body, membershipScope: 'A'.repeat(43) }, key, audience), { code: 'MEMBERSHIP_SCOPE_MISMATCH' });
    assert.equal(receiptReads, 0);
    membership = false;
    await assert.rejects(core.send({}, roomId, userId, body, key, audience), { code: 'NOT_FOUND' });
    assert.equal(receiptReads, 0); membership = true;
    const receipt = await core.send({}, roomId, userId, body, key, audience);
    assert.equal(receipt.status, deleted ? 'deleted' : 'committed'); assert.equal(receiptReads, 1);
  }
});
