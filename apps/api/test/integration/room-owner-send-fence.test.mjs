import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaDatabase } from '../../dist/infrastructure/database/database.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { createUser, createRoom, joinRoom, assignRoomOwner, sendMessage, sendInput, getMessage, deleteMessage } from '../support/domain-fixture.mjs';

async function fixture(t, mode) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new PrismaDatabase(readConfig('api')), other = new PrismaDatabase(readConfig('api'));
  t.after(async () => { await db.close(); await other.close(); });
  const key = randomBytes(32);
  const state = await db.transactions.write(async tx => {
    const owner = await createUser(tx, '합성 방장'), author = await createUser(tx, '합성 작성자'), peer = await createUser(tx, '합성 동료');
    for (const id of [owner, author, peer]) await tx.prisma.platform_soop.create({ data: { id: randomUUID(), user_id: id, provider_subject: randomBytes(24), verified_at: await tx.now() }, select: { id: true } });
    const room = await createRoom(tx, '합성 방장 탈퇴 경합', mode);
    const ownerActor = await joinRoom(tx, room, owner), authorActor = await joinRoom(tx, room, author), peerActor = await joinRoom(tx, room, peer);
    await assignRoomOwner(tx, room, ownerActor);
    // FAN fan-to-streamer traffic independent of the departing sole room owner.
    await tx.prisma.room_members.update({ where: { id: peerActor }, data: { role: 'STREAMER' }, select: { id: true } });
    return { owner, author, peer, room, ownerActor, authorActor, peerActor };
  });
  const input = () => sendInput({ clientMessageId: randomUUID(), intent: mode === 'FAN' ? 'PRIVATE' : 'SHARED',
    ...(mode === 'FAN' ? { recipientActorId: state.peerActor } : {}), content: { type: 'TEXT', text: '독립 작성자의 합성 내용' } });
  const send = (tx, body) => sendMessage(tx, state.room, state.author, body, key);
  const status = (tx, value) => tx.prisma.users.update({ where: { id: state.owner }, data: { status: value }, select: { id: true } });
  const inspect = () => db.transactions.read(async tx => ({
    messages: await tx.prisma.messages.count({ where: { room_id: state.room } }),
    receipts: await tx.prisma.command_receipts.count({ where: { room_id: state.room } }),
    events: await tx.prisma.room_events.count({ where: { room_id: state.room } }),
    jobs: await tx.prisma.jobs.count({ where: { room_id: state.room } }),
    counter: await tx.prisma.room_counters.findUnique({ where: { room_id: state.room }, select: { last_order: true } }),
    room: await tx.prisma.rooms.findUnique({ where: { id: state.room }, select: { status: true, owner_member_id: true } }),
    members: await tx.prisma.room_members.findMany({ where: { room_id: state.room }, orderBy: { id: 'asc' }, select: { id: true, role: true, status: true } }),
  }));
  return { db, other, ...state, input, send, status, inspect };
}
const connection = async tx => (await tx.rows('SELECT CONNECTION_ID() AS id'))[0].id;

for (const mode of ['GROUP', 'FAN']) {
  test(`${mode}: owner deletion wins before send, including an older RR snapshot`, async t => {
    const f = await fixture(t, mode), before = await f.inspect();
    await assert.rejects(f.db.transactions.write(async tx => {
      const id = await connection(tx);
      assert.equal((await tx.prisma.users.findUnique({ where: { id: f.owner }, select: { status: true } })).status, 'ACTIVE');
      await f.other.transactions.write(async other => { assert.notEqual(await connection(other), id); await f.status(other, 'DELETING'); });
      assert.equal((await tx.prisma.users.findUnique({ where: { id: f.owner }, select: { status: true } })).status, 'ACTIVE');
      return f.send(tx, f.input());
    }), { code: 'NOT_FOUND' });
    assert.deepEqual(await f.inspect(), before);
  });

  test(`${mode}: send waits for in-flight owner deletion and denies after its commit`, async t => {
    const f = await fixture(t, mode), before = await f.inspect();
    const held = Promise.withResolvers(), release = Promise.withResolvers(), attempting = Promise.withResolvers();
    let firstId, settled = false;
    const deletion = f.other.transactions.write(async tx => {
      firstId = await connection(tx); await f.status(tx, 'DELETING'); held.resolve(); await release.promise;
    });
    await held.promise;
    const send = assert.rejects(f.db.transactions.write(async tx => {
      assert.notEqual(await connection(tx), firstId); attempting.resolve();
      return f.send(tx, f.input());
    }), { code: 'NOT_FOUND' }).finally(() => { settled = true; });
    try { await attempting.promise; await delay(60); assert.equal(settled, false); }
    finally { release.resolve(); }
    await Promise.all([deletion, send]);
    assert.deepEqual(await f.inspect(), before);
  });

  test(`${mode}: in-flight send holds owner fence until commit, then new sends stop`, async t => {
    const f = await fixture(t, mode), body = f.input();
    const held = Promise.withResolvers(), release = Promise.withResolvers(), attempting = Promise.withResolvers();
    let firstId, changed = false;
    const first = f.db.transactions.write(async tx => {
      firstId = await connection(tx);
      const ack = await f.send(tx, body); held.resolve(); await release.promise; return ack;
    });
    await held.promise;
    const deletion = f.other.transactions.write(async tx => {
      assert.notEqual(await connection(tx), firstId); attempting.resolve();
      await f.status(tx, 'DELETING'); changed = true;
    });
    try { await attempting.promise; await delay(60); assert.equal(changed, false); }
    finally { release.resolve(); }
    const [ack] = await Promise.all([first, deletion]);
    assert.equal(ack.status, 'committed');
    assert.deepEqual(await f.db.transactions.write(tx => f.send(tx, body)), ack);
    const before = await f.inspect();
    await assert.rejects(f.db.transactions.write(tx => f.send(tx, f.input())), { code: 'NOT_FOUND' });
    assert.deepEqual(await f.inspect(), before);
    assert.equal(before.messages, 1); assert.equal(before.receipts, 1); assert.equal(before.events, 1);
  });

  test(`${mode}: deleting/deleted owner preserves independent history, receipt conflicts and author deletion`, async t => {
    const f = await fixture(t, mode), body = f.input();
    const ack = await f.db.transactions.write(tx => f.send(tx, body));
    for (const state of ['DELETING', 'DELETED']) {
      await f.other.transactions.write(tx => f.status(tx, state));
      assert.equal((await f.db.transactions.read(tx => getMessage(tx, f.room, f.peer, ack.messageId))).content.text, body.content.text);
      assert.deepEqual(await f.db.transactions.write(tx => f.send(tx, body)), ack);
      await assert.rejects(f.db.transactions.write(tx => f.send(tx, { ...body, content: { type: 'TEXT', text: 'changed' } })), { code: 'CONFLICT' });
      await assert.rejects(f.db.transactions.write(tx => f.send(tx, f.input())), { code: 'NOT_FOUND' });
    }
    await deleteMessage(f.db.transactions, f.room, f.author, ack.messageId);
    const deleted = await f.db.transactions.write(tx => f.send(tx, body));
    assert.equal(deleted.status, 'deleted');
    assert.equal(deleted.messageId, ack.messageId);
    await assert.rejects(f.db.transactions.read(tx => getMessage(tx, f.room, f.peer, ack.messageId)), { code: 'NOT_FOUND' });
    const after = await f.inspect();
    assert.equal(after.messages, 1); assert.equal(after.receipts, 1);
    assert.deepEqual(after.room, { status: 'ACTIVE', owner_member_id: f.ownerActor });
    assert.equal(after.members.find(m => m.id === f.authorActor).role, mode === 'FAN' ? 'FAN' : 'MEMBER');
  });

  test(`${mode}: suspension is not departure; missing or invalid owner denies only new sends`, async t => {
    const f = await fixture(t, mode);
    await f.other.transactions.write(tx => f.status(tx, 'SUSPENDED'));
    const body = f.input(), ack = await f.db.transactions.write(tx => f.send(tx, body));
    await f.db.transactions.write(tx => tx.prisma.room_members.update({ where: { id: f.ownerActor }, data: { role: 'MEMBER' }, select: { id: true } }));
    await assert.rejects(f.db.transactions.write(tx => f.send(tx, f.input())), { code: 'NOT_FOUND' });
    await f.db.transactions.write(tx => tx.prisma.rooms.update({ where: { id: f.room }, data: { owner_member_id: null }, select: { id: true } }));
    await assert.rejects(f.db.transactions.write(tx => f.send(tx, f.input())), { code: 'NOT_FOUND' });
    assert.deepEqual(await f.db.transactions.write(tx => f.send(tx, body)), ack);
    assert.equal((await f.inspect()).room.owner_member_id, null);
  });
}

test('changed owner pointer cannot authorize send from an old discovery snapshot', async t => {
  const f = await fixture(t, 'GROUP');
  await assert.rejects(f.db.transactions.write(async tx => {
    await tx.prisma.rooms.findUnique({ where: { id: f.room }, select: { owner_member_id: true } });
    await f.other.transactions.write(other => other.prisma.rooms.update({ where: { id: f.room }, data: { owner_member_id: f.peerActor }, select: { id: true } }));
    return f.send(tx, f.input());
  }), { code: 'CONFLICT' });
  assert.equal((await f.inspect()).messages, 0);
});
