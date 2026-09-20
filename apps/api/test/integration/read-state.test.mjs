import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { createUser, createRoom, joinRoom, leaveRoom, sendMessage, sendInput, deleteMessage, nextOrder } from '../support/domain-fixture.mjs';
import { ReadStateCoreModule } from '../../dist/modules/read-state/read-state-core.module.js';
import { ReadStateCoreService } from '../../dist/modules/read-state/read-state-core.service.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';

async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api'));
  const context = await NestFactory.createApplicationContext(ReadStateCoreModule, { logger: false, abortOnError: false });
  t.after(async () => { await context.close(); await db.close(); });
  const core = context.get(ReadStateCoreService), key = randomBytes(32), audience = 'read-state-fixture';
  const sessions = new SessionService(new SessionRepository(), audience, key);
  const user = () => db.transactions.write(async tx => {
    const id = await createUser(tx, '읽음 합성 계정');
    await tx.execute('INSERT INTO platform_soop (id,user_id,provider_subject,verified_at) VALUES (?,?,?,UTC_TIMESTAMP(3))', [randomUUID(), id, Buffer.from(`fixture-${randomUUID()}`)]);
    return { id, ...await sessions.issue(tx, id) };
  });
  const owner = await user(), a = await user(), b = await user(), outside = await user();
  const room = await db.transactions.write(async tx => {
    const id = await createRoom(tx, '읽음 합성 방', 'GROUP');
    for (const person of [owner, a, b]) person.actor = await joinRoom(tx, id, person.id);
    return id;
  });
  const authenticated = (person, writable, action) => db.transactions[writable ? 'write' : 'read'](async tx => {
    const principal = await sessions.require(tx, person.token, writable ? person.csrf : undefined, true);
    return action(tx, { key, audience, sessionId: principal.sessionId });
  });
  const get = (person, roomId = room) => authenticated(person, false, (tx, binding) => core.get(tx, roomId, person.id, binding));
  const put = (person, messageId, readContext, roomId = room) => authenticated(person, true, (tx, binding) => core.put(tx, roomId, person.id, { messageId, readContext }, binding));
  const send = (person, target) => authenticated(person, true, tx => sendMessage(tx, room, person.id, sendInput({ clientMessageId: randomUUID(), intent: target ? 'PRIVATE' : 'SHARED', ...(target ? { recipientActorId: target.actor } : {}), content: { type: 'TEXT', text: '실제 표시 진행 테스트' } }), key));
  const remove = (person, messageId) => deleteMessage(db.transactions, room, person.id, messageId,
    tx => sessions.require(tx, person.token, person.csrf, true));
  return { db, core, sessions, owner, a, b, outside, room, authenticated, get, put, send, remove };
}
const denied = promise => assert.rejects(promise, { code: 'NOT_FOUND' });

test('two sessions advance persisted own state monotonically without transferring another account state', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const second = { id: f.a.id, ...await f.db.transactions.write(tx => f.sessions.issue(tx, f.a.id)) };
  const firstContext = (await f.get(f.a)).readContext, secondContext = (await f.get(second)).readContext;
  assert.notEqual(firstContext, secondContext);
  const older = (await f.send(f.owner)).messageId, newer = (await f.send(f.owner)).messageId;
  await Promise.all([f.put(second, newer, secondContext), f.put(f.a, older, firstContext)]);
  assert.deepEqual((await f.get(f.a)).items, [{ messageId: newer }]);
  assert.deepEqual(await f.put(f.a, older, firstContext), { messageId: newer });
  assert.deepEqual((await f.get(f.b)).items, []);
  await assert.rejects(f.put(f.b, newer, firstContext), { code: 'CONFLICT' });
  await assert.rejects(f.put(second, newer, firstContext), { code: 'CONFLICT' });
  const result = await f.get(f.a);
  assert.deepEqual(Object.keys(result).sort(), ['items', 'readContext']);
  assert.deepEqual(Object.keys(result.items[0]), ['messageId']);
  for (const secret of [f.a.id, f.a.actor, 'last_read_order', 'stream_id', 'period_id']) assert.ok(!JSON.stringify(result).includes(secret));
  const rows = await f.db.transactions.read(tx => tx.prisma.own_read_states.findMany({ where: { member_id: f.a.actor }, select: { last_read_order: true } }));
  assert.equal(rows.length, 1);
  const storedMessage = await f.db.transactions.read(tx => tx.prisma.messages.findUnique({ where: { id: newer }, select: { created_order: true } }));
  assert.equal(rows[0].last_read_order, storedMessage.created_order);
});

test('private streams stay independent; revoked grants, deleted messages and unrelated rooms reveal no saved UUID', { timeout: 20000 }, async t => {
  const f = await fixture(t), scope = (await f.get(f.a)).readContext;
  const shared = (await f.send(f.owner)).messageId, privateA = (await f.send(f.owner, f.a)).messageId;
  const privateB = (await f.send(f.owner, f.b)).messageId;
  await f.put(f.a, shared, scope); await f.put(f.a, privateA, scope);
  assert.deepEqual(new Set((await f.get(f.a)).items.map(row => row.messageId)), new Set([shared, privateA]));
  await denied(f.put(f.a, privateB, scope)); await denied(f.get(f.outside));
  const otherRoom = await f.db.transactions.write(async tx => { const id = await createRoom(tx, '다른 합성 방', 'GROUP'); await joinRoom(tx, id, f.a.id); return id; });
  await denied(f.put(f.a, privateA, (await f.get(f.a, otherRoom)).readContext, otherRoom));
  await f.db.transactions.write(tx => tx.execute('UPDATE stream_grants SET revoked_at=UTC_TIMESTAMP(3) WHERE member_id=?', [f.a.actor]));
  assert.deepEqual((await f.get(f.a)).items, [{ messageId: shared }]);
  await denied(f.put(f.a, privateA, scope));
  await f.remove(f.owner, shared);
  assert.deepEqual((await f.get(f.a)).items, []); await denied(f.put(f.a, shared, scope));
});

test('deleted high-water message is hidden without regression on delayed lower update', { timeout: 20000 }, async t => {
  const f = await fixture(t), scope = (await f.get(f.a)).readContext;
  const old = (await f.send(f.owner)).messageId, latest = (await f.send(f.owner)).messageId;
  await f.put(f.a, latest, scope); await f.remove(f.owner, latest);
  assert.deepEqual(await f.put(f.a, old, scope), { messageId: null });
  assert.deepEqual((await f.get(f.a)).items, []);
  const fresh = (await f.send(f.owner)).messageId;
  assert.deepEqual(await f.put(f.a, fresh, scope), { messageId: fresh });
});

test('leave/rejoin rejects queued old context even with all-history visibility and resets the stored period', { timeout: 20000 }, async t => {
  const f = await fixture(t), oldScope = (await f.get(f.a)).readContext;
  const old = (await f.send(f.owner)).messageId, latest = (await f.send(f.owner)).messageId;
  await f.put(f.a, latest, oldScope);
  await f.db.transactions.write(tx => leaveRoom(tx, f.room, f.a.id));
  await denied(f.get(f.a)); await denied(f.put(f.a, old, oldScope));
  await f.db.transactions.write(async tx => {
    await tx.execute("UPDATE rooms SET history_policy='ALL_AVAILABLE' WHERE id=?", [f.room]);
    await joinRoom(tx, f.room, f.a.id);
  });
  const state = await f.get(f.a);
  assert.deepEqual(state.items, []); assert.notEqual(state.readContext, oldScope);
  await assert.rejects(f.put(f.a, old, oldScope), { code: 'CONFLICT' });
  assert.deepEqual(await f.put(f.a, old, state.readContext), { messageId: old });
  assert.deepEqual((await f.get(f.a)).items, [{ messageId: old }]);
});

test('read-state rollback, source deletion fence, revoked session and account purge remain transaction-scoped', { timeout: 20000 }, async t => {
  const f = await fixture(t), scope = (await f.get(f.a)).readContext;
  const source = (await f.send(f.owner, f.a)).messageId;
  const published = await f.db.transactions.write(async tx => {
    const stream = await tx.prisma.message_streams.findFirst({ where: { room_id: f.room, kind: 'ROOM_SHARED' }, select: { id: true } });
    const id = randomUUID(), order = await nextOrder(tx, f.room);
    await tx.execute('INSERT INTO messages (id,room_id,stream_id,sender_member_id,content_owner_user_id,deletion_root_id,text_content,created_order) VALUES (?,?,?,?,?,?,?,?)', [id, f.room, stream.id, f.owner.actor, f.owner.id, source, '합성 공개', String(order)]);
    return id;
  });
  await assert.rejects(f.authenticated(f.a, true, async (tx, binding) => {
    await f.core.put(tx, f.room, f.a.id, { messageId: published, readContext: scope }, binding);
    throw new Error('rollback-state');
  }), /rollback-state/);
  assert.deepEqual((await f.get(f.a)).items, []);
  await f.put(f.a, published, scope); await f.put(f.a, source, scope);
  const bScope = (await f.get(f.b)).readContext;
  await f.put(f.b, published, bScope);
  await f.remove(f.owner, source);
  assert.deepEqual((await f.get(f.a)).items, []); await denied(f.put(f.a, published, scope));
  await f.db.transactions.write(tx => tx.execute("UPDATE users SET status='DELETING' WHERE id=?", [f.a.id]));
  await assert.rejects(f.get(f.a), { code: 'UNAUTHENTICATED' });
  let result = await f.db.transactions.write(tx => f.core.purgeAccount(tx, f.a.id, 1));
  assert.deepEqual(result, { deleted: 1, hasMore: true });
  result = await f.db.transactions.write(tx => f.core.purgeAccount(tx, f.a.id, 1));
  assert.deepEqual(result, { deleted: 1, hasMore: false });
  assert.deepEqual(await f.db.transactions.write(tx => f.core.purgeAccount(tx, f.a.id, 1)), { deleted: 0, hasMore: false });
  assert.equal(await f.db.transactions.read(tx => tx.prisma.own_read_states.count({ where: { member_id: f.b.actor } })), 1);
  await f.db.transactions.write(tx => tx.execute('UPDATE auth_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE user_id=?', [f.b.id]));
  await assert.rejects(f.put(f.b, published, bScope), { code: 'UNAUTHENTICATED' });
});

test('recent snapshot is bounded at 100 candidates and omits hidden progress without leaking its stream', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const messages = await f.db.transactions.write(async tx => {
    const member = await tx.prisma.room_members.findUnique({ where: { id: f.a.actor }, select: { active_period_id: true } });
    const floor = await nextOrder(tx, f.room), now = await tx.now();
    const entries = Array.from({ length: 101 }, (_, index) => ({ stream: randomUUID(), message: randomUUID(), order: floor + BigInt(index + 1), updated: new Date(now.getTime() + index) }));
    await tx.prisma.message_streams.createMany({ data: entries.map(row => ({ id: row.stream, room_id: f.room, kind: 'RESTRICTED' })) });
    await tx.prisma.stream_grants.createMany({ data: entries.map(row => ({ id: randomUUID(), room_id: f.room, stream_id: row.stream, member_id: f.a.actor, can_read: true })) });
    await tx.prisma.messages.createMany({ data: entries.map(row => ({ id: row.message, room_id: f.room, stream_id: row.stream, sender_member_id: f.owner.actor, content_owner_user_id: f.owner.id, text_content: '범위 합성 메시지', created_order: row.order })) });
    await tx.prisma.own_read_states.createMany({ data: entries.map(row => ({ member_id: f.a.actor, stream_id: row.stream, room_id: f.room, period_id: member.active_period_id, last_read_order: row.order, updated_at: row.updated })) });
    return entries;
  });
  const result = await f.get(f.a);
  assert.equal(result.items.length, 100);
  assert.deepEqual(result.items.map(row => row.messageId), messages.slice(1).reverse().map(row => row.message));
  await f.db.transactions.write(tx => tx.prisma.messages.update({ where: { id: messages.at(-1).message }, data: { moderated: true } }));
  const hidden = await f.get(f.a);
  assert.equal(hidden.items.length, 99);
  assert.ok(!JSON.stringify(hidden).includes(messages.at(-1).message));
  assert.ok(!JSON.stringify(hidden).includes(messages[0].message));
});

test('leave and message deletion races cannot authorize post-commit stale state', { timeout: 20000 }, async t => {
  const f = await fixture(t), scope = (await f.get(f.a)).readContext;
  const message = (await f.send(f.owner)).messageId;
  const deletion = await Promise.allSettled([f.put(f.a, message, scope), f.remove(f.owner, message)]);
  assert.equal(deletion[1].status, 'fulfilled');
  if (deletion[0].status === 'rejected') assert.equal(deletion[0].reason.code, 'NOT_FOUND');
  assert.deepEqual((await f.get(f.a)).items, []);
  await denied(f.put(f.a, message, scope));
  const next = (await f.send(f.owner)).messageId;
  const leaving = await Promise.allSettled([f.put(f.a, next, scope), f.db.transactions.write(tx => leaveRoom(tx, f.room, f.a.id))]);
  assert.equal(leaving[1].status, 'fulfilled');
  if (leaving[0].status === 'rejected') assert.equal(leaving[0].reason.code, 'NOT_FOUND');
  await denied(f.get(f.a));
  await f.db.transactions.write(tx => joinRoom(tx, f.room, f.a.id));
  assert.deepEqual((await f.get(f.a)).items, []);
  await assert.rejects(f.put(f.a, next, scope), { code: 'CONFLICT' });
});
