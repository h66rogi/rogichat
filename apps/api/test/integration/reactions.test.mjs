import { createUser, createRoom, joinRoom, leaveRoom, nextOrder, sendMessage, sendInput, deleteMessage, readReactions, setReaction } from '../support/domain-fixture.mjs';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';

async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api'));
  t.after(() => db.close());
  const key = randomBytes(32); const sessions = new SessionService(new SessionRepository(), 'reactions-fixture', key);
  const user = name => db.transactions.write(async tx => {
    const id = await createUser(tx, name);
    await tx.execute('INSERT INTO platform_soop (id,user_id,provider_subject,verified_at) VALUES (?,?,?,UTC_TIMESTAMP(3))', [randomUUID(), id, Buffer.from(`fixture-${randomUUID()}`)]);
    return { id, ...await sessions.issue(tx, id) };
  });
  const owner = await user('반응 방장'), a = await user('반응 팬 하나'), b = await user('반응 팬 둘'), outside = await user('반응 외부인');
  const room = await db.transactions.write(async tx => {
    const id = await createRoom(tx, '반응 합성방', 'FAN');
    for (const person of [owner, a, b]) person.actor = await joinRoom(tx, id, person.id);
    await tx.execute("UPDATE room_members SET role='STREAMER' WHERE id=?", [owner.actor]);
    await tx.execute('UPDATE rooms SET owner_member_id=? WHERE id=?', [owner.actor, id]);
    return id;
  });
  const authenticated = (person, writable, action) => db.transactions[writable ? 'write' : 'read'](async tx => {
    await sessions.require(tx, person.token, writable ? person.csrf : undefined, true);
    return action(tx);
  });
  const send = (person, target) => authenticated(person, true, tx => sendMessage(tx, room, person.id, sendInput({ clientMessageId: randomUUID(), intent: target ? 'PRIVATE' : 'SHARED', ...(target ? { recipientActorId: target.actor } : {}), content: { type: 'TEXT', text: '반응용 합성 메시지' } }), key));
  const set = (person, messageId, emoji, roomId = room) => authenticated(person, true, tx => setReaction(tx, roomId, person.id, messageId, emoji));
  const read = (person, messageId, roomId = room) => authenticated(person, false, tx => readReactions(tx, roomId, person.id, messageId));
  const remove = (person, messageId) => authenticated(person, true, tx => deleteMessage(tx, room, person.id, messageId));
  return { db, sessions, owner, a, b, outside, room, authenticated, send, set, read, remove };
}
const denied = promise => assert.rejects(promise, { code: 'NOT_FOUND' });
const counts = result => Object.fromEntries(result.counts.map(entry => [entry.emoji, entry.count]));

test('one reaction per member, replacement/removal and same-value retries atomically emit only real changes', { timeout: 20000 }, async t => {
  const f = await fixture(t); const { messageId } = await f.send(f.owner);
  assert.deepEqual(await f.read(f.a, messageId), { counts: [], mine: null });
  const replies = await Promise.all(Array.from({ length: 4 }, () => f.set(f.a, messageId, '😀')));
  for (const reply of replies) assert.deepEqual(reply, { counts: [{ emoji: '😀', count: 1 }], mine: '😀' });
  await f.set(f.b, messageId, '😂');
  let summary = await f.read(f.a, messageId);
  assert.deepEqual(counts(summary), { '😀': 1, '😂': 1 }); assert.equal(summary.mine, '😀');
  const inspect = () => f.db.transactions.read(async tx => ({
    message: (await tx.rows('SELECT version FROM messages WHERE id=?', [messageId]))[0],
    rows: await tx.rows('SELECT * FROM message_reactions WHERE message_id=?', [messageId]),
    events: await tx.rows('SELECT kind FROM room_events WHERE message_id=?', [messageId]),
    jobs: await tx.rows("SELECT id FROM jobs WHERE room_id=? AND purpose='REALTIME_HINT'", [f.room]),
  }));
  let stored = await inspect(); assert.equal(String(stored.message.version), '3');
  assert.equal(stored.rows.length, 2); assert.equal(stored.events.length, 3); assert.equal(stored.jobs.length, 3);
  assert.equal(stored.events.filter(event => event.kind === 'MESSAGE_UPDATED').length, 2);
  summary = await f.set(f.a, messageId, '👍🏽');
  assert.deepEqual(counts(summary), { '👍🏽': 1, '😂': 1 }); assert.equal(summary.mine, '👍🏽');
  await f.set(f.a, messageId, null); await f.set(f.a, messageId, null);
  stored = await inspect(); assert.equal(String(stored.message.version), '5'); assert.equal(stored.rows.length, 1);
  assert.equal(stored.events.length, 5); assert.equal(stored.jobs.length, 5);
  summary = await f.read(f.owner, messageId);
  assert.deepEqual(Object.keys(summary).sort(), ['counts', 'mine']); assert.equal(summary.mine, null);
  for (const forbidden of [f.a.id, f.a.actor, f.b.id, f.b.actor, 'memberId', 'userId']) assert.ok(!JSON.stringify(summary).includes(forbidden));
});

test('binary emoji grouping preserves modifiers/presentation; deleting reactors vanish without deleting other counts', { timeout: 20000 }, async t => {
  const f = await fixture(t); const { messageId } = await f.send(f.owner);
  await f.set(f.a, messageId, '👍'); await f.set(f.b, messageId, '👍🏽'); await f.set(f.owner, messageId, '❤️');
  assert.deepEqual(counts(await f.read(f.owner, messageId)), { '👍': 1, '👍🏽': 1, '❤️': 1 });
  await f.db.transactions.write(tx => tx.execute("UPDATE users SET status='DELETING' WHERE id=?", [f.a.id]));
  assert.deepEqual(counts(await f.read(f.owner, messageId)), { '👍🏽': 1, '❤️': 1 });
  await f.db.transactions.write(tx => tx.execute("UPDATE users SET status='DELETED' WHERE id=?", [f.b.id]));
  assert.deepEqual(await f.read(f.owner, messageId), { counts: [{ emoji: '❤️', count: 1 }], mine: '❤️' });
});

test('private/current grant, room scope, active membership and scoped foreign keys guard reaction reads and writes', { timeout: 20000 }, async t => {
  const f = await fixture(t); const { messageId } = await f.send(f.a, f.owner);
  await f.set(f.a, messageId, '🇰🇷');
  for (const person of [f.b, f.outside]) { await denied(f.read(person, messageId)); await denied(f.set(person, messageId, '😀')); }
  const other = await f.db.transactions.write(async tx => { const id = await createRoom(tx, '반응 다른 방', 'GROUP'); const actor = await joinRoom(tx, id, f.a.id); return { id, actor }; });
  await denied(f.read(f.a, messageId, other.id)); await denied(f.set(f.a, messageId, '😀', other.id));
  // Isolate each scoped FK: valid message/wrong-room member, then valid member/wrong-room message.
  for (const [room, actor] of [[f.room, other.actor], [other.id, other.actor]]) {
    await assert.rejects(f.db.transactions.write(tx => tx.execute('INSERT INTO message_reactions (id,room_id,message_id,member_id,emoji) VALUES (?,?,?,?,?)', [randomUUID(), room, messageId, actor, '😀'])), error => error.code === 'P2003' || error.meta?.driverAdapterError?.cause?.kind === 'ForeignKeyConstraintViolation' || [1452, 1216].includes(error.meta?.driverAdapterError?.cause?.code));
  }
  await f.db.transactions.write(tx => tx.execute('UPDATE stream_grants SET revoked_at=UTC_TIMESTAMP(3) WHERE member_id=?', [f.a.actor]));
  await denied(f.read(f.a, messageId)); await denied(f.set(f.a, messageId, null));
  assert.equal((await f.read(f.owner, messageId)).counts[0].count, 1);
  await f.db.transactions.write(tx => leaveRoom(tx, f.room, f.a.id));
  await denied(f.read(f.a, messageId));
});

test('reaction rollback is atomic and root deletion wins every publication/reaction race after commit', { timeout: 20000 }, async t => {
  const f = await fixture(t); const { messageId: source } = await f.send(f.a, f.owner);
  const publication = await f.db.transactions.write(async tx => {
    const [stream] = await tx.rows("SELECT id FROM message_streams WHERE room_id=? AND kind='ROOM_SHARED'", [f.room]);
    const id = randomUUID(); const order = await nextOrder(tx, f.room);
    await tx.execute('INSERT INTO messages (id,room_id,stream_id,sender_member_id,content_owner_user_id,deletion_root_id,text_content,created_order) VALUES (?,?,?,?,?,?,?,?)', [id, f.room, stream.id, f.owner.actor, f.a.id, source, '익명 공개 반응', String(order)]);
    return id;
  });
  await assert.rejects(f.authenticated(f.b, true, async tx => { await setReaction(tx, f.room, f.b.id, publication, '😀'); throw new Error('reaction-rollback'); }), /reaction-rollback/);
  assert.deepEqual(await f.read(f.b, publication), { counts: [], mine: null });
  const [unchanged] = await f.db.transactions.read(tx => tx.rows('SELECT version FROM messages WHERE id=?', [publication]));
  assert.equal(String(unchanged.version), '1');
  const [events] = await f.db.transactions.read(tx => tx.rows('SELECT COUNT(*) AS total FROM room_events WHERE message_id=?', [publication]));
  assert.equal(Number(events.total), 0);
  // Prove the root-owner guard independently of the published row's direct owner.
  await f.db.transactions.write(tx => tx.execute('UPDATE messages SET content_owner_user_id=? WHERE id=?', [f.owner.id, publication]));
  await f.db.transactions.write(tx => tx.execute("UPDATE users SET status='DELETING' WHERE id=?", [f.a.id]));
  await denied(f.read(f.b, publication)); await denied(f.set(f.b, publication, '😀'));
  await f.db.transactions.write(tx => tx.execute("UPDATE users SET status='ACTIVE' WHERE id=?", [f.a.id]));
  const results = await Promise.allSettled([f.set(f.b, publication, '😀'), f.remove(f.a, source)]);
  assert.equal(results[1].status, 'fulfilled');
  if (results[0].status === 'rejected') assert.equal(results[0].reason.code, 'NOT_FOUND');
  await denied(f.read(f.b, publication)); await denied(f.set(f.b, publication, '😂')); await denied(f.set(f.b, publication, null));
  const [saved] = await f.db.transactions.read(tx => tx.rows('SELECT COUNT(*) AS total FROM message_reactions WHERE message_id=?', [publication]));
  assert.equal(Number(saved.total), results[0].status === 'fulfilled' ? 1 : 0);
});
