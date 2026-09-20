import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createUser, createRoom, joinRoom, leaveRoom, sendMessage, sendInput, getMessage, requestPublication, publishText, publicationStatus, Jobs } from '../support/domain-fixture.mjs';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { AccessService } from '../../dist/modules/access/access.service.js';
import { MembershipRepository } from '../../dist/modules/access/membership.repository.js';
import { MessagesQueryService } from '../../dist/modules/messages/messages-query.service.js';
import { MessagesQueryRepository } from '../../dist/modules/messages/messages-query.repository.js';
import { MessageEligibilityService } from '../../dist/modules/messages/message-eligibility.service.js';
import { MessageEligibilityRepository } from '../../dist/modules/messages/message-eligibility.repository.js';

async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api')); t.after(() => db.close());
  const people = await db.transactions.write(async tx => {
    const result = [];
    for (const name of ['방장', '팬', '다른 팬']) {
      const id = await createUser(tx, name);
      await tx.execute('INSERT INTO platform_soop (id,user_id,provider_subject,verified_at) VALUES (?,?,?,UTC_TIMESTAMP(3))', [randomUUID(), id, Buffer.from(randomUUID())]);
      result.push({ id });
    }
    const room = await createRoom(tx, 'C05 합성 테스트', 'FAN');
    for (const person of result) person.actor = await joinRoom(tx, room, person.id);
    await tx.execute("UPDATE room_members SET role='STREAMER' WHERE id=?", [result[0].actor]);
    await tx.execute('UPDATE rooms SET owner_member_id=? WHERE id=?', [result[0].actor, room]);
    return { room, owner: result[0], fan: result[1], other: result[2] };
  });
  const access = new AccessService(new MembershipRepository());
  const query = new MessagesQueryService(new MessagesQueryRepository(), new MessageEligibilityService(new MessageEligibilityRepository()));
  const key = randomBytes(32);
  const send = (who, target) => db.transactions.write(tx => sendMessage(tx, people.room, who.id, sendInput({ clientMessageId: randomUUID(),
    intent: target ? 'PRIVATE' : 'SHARED', ...(target ? { recipientActorId: target.actor } : {}), content: { type: 'TEXT', text: '합성 본문' } }), key));
  const get = (who, id) => db.transactions.read(tx => getMessage(tx, people.room, who.id, id));
  return { db, ...people, query, access, send, get };
}

test('C05 real GET/snapshot/history/event projection parity and stale private actions after grant revocation/rejoin', { timeout: 20000 }, async t => {
  const f = await fixture(t), sent = await f.send(f.owner, f.fan);
  const before = await f.get(f.owner, sent.messageId);
  assert.deepEqual(before.counterpart, { actorId: f.fan.actor });
  assert.deepEqual(before.allowedActions, { reply: true, publish: true, delete: true });
  await assert.rejects(f.get(f.other, sent.messageId), { code: 'NOT_FOUND' });
  await f.db.transactions.read(async tx => {
    const viewer = await f.access.requireActiveMember(tx, f.room, f.owner.id);
    const single = await getMessage(tx, f.room, f.owner.id, sent.messageId);
    for (const window of [{ kind: 'snapshot', from: '999' }, { kind: 'history', from: '999' }, { kind: 'events', from: '0', high: '999' }]) {
      const page = await f.query.page(tx, viewer, window, 100);
      assert.deepEqual(page.items.find(item => item.id === sent.messageId).message, single);
    }
  });
  await f.db.transactions.write(tx => tx.prisma.stream_grants.updateMany({ where: { room_id: f.room, member_id: f.owner.actor }, data: { can_send: false } }));
  const after = await f.get(f.owner, sent.messageId);
  assert.equal(after.version, before.version); assert.equal(after.counterpart, null);
  assert.deepEqual(after.allowedActions, { reply: false, publish: true, delete: true });
  await assert.rejects(f.send(f.owner, f.fan), { code: 'FORBIDDEN' });
  await f.db.transactions.write(tx => leaveRoom(tx, f.room, f.fan.id));
  await f.db.transactions.write(tx => joinRoom(tx, f.room, f.fan.id));
  assert.equal((await f.get(f.owner, sent.messageId)).counterpart, null);
  await assert.rejects(f.send(f.owner, f.fan), { code: 'FORBIDDEN' });
});

test('C05 shared/nonpair/cross-room privacy and current peer account/SOOP eligibility', { timeout: 20000 }, async t => {
  const f = await fixture(t), shared = await f.send(f.owner), sent = await f.send(f.owner, f.fan);
  const ownShared = await f.get(f.owner, shared.messageId);
  assert.equal(ownShared.counterpart, null); assert.equal(ownShared.allowedActions.reply, false);
  assert.equal((await f.get(f.fan, shared.messageId)).allowedActions.reply, true);
  const foreignRoom = await f.db.transactions.write(async tx => {
    const id = await createRoom(tx, '타 방', 'FAN'); await joinRoom(tx, id, f.owner.id); return id;
  });
  await assert.rejects(f.db.transactions.read(tx => getMessage(tx, foreignRoom, f.owner.id, sent.messageId)), { code: 'NOT_FOUND' });
  for (const field of ['soop', 'account']) {
    await f.db.transactions.write(tx => field === 'soop'
      ? tx.prisma.platform_soop.updateMany({ where: { user_id: f.fan.id }, data: { status: 'REVOKED' } })
      : tx.prisma.users.updateMany({ where: { id: f.fan.id }, data: { status: 'DELETING' } }));
    assert.equal((await f.get(f.owner, sent.messageId)).counterpart, null);
    await f.db.transactions.write(tx => field === 'soop'
      ? tx.prisma.platform_soop.updateMany({ where: { user_id: f.fan.id }, data: { status: 'VERIFIED' } })
      : tx.prisma.users.updateMany({ where: { id: f.fan.id }, data: { status: 'ACTIVE' } }));
  }
  await f.db.transactions.write(tx => tx.prisma.stream_pairs.deleteMany({ where: { room_id: f.room } }));
  const nonpair = await f.get(f.owner, sent.messageId);
  assert.equal(nonpair.counterpart, null); assert.equal(nonpair.allowedActions.reply, false);
});

test('C05 anonymous copy reveals no counterpart or identity and delete belongs to publisher rather than source fan', { timeout: 20000 }, async t => {
  const f = await fixture(t), source = await f.send(f.fan, f.owner);
  const publication = await f.db.transactions.write(tx => requestPublication(tx, f.room, f.owner.id, source.messageId));
  const queue = new Jobs(f.db.transactions, 'worker');
  const leases = await queue.claim({ purposes: ['PUBLICATION'] });
  const lease = leases.find(item => item.resourceId === publication.publicationId); assert.ok(lease);
  assert.equal(await publishText(f.db.transactions, lease), 'completed');
  const status = await f.db.transactions.read(tx => publicationStatus(tx, f.room, f.owner.id, publication.publicationId));
  for (const viewer of [f.owner, f.fan, f.other]) {
    const dto = await f.get(viewer, status.messageId);
    assert.deepEqual(dto.author, { kind: 'anonymous' }); assert.equal(dto.counterpart, null);
    assert.deepEqual(dto.allowedActions, { reply: false, publish: false, delete: viewer === f.owner });
    for (const secret of [source.messageId, f.fan.id, f.fan.actor, f.owner.id, f.owner.actor]) assert.equal(JSON.stringify(dto).includes(secret), false);
  }
});
