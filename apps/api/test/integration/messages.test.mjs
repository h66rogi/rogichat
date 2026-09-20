import { createUser, createRoom, joinRoom, nextOrder, sendInput, sendMessage } from '../support/domain-fixture.mjs';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { createApi } from '../../dist/application.js';
import { SafeLogger } from '../../dist/infrastructure/observability/logging.js';
import { responseContract } from '../support/openapi-response.mjs';

async function fixture(t, mode = 'FAN') {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api')); let app;
  t.after(async () => { try { await app?.close(); } finally { await db.close(); } });
  const config = { audience: 'messages-fixture', origin: 'http://localhost:3001', secure: false, key: randomBytes(32) };
  const sessions = new SessionService(new SessionRepository(), config.audience, config.key);
  const user = name => db.transactions.write(async tx => {
    const id = await createUser(tx, name);
    await tx.execute('INSERT INTO platform_soop (id,user_id,provider_subject,verified_at) VALUES (?,?,?,UTC_TIMESTAMP(3))', [randomUUID(), id, Buffer.from(`fixture-${randomUUID()}`)]);
    return { id, ...await sessions.issue(tx, id) };
  });
  const owner = await user('합성 방장'), fan1 = await user('합성 팬 하나'), fan2 = await user('합성 팬 둘'), outsider = await user('합성 외부인');
  const room = await db.transactions.write(async tx => {
    const id = await createRoom(tx, '메시지 합성방', mode);
    for (const person of [owner, fan1, fan2]) person.actor = await joinRoom(tx, id, person.id);
    await tx.execute("UPDATE room_members SET role='STREAMER' WHERE id=?", [owner.actor]);
    await tx.execute('UPDATE rooms SET owner_member_id=? WHERE id=?', [owner.actor, id]);
    return id;
  });
  let base, verify;
  const restart = async () => {
    await app?.close();
    app = await createApi(db, new SafeLogger('api', () => {}), undefined, { sessions, config });
    verify = responseContract(app, config);
    await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  };
  await restart();
  const call = async (who, method, path, body, headers = {}) => {
    const response = await fetch(`${base}/v1${path}`, { method, headers: {
      Origin: config.origin, ...(headers.Authorization ? {} : { Cookie: `rogi_session=${who.token}`, 'X-CSRF-Token': who.csrf }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers,
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = { status: response.status, body: response.status === 204 ? undefined : await response.json() };
    if (path.includes('/message-commands/')) verify(method, `/v1${path}`, result.status, result.body);
    return result;
  };
  const command = (text = '합성 본문', intent = 'SHARED', recipientActorId) => ({ clientMessageId: randomUUID(), intent,
    ...(recipientActorId ? { recipientActorId } : {}), content: { type: 'TEXT', text } });
  const send = (who, body) => call(who, 'POST', `/rooms/${room}/messages`, body);
  const get = (who, id) => call(who, 'GET', `/rooms/${room}/messages/${id}`);
  const remove = (who, id) => call(who, 'POST', `/rooms/${room}/messages/${id}/delete`, {});
  // Advance only this fixture's burst bucket between independent authorization phases.
  // Concurrent limit enforcement is separately tested across two real pools in rates.test.
  const nextBurst = who => db.transactions.write(tx => tx.execute('UPDATE rate_buckets SET expires_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE key_digest=?', [createHmac('sha256', config.key).update(`send:burst:${who.id}:${room}`).digest()]));
  return { db, sessions, config, owner, fan1, fan2, outsider, room, call, command, send, get, remove, restart, nextBurst };
}
const keys = value => Object.keys(value).sort();

test('same-key concurrent commands and API restart return one durable message, event, receipt and hint job', { timeout: 20000 }, async t => {
  const f = await fixture(t); const body = f.command();
  const replies = await Promise.all(Array.from({ length: 5 }, () => f.send(f.owner, body)));
  for (const reply of replies) { assert.equal(reply.status, 200); assert.deepEqual(reply.body, replies[0].body); }
  const ack = replies[0].body;
  assert.deepEqual(keys(ack), ['clientMessageId', 'messageId', 'status', 'version']);
  assert.equal(ack.status, 'committed');
  await f.restart();
  await f.nextBurst(f.owner);
  assert.deepEqual((await f.send(f.owner, body)).body, ack);
  assert.equal((await f.send(f.owner, { ...body, content: { type: 'TEXT', text: '다른 본문' } })).status, 409);
  assert.equal((await f.send(f.owner, { ...body, intent: 'PRIVATE', recipientActorId: f.fan1.actor })).status, 409);
  const stored = await f.db.transactions.read(async tx => ({
    messages: await tx.rows('SELECT * FROM messages WHERE room_id=?', [f.room]),
    receipts: await tx.rows('SELECT * FROM command_receipts WHERE room_id=?', [f.room]),
    events: await tx.rows('SELECT * FROM room_events WHERE room_id=?', [f.room]),
    jobs: await tx.rows('SELECT * FROM jobs WHERE room_id=?', [f.room]),
  }));
  for (const records of Object.values(stored)) assert.equal(records.length, 1);
  assert.equal(stored.receipts[0].payload_digest.length, 32);
  for (const records of [stored.receipts, stored.events, stored.jobs]) assert.ok(!JSON.stringify(records).includes(body.content.text));
  const view = await f.get(f.fan1, ack.messageId); assert.equal(view.status, 200);
  assert.deepEqual(keys(view.body), ['audience', 'author', 'content', 'createdAt', 'id', 'quote', 'version']);
  assert.deepEqual(keys(view.body.author), ['actorId', 'avatar', 'kind', 'nickname']);
  for (const forbidden of [f.owner.id, body.clientMessageId, stored.messages[0].stream_id]) assert.ok(!JSON.stringify(view.body).includes(forbidden));
});

test('FAN private audience, cross-room identifiers and expired/revoked grants fail closed without shared fallback', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  assert.equal((await f.send(f.fan1, f.command())).status, 403);
  assert.equal((await f.send(f.fan1, f.command('팬간 불허', 'PRIVATE', f.fan2.actor))).status, 403);
  assert.equal((await f.send(f.outsider, f.command('외부 불허', 'PRIVATE', f.owner.actor))).status, 404);
  const foreign = await f.db.transactions.write(async tx => {
    const room = await createRoom(tx, '타 방', 'FAN'); return joinRoom(tx, room, f.outsider.id);
  });
  assert.equal((await f.send(f.owner, f.command('타 방 불허', 'PRIVATE', foreign))).status, 404);
  const body = f.command('비공개 합성', 'PRIVATE', f.owner.actor);
  const sent = await f.send(f.fan1, body); assert.equal(sent.status, 200);
  for (const who of [f.fan1, f.owner]) assert.equal((await f.get(who, sent.body.messageId)).body.audience, 'PRIVATE');
  for (const who of [f.fan2, f.outsider]) assert.equal((await f.get(who, sent.body.messageId)).status, 404);
  const [stored] = await f.db.transactions.read(tx => tx.rows('SELECT stream_id FROM messages WHERE id=?', [sent.body.messageId]));
  await f.db.transactions.write(tx => tx.execute('UPDATE stream_grants SET expires_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE stream_id=? AND member_id=?', [stored.stream_id, f.fan1.actor]));
  assert.equal((await f.get(f.fan1, sent.body.messageId)).status, 404);
  assert.equal((await f.send(f.fan1, body)).status, 404);
  assert.equal((await f.send(f.fan1, f.command('새 발송', 'PRIVATE', f.owner.actor))).status, 403);
  await f.call(f.fan1, 'POST', `/rooms/${f.room}/leave`, {});
  await f.call(f.fan1, 'POST', `/rooms/${f.room}/join`, {});
  await f.nextBurst(f.fan1);
  assert.equal((await f.send(f.fan1, f.command('재입장 복구 불허', 'PRIVATE', f.owner.actor))).status, 403);
  const [count] = await f.db.transactions.read(tx => tx.rows('SELECT COUNT(*) AS total FROM messages WHERE room_id=?', [f.room]));
  assert.equal(Number(count.total), 1);
});

test('private recipient leaving blocks new drafts but does not replay or rewrite a previously committed command', { timeout: 20000 }, async t => {
  const f = await fixture(t); const body = f.command('개별 답장', 'PRIVATE', f.fan1.actor);
  const sent = await f.send(f.owner, body); assert.equal(sent.status, 200);
  await f.call(f.fan1, 'POST', `/rooms/${f.room}/leave`, {});
  assert.deepEqual((await f.send(f.owner, body)).body, sent.body);
  assert.equal((await f.send(f.owner, { ...body, clientMessageId: randomUUID() })).status, 404);
  assert.equal((await f.get(f.fan1, sent.body.messageId)).status, 404);
});

test('quotes cannot widen private audiences and deleting a source removes copied quote content only', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const source = await f.send(f.fan1, f.command('원본 비밀', 'PRIVATE', f.owner.actor));
  assert.equal(source.status, 200);
  const quoteId = source.body.messageId;
  assert.equal((await f.send(f.owner, { ...f.command('전체 인용 불허'), quoteId })).status, 404);
  assert.equal((await f.send(f.owner, { ...f.command('다른 팬 인용 불허', 'PRIVATE', f.fan2.actor), quoteId })).status, 404);
  const reply = await f.send(f.owner, { ...f.command('독립 답장', 'PRIVATE', f.fan1.actor), quoteId });
  assert.equal(reply.status, 200);
  assert.equal((await f.get(f.fan1, reply.body.messageId)).body.quote.content.text, '원본 비밀');
  const deletion = await f.remove(f.fan1, quoteId); assert.equal(deletion.status, 200);
  const view = await f.get(f.owner, reply.body.messageId);
  assert.equal(view.status, 200); assert.equal(view.body.quote, null); assert.equal(view.body.content.text, '독립 답장');
  assert.equal((await f.get(f.owner, quoteId)).status, 404);
});

test('author deletion after leaving and room closure is durable, idempotent and cannot resurrect via old retry', { timeout: 20000 }, async t => {
  const f = await fixture(t, 'GROUP'); const body = f.command('오래된 원본');
  const sent = await f.send(f.fan1, body); assert.equal(sent.status, 200);
  assert.equal((await f.remove(f.fan2, sent.body.messageId)).status, 404);
  await f.db.transactions.write(tx => tx.execute('UPDATE messages SET created_at=TIMESTAMPADD(YEAR,-3,UTC_TIMESTAMP(3)) WHERE id=?', [sent.body.messageId]));
  await f.call(f.fan1, 'POST', `/rooms/${f.room}/leave`, {});
  await f.db.transactions.write(tx => tx.execute("UPDATE rooms SET status='CLOSED' WHERE id=?", [f.room]));
  const replies = await Promise.all([f.remove(f.fan1, sent.body.messageId), f.remove(f.fan1, sent.body.messageId)]);
  assert.equal(replies[0].status, 200); assert.deepEqual(replies[1].body, replies[0].body);
  assert.deepEqual(keys(replies[0].body), ['requestId', 'status']); assert.equal(replies[0].body.status, 'blocked');
  await f.restart();
  for (const retry of [body, { ...body, content: { type: 'TEXT', text: '삭제 후 다른 본문' } }]) {
    const result = await f.send(f.fan1, retry);
    assert.equal(result.status, 200); assert.deepEqual(result.body, { clientMessageId: body.clientMessageId, messageId: sent.body.messageId, status: 'deleted' });
  }
  const rows = await f.db.transactions.read(async tx => ({
    message: (await tx.rows('SELECT text_content,deleted_at,version FROM messages WHERE id=?', [sent.body.messageId]))[0],
    receipt: (await tx.rows('SELECT deleted,payload_digest FROM command_receipts WHERE message_id=?', [sent.body.messageId]))[0],
    events: await tx.rows('SELECT kind FROM room_events WHERE message_id=?', [sent.body.messageId]),
    requests: await tx.rows('SELECT id FROM deletion_requests WHERE message_id=?', [sent.body.messageId]),
    purge: await tx.rows("SELECT id FROM jobs WHERE room_id=? AND purpose='PURGE'", [f.room]),
  }));
  assert.equal(rows.message.text_content, null); assert.ok(rows.message.deleted_at); assert.equal(String(rows.message.version), '2');
  assert.equal(Number(rows.receipt.deleted), 1); assert.equal(rows.receipt.payload_digest, null);
  assert.equal(rows.events.length, 2); assert.equal(rows.requests.length, 1); assert.equal(rows.purge.length, 1);
});

test('publication-shaped messages project anonymously and follow source owner/root deletion instead of active publisher', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const original = await f.send(f.fan1, f.command('공개 원본', 'PRIVATE', f.owner.actor));
  const publication = await f.db.transactions.write(async tx => {
    const [stream] = await tx.rows("SELECT id FROM message_streams WHERE room_id=? AND kind='ROOM_SHARED'", [f.room]);
    const id = randomUUID(); const order = await nextOrder(tx, f.room);
    // M07 owns the publish command; this fixture tests the already-required M05 reader's deletion-root boundary.
    await tx.execute('INSERT INTO messages (id,room_id,stream_id,sender_member_id,content_owner_user_id,deletion_root_id,text_content,created_order) VALUES (?,?,?,?,?,?,?,?)',
      [id, f.room, stream.id, f.owner.actor, f.fan1.id, original.body.messageId, '공개 원본', String(order)]);
    return id;
  });
  const shown = await f.get(f.fan2, publication); assert.equal(shown.status, 200);
  assert.deepEqual(shown.body.author, { kind: 'anonymous' }); assert.equal(shown.body.quote, null);
  for (const forbidden of [f.fan1.id, f.fan1.actor, original.body.messageId, f.owner.actor]) assert.ok(!JSON.stringify(shown.body).includes(forbidden));
  await f.db.transactions.write(tx => tx.execute("UPDATE users SET status='SUSPENDED' WHERE id=?", [f.fan1.id]));
  assert.equal((await f.get(f.fan2, publication)).status, 200);
  // Also exercise the root guard independently of the projection's own content-owner column.
  await f.db.transactions.write(tx => tx.execute('UPDATE messages SET content_owner_user_id=? WHERE id=?', [f.owner.id, publication]));
  await f.db.transactions.write(tx => tx.execute("UPDATE users SET status='DELETING' WHERE id=?", [f.fan1.id]));
  assert.equal((await f.get(f.fan2, publication)).status, 404);
  assert.equal((await f.get(f.owner, original.body.messageId)).status, 404);
  await f.db.transactions.write(tx => tx.execute("UPDATE users SET status='ACTIVE' WHERE id=?", [f.fan1.id]));
  await f.remove(f.fan1, original.body.messageId);
  assert.equal((await f.get(f.fan2, publication)).status, 404);
});

test('rollback keeps counter/message/receipt/events/jobs atomic; join/send order fixes history eligibility', { timeout: 20000 }, async t => {
  const f = await fixture(t, 'GROUP'); const body = f.command('rollback 합성'); const input = sendInput(body);
  await assert.rejects(f.db.transactions.write(async tx => {
    await f.sessions.require(tx, f.owner.token, f.owner.csrf, true);
    await sendMessage(tx, f.room, f.owner.id, input, f.config.key);
    throw new Error('fixture-abort');
  }), /fixture-abort/);
  const [empty] = await f.db.transactions.read(tx => tx.rows('SELECT COUNT(*) AS total FROM messages WHERE room_id=?', [f.room]));
  assert.equal(Number(empty.total), 0);
  const [sent, joined] = await Promise.all([
    f.send(f.owner, body), f.call(f.outsider, 'POST', `/rooms/${f.room}/join`, {}),
  ]);
  assert.equal(sent.status, 200); assert.equal(joined.status, 200);
  const [stored] = await f.db.transactions.read(tx => tx.rows('SELECT created_order FROM messages WHERE id=?', [sent.body.messageId]));
  const visible = BigInt(stored.created_order) >= BigInt(joined.body.visibleFromOrder);
  assert.equal((await f.get(f.outsider, sent.body.messageId)).status, visible ? 200 : 404);
  for (const table of ['messages', 'command_receipts', 'room_events', 'jobs']) {
    const [count] = await f.db.transactions.read(tx => tx.rows(`SELECT COUNT(*) AS total FROM ${table} WHERE room_id=?`, [f.room]));
    assert.equal(Number(count.total), 1, table);
  }
});

test('message HTTP protects CSRF, exact input fields and room-scoped foreign-key references', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  for (const headers of [{ 'X-CSRF-Token': '' }, { Origin: 'https://evil.invalid' }]) {
    const result = await f.call(f.owner, 'POST', `/rooms/${f.room}/messages`, f.command(), headers);
    assert.ok([400, 403].includes(result.status));
  }
  assert.equal((await f.send(f.owner, { ...f.command(), senderId: f.fan1.id })).status, 400);
  const sent = await f.send(f.owner, f.command()); assert.equal(sent.status, 200);
  const other = await f.db.transactions.write(tx => createRoom(tx, 'FK 합성방', 'GROUP'));
  assert.equal((await f.call(f.owner, 'GET', `/rooms/${other}/messages/${sent.body.messageId}`)).status, 404);
  const [source] = await f.db.transactions.read(tx => tx.rows('SELECT stream_id FROM messages WHERE id=?', [sent.body.messageId]));
  await assert.rejects(f.db.transactions.write(tx => tx.execute('INSERT INTO messages (id,room_id,stream_id,sender_member_id,content_owner_user_id,text_content,created_order) VALUES (?,?,?,?,?,?,?)',
    [randomUUID(), other, source.stream_id, f.owner.actor, f.owner.id, 'cross-room forbidden', '1'])), error => error.code === 'P2003' || error.meta?.driverAdapterError?.cause?.kind === 'ForeignKeyConstraintViolation' || [1452, 1216].includes(error.meta?.driverAdapterError?.cause?.code));
  await assert.rejects(f.db.transactions.write(tx => tx.execute('INSERT INTO command_receipts (id,room_id,actor_id,client_message_id,message_id) VALUES (?,?,?,?,?)',
    [randomUUID(), other, f.owner.actor, randomUUID(), sent.body.messageId])), error => error.code === 'P2003' || error.meta?.driverAdapterError?.cause?.kind === 'ForeignKeyConstraintViolation' || [1452, 1216].includes(error.meta?.driverAdapterError?.cause?.code));
});

test('random missing room UUIDs consume a fixed account budget without creating attacker-controlled bucket cardinality', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const count = async () => Number((await f.db.transactions.read(tx => tx.rows('SELECT COUNT(*) AS total FROM rate_buckets')))[0].total);
  const before = await count(); const body = f.command();
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await f.call(f.owner, 'POST', `/rooms/${randomUUID()}/messages`, body);
    assert.equal(result.status, 404);
  }
  assert.equal(await count(), before + 1);
  assert.equal((await f.call(f.owner, 'POST', `/rooms/${randomUUID()}/messages`, body)).status, 429);
  const key = createHmac('sha256', f.config.key).update(`send:account:${f.owner.id}`).digest();
  const [bucket] = await f.db.transactions.read(tx => tx.rows('SELECT used FROM rate_buckets WHERE key_digest=?', [key]));
  assert.equal(Number(bucket.used), 60);
  assert.equal((await f.send(f.fan1, f.command('독립 사용자의 private', 'PRIVATE', f.owner.actor))).status, 200);
});

test('own receipt reconciliation survives lost ACK/restart and isolates identical command IDs between senders', { timeout: 20000 }, async t => {
  const f = await fixture(t, 'GROUP'); const body = f.command();
  const lookup = (who, command = body.clientMessageId) => f.call(who, 'GET', `/rooms/${f.room}/message-commands/${command}`);
  assert.equal((await lookup(f.owner)).status, 404);
  const sent = await f.send(f.owner, body); assert.equal(sent.status, 200);
  await f.restart(); // Sender lost the ACK; reconcile without posting another command.
  assert.deepEqual((await lookup(f.owner)).body, sent.body);
  assert.equal((await lookup(f.fan1)).status, 404);
  const other = await f.send(f.fan1, body); assert.equal(other.status, 200);
  assert.notEqual(other.body.messageId, sent.body.messageId);
  assert.deepEqual((await lookup(f.fan1)).body, other.body);
  const native = await f.db.transactions.write(tx => f.sessions.issueNative(tx, f.owner.id, 'ios'));
  const nativeLookup = await f.call(f.owner, 'GET', `/rooms/${f.room}/message-commands/${body.clientMessageId}`, undefined, { Authorization: `Bearer ${native.token}`, 'X-Rogi-Client': 'ios' });
  assert.deepEqual(nativeLookup.body, sent.body);
  const deleted = await f.call(f.owner, 'POST', `/rooms/${f.room}/messages/${sent.body.messageId}/delete`, {}, {
    Authorization: `Bearer ${native.token}`, 'X-Rogi-Client': 'ios',
  });
  assert.equal(deleted.status, 200);
  await f.restart();
  assert.deepEqual((await lookup(f.owner)).body, { clientMessageId: body.clientMessageId, status: 'deleted' });
  assert.deepEqual((await lookup(f.fan1)).body, other.body);
  assert.equal((await f.send(f.owner, body)).body.status, 'deleted');
  assert.equal((await f.get(f.owner, sent.body.messageId)).status, 404);
  assert.equal((await lookup(f.outsider)).status, 404);
  assert.equal((await lookup(f.owner, 'invalid')).status, 400);
  const [count] = await f.db.transactions.read(tx => tx.rows('SELECT COUNT(*) AS total FROM messages WHERE room_id=?', [f.room]));
  assert.equal(Number(count.total), 2);
});

test('own receipt lookup enforces leave/rejoin, private grant, closed room and session/account revocation', { timeout: 20000 }, async t => {
  const f = await fixture(t, 'GROUP'); const body = f.command();
  const sent = await f.send(f.fan1, body); assert.equal(sent.status, 200);
  const lookup = (who, command) => f.call(who, 'GET', `/rooms/${f.room}/message-commands/${command}`);
  assert.equal((await lookup(f.fan1, body.clientMessageId)).status, 200);
  assert.equal((await f.call(f.fan1, 'POST', `/rooms/${f.room}/leave`, {})).status, 204);
  assert.equal((await lookup(f.fan1, body.clientMessageId)).status, 404);
  assert.equal((await f.call(f.fan1, 'POST', `/rooms/${f.room}/join`, {})).status, 200);
  assert.equal((await lookup(f.fan1, body.clientMessageId)).status, 404);
  const privateBody = f.command('현재 비공개', 'PRIVATE', f.owner.actor);
  const privateSent = await f.send(f.fan2, privateBody); assert.equal(privateSent.status, 200);
  assert.equal((await lookup(f.fan2, privateBody.clientMessageId)).status, 200);
  const [stored] = await f.db.transactions.read(tx => tx.rows('SELECT stream_id FROM messages WHERE id=?', [privateSent.body.messageId]));
  await f.db.transactions.write(tx => tx.prisma.stream_grants.updateMany({ where: { stream_id: stored.stream_id, member_id: f.fan2.actor }, data: { revoked_at: new Date() } }));
  assert.equal((await lookup(f.fan2, privateBody.clientMessageId)).status, 404);
  const own = f.command(); assert.equal((await f.send(f.owner, own)).status, 200);
  await f.db.transactions.write(tx => tx.prisma.platform_soop.updateMany({ where: { user_id: f.owner.id }, data: { status: 'REVOKED' } }));
  assert.equal((await lookup(f.owner, own.clientMessageId)).status, 403);
  await f.db.transactions.write(tx => tx.prisma.platform_soop.updateMany({ where: { user_id: f.owner.id }, data: { status: 'VERIFIED' } }));
  await f.db.transactions.write(tx => tx.prisma.rooms.update({ where: { id: f.room }, data: { status: 'CLOSED' } }));
  assert.equal((await lookup(f.owner, own.clientMessageId)).status, 404);
  await f.db.transactions.write(tx => tx.prisma.users.update({ where: { id: f.owner.id }, data: { status: 'DELETING' } }));
  assert.equal((await lookup(f.owner, own.clientMessageId)).status, 401);
  await f.db.transactions.write(tx => f.sessions.revoke(tx, f.fan1.token, f.fan1.csrf));
  assert.equal((await lookup(f.fan1, body.clientMessageId)).status, 401);
});
