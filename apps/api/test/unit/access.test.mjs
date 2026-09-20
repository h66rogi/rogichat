import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canReadMessage, canPublishSource, validBirthday, nickname } from '../../dist/modules/access/access.policy.js';

const actor = {
  accountActive: true, soopLinked: true, roomId: 'room-a', roomActive: true,
  memberId: 'owner-a', memberRoomId: 'room-a', memberActive: true, periodActive: true,
  visibleFrom: 10n, role: 'STREAMER', ownerMemberId: 'owner-a',
};
const message = { roomId: 'room-a', streamId: 'stream-a', streamRoomId: 'room-a', streamKind: 'RESTRICTED', order: 10n,
  deleted: false, moderated: false, deletionRootBlocked: false,
  grant: { memberId: 'owner-a', roomId: 'room-a', streamId: 'stream-a', canRead: true, active: true } };

test('read/publish denial matrix enforces current account, room, period, scoped grant and original-owner deletion', () => {
  assert.equal(canReadMessage(actor, message), true);
  assert.equal(canPublishSource(actor, message), true);
  for (const field of ['accountActive', 'soopLinked', 'roomActive', 'memberActive', 'periodActive']) {
    assert.equal(canReadMessage({ ...actor, [field]: false }, message), false, field);
    assert.equal(canPublishSource({ ...actor, [field]: false }, message), false, field);
  }
  for (const update of [{ memberRoomId: 'room-b' }, { roomId: 'room-b' }]) {
    assert.equal(canReadMessage({ ...actor, ...update }, message), false);
    assert.equal(canPublishSource({ ...actor, ...update }, message), false);
  }
  for (const update of [{ roomId: 'room-b' }, { streamRoomId: 'room-b' }, { deleted: true }, { moderated: true }, { deletionRootBlocked: true }]) {
    assert.equal(canReadMessage(actor, { ...message, ...update }), false);
    assert.equal(canPublishSource(actor, { ...message, ...update }), false);
  }
  for (const grant of [null, { ...message.grant, active: false }, { ...message.grant, canRead: false },
    { ...message.grant, memberId: 'fan-a' }, { ...message.grant, roomId: 'room-b' }, { ...message.grant, streamId: 'other-private-stream-in-room-a' }]) {
    assert.equal(canReadMessage(actor, { ...message, grant }), false);
    assert.equal(canPublishSource(actor, { ...message, grant }), true);
  }
  assert.equal(canReadMessage(actor, { ...message, order: 9n }), false);
  assert.equal(canPublishSource(actor, { ...message, order: 9n, grant: null }), true);
  for (const update of [{ role: 'FAN' }, { role: 'MEMBER' }, { ownerMemberId: null }, { ownerMemberId: 'other-owner' }]) {
    assert.equal(canPublishSource({ ...actor, ...update }, message), false);
  }
  const shared = { ...message, streamKind: 'ROOM_SHARED', grant: null };
  assert.equal(canReadMessage({ ...actor, role: 'FAN' }, shared), true);
  assert.equal(canReadMessage({ ...actor, role: 'MEMBER' }, shared), true);
  assert.equal(canPublishSource(actor, shared), false);
});

test('profile validation accepts month/day only including leap day and bounds normalized nicknames', () => {
  assert.deepEqual(validBirthday(2, 29), { month: 2, day: 29 });
  assert.equal(validBirthday(null, null), null);
  for (const pair of [[2, 30], [4, 31], [0, 1], [13, 1], [1, 0], [1, 32], [1.5, 1], ['2', 3], [null, 1], [undefined, undefined]]) {
    assert.throws(() => validBirthday(...pair));
  }
  assert.equal(nickname('  합성 사용자  '), '합성 사용자');
  assert.equal(nickname('e\u0301'), 'é');
  assert.equal(nickname('가'.repeat(40)).length, 40);
  for (const value of ['', ' ', '가'.repeat(41), 'a\nb', 'a\u200bb', 5, null]) assert.throws(() => nickname(value));
});
