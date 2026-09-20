import { createUser, createRoom, joinRoom, sendInput, sendMessage, getMessage, deleteMessage, requestPublication, publishText, publicationStatus, setReaction, Jobs, enqueueJob } from '../support/domain-fixture.mjs';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { ApiError } from '../../dist/modules/auth/auth-primitives.js';
import { createApi } from '../../dist/application.js';
import { SafeLogger } from '../../dist/infrastructure/observability/logging.js';
import { child, waitFor, stopChild } from '../helpers.mjs';

async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api')); let app; const children = [];
  t.after(async () => { try { for (const proc of children) await stopChild(proc); await app?.close(); } finally { await db.close(); } });
  const config = { audience: `pub-${randomBytes(8).toString('hex')}`, origin: 'http://localhost:3001', secure: false, key: randomBytes(32) };
  const sessions = new SessionService(new SessionRepository(), config.audience, config.key);
  const person = name => db.transactions.write(async tx => {
    const id = await createUser(tx, name);
    await tx.execute('INSERT INTO platform_soop (id,user_id,provider_subject,verified_at) VALUES (?,?,?,UTC_TIMESTAMP(3))', [randomUUID(), id, Buffer.from(`fixture-pub-${randomUUID()}`)]);
    return { id, ...await sessions.issue(tx, id) };
  });
  const owner = await person('공개 방장'), fan = await person('비공개 팬'), other = await person('공개 열람 팬');
  const room = await db.transactions.write(async tx => {
    const id = await createRoom(tx, '공개 합성방', 'FAN');
    for (const user of [owner, fan, other]) user.actor = await joinRoom(tx, id, user.id);
    await tx.execute("UPDATE room_members SET role='STREAMER' WHERE id=?", [owner.actor]);
    await tx.execute('UPDATE rooms SET owner_member_id=? WHERE id=?', [owner.actor, id]);
    return id;
  });
  const write = (user, operation) => db.transactions.write(async tx => { await sessions.require(tx, user.token, user.csrf, true); return operation(tx); });
  const read = (user, operation) => db.transactions.read(async tx => { await sessions.require(tx, user.token, undefined, true); return operation(tx); });
  const send = (user = fan, intent = 'PRIVATE', quoteId) => write(user, tx => sendMessage(tx, room, user.id,
    sendInput({ clientMessageId: randomUUID(), intent, ...(intent === 'PRIVATE' ? { recipientActorId: owner.actor } : {}),
      ...(quoteId ? { quoteId } : {}), content: { type: 'TEXT', text: `합성 공개 본문 ${randomUUID()}` } }), config.key));
  const request = (id, user = owner, targetRoom = room) => write(user, tx => requestPublication(tx, targetRoom, user.id, id));
  const status = (id, user = owner) => read(user, tx => publicationStatus(tx, room, user.id, id));
  const get = (id, user = other) => read(user, tx => getMessage(tx, room, user.id, id));
  const remove = (id, user = fan) => write(user, tx => deleteMessage(tx, room, user.id, id));
  const queue = new Jobs(db.transactions, 'worker');
  const claim = async id => {
    const leases = await queue.claim({ purposes: ['PUBLICATION'] });
    const found = leases.find(lease => lease.resourceId === id); assert.ok(found, 'fixture publication must be claimable');
    assert.equal(leases.length, 1, 'fixture must not strand unrelated publication jobs'); return found;
  };
  const processPublication = async id => publishText(db.transactions, await claim(id));
  const snapshot = () => db.transactions.read(async tx => {
    const [row] = await tx.rows(`SELECT
      (SELECT COUNT(*) FROM messages WHERE room_id=? AND deletion_root_id IS NOT NULL) AS copies,
      (SELECT COUNT(*) FROM room_events WHERE room_id=?) AS events,
      (SELECT COUNT(*) FROM audit_events WHERE room_id=? AND action='MESSAGE_PUBLISHED') AS audits,
      (SELECT last_order FROM room_counters WHERE room_id=?) AS counter`, [room, room, room, room]);
    return { ...row };
  });
  const http = async () => {
    app = await createApi(db, new SafeLogger('api', () => {}), undefined, { config, sessions });
    await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
    return async (user, method, path, body, overrides = {}) => {
      const response = await fetch(`${base}/v1${path}`, { method, headers: { Origin: config.origin, Cookie: `rogi_session=${user.token}`,
        'X-CSRF-Token': user.csrf, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...overrides },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    };
  };
  return { db, owner, fan, other, room, sessions, config, send, request, status, get, remove, write, queue, claim, process: processPublication, snapshot, http, children };
}
const denied = error => error instanceof ApiError && [403, 404].includes(error.getStatus());

test('owner publication capability ignores private read grant/history, preserves content revision idempotence and anonymous DTO', { timeout: 30000 }, async t => {
  const f = await fixture(t); const quote = await f.send(); const source = await f.send(f.fan, 'PRIVATE', quote.messageId);
  const first = await f.request(source.messageId); assert.equal(first.status, 'preparing');
  await f.write(f.fan, tx => setReaction(tx, f.room, f.fan.id, source.messageId, '👍'));
  const [revisions] = await f.db.transactions.read(tx => tx.rows('SELECT version,content_revision FROM messages WHERE id=?', [source.messageId]));
  assert.equal(String(revisions.version), '2'); assert.equal(String(revisions.content_revision), '1');
  await f.db.transactions.write(async tx => {
    await tx.execute(`UPDATE stream_grants g JOIN messages m ON m.room_id=g.room_id AND m.stream_id=g.stream_id SET g.revoked_at=UTC_TIMESTAMP(3)
      WHERE m.id=? AND g.member_id=?`, [source.messageId, f.owner.actor]);
    await tx.execute(`UPDATE membership_periods p JOIN room_members m ON m.active_period_id=p.id
      JOIN messages source ON source.room_id=m.room_id SET p.visible_from_order=source.created_order+1 WHERE m.id=? AND source.id=?`, [f.owner.actor, source.messageId]);
  });
  await assert.rejects(f.get(source.messageId, f.owner), denied);
  assert.deepEqual(await f.request(source.messageId), first);
  assert.equal(await f.process(first.publicationId), 'completed');
  const done = await f.status(first.publicationId); assert.equal(done.status, 'published');
  const dto = await f.get(done.messageId); assert.deepEqual(dto.author, { kind: 'anonymous' }); assert.equal(dto.quote, null); assert.equal(dto.audience, 'SHARED');
  const [body] = await f.db.transactions.read(tx => tx.rows('SELECT text_content FROM messages WHERE id=?', [source.messageId]));
  assert.equal(dto.content.text, body.text_content);
  for (const secret of [source.messageId, quote.messageId, f.fan.id, f.fan.actor, f.owner.id, f.owner.actor]) assert.ok(!JSON.stringify(dto).includes(secret));
  assert.deepEqual(await f.request(source.messageId), done);
  const [counts] = await f.db.transactions.read(tx => tx.rows('SELECT COUNT(*) AS total FROM message_publications WHERE source_message_id=?', [source.messageId]));
  assert.equal(Number(counts.total), 1); assert.equal(Number((await f.snapshot()).copies), 1);
});

test('nonowner, cross-room, shared source and foreign publication status are denied; HTTP preserves minimal status contract', { timeout: 30000 }, async t => {
  const f = await fixture(t); const source = await f.send(); const shared = await f.send(f.owner, 'SHARED');
  await assert.rejects(f.request(source.messageId, f.fan), denied);
  await f.db.transactions.write(tx => tx.execute("UPDATE room_members SET role='STREAMER' WHERE id=?", [f.other.actor]));
  await assert.rejects(f.request(source.messageId, f.other), denied);
  const otherRoom = await f.db.transactions.write(async tx => { const id = await createRoom(tx, '다른 공개방', 'FAN'); await joinRoom(tx, id, f.owner.id); return id; });
  await assert.rejects(f.request(source.messageId, f.owner, otherRoom), denied);
  await assert.rejects(f.request(shared.messageId), denied);
  const call = await f.http(); const path = `/rooms/${f.room}/messages/${source.messageId}/publications`;
  const accepted = await call(f.owner, 'POST', path, {}); assert.equal(accepted.status, 202);
  assert.deepEqual(Object.keys(accepted.body).sort(), ['publicationId', 'status']);
  assert.equal((await call(f.owner, 'POST', path, {}, { 'X-CSRF-Token': '' })).status, 400);
  assert.equal((await call(f.owner, 'POST', path, { userId: f.fan.id })).status, 400);
  assert.equal((await call(f.fan, 'GET', `/rooms/${f.room}/publications/${accepted.body.publicationId}`)).status, 404);
  await f.process(accepted.body.publicationId);
  const completed = await call(f.owner, 'GET', `/rooms/${f.room}/publications/${accepted.body.publicationId}`);
  assert.equal(completed.status, 200); assert.equal(completed.body.status, 'published');
  assert.deepEqual(Object.keys(completed.body).sort(), ['messageId', 'publicationId', 'status']);
});

test('queued source deletion, content revision change and owner-account deletion revoke publication without exposing content', { timeout: 30000 }, async t => {
  for (const mutation of ['delete', 'revision', 'account']) {
    const f = await fixture(t); const source = await f.send(); const publication = await f.request(source.messageId);
    if (mutation === 'delete') await f.remove(source.messageId);
    if (mutation === 'revision') await f.db.transactions.write(tx => tx.execute('UPDATE messages SET text_content=?,content_revision=content_revision+1,version=version+1 WHERE id=?', ['변경된 본문', source.messageId]));
    if (mutation === 'account') await f.db.transactions.write(tx => tx.execute("UPDATE users SET status='DELETING' WHERE id=?", [f.fan.id]));
    assert.equal(await f.process(publication.publicationId), 'completed');
    assert.deepEqual(await f.status(publication.publicationId), { publicationId: publication.publicationId, status: 'revoked' });
    const snapshot = await f.snapshot(); assert.equal(Number(snapshot.copies), 0); assert.equal(Number(snapshot.audits), 0);
  }
});

test('expired worker finalization rolls back message/event/audit/counter and a new generation publishes exactly once', { timeout: 30000 }, async t => {
  const f = await fixture(t); const source = await f.send(); const publication = await f.request(source.messageId);
  const stale = await f.claim(publication.publicationId); const before = await f.snapshot();
  await f.db.transactions.write(tx => tx.execute('UPDATE jobs SET lease_until=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE id=?', [stale.id]));
  assert.equal(await publishText(f.db.transactions, stale), 'lease_lost'); assert.deepEqual(await f.snapshot(), before);
  assert.equal((await f.status(publication.publicationId)).status, 'preparing');
  const current = await f.claim(publication.publicationId); assert.equal(current.generation, stale.generation + 1n);
  assert.equal(await publishText(f.db.transactions, current), 'completed');
  assert.equal(await publishText(f.db.transactions, stale), 'lease_lost');
  const after = await f.snapshot(); assert.equal(Number(after.copies), 1); assert.equal(Number(after.audits), 1);
  assert.equal(Number(after.events), Number(before.events) + 1);
  assert.equal(BigInt(after.counter), BigInt(before.counter) + 1n);
});

test('publish/delete races and already-published source deletion never resurrect public text or keep public access', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  for (const concurrent of [false, true, true]) {
    const source = await f.send(); const publication = await f.request(source.messageId); const claimed = await f.claim(publication.publicationId);
    if (concurrent) await Promise.all([publishText(f.db.transactions, claimed), f.remove(source.messageId)]);
    else { await publishText(f.db.transactions, claimed); await f.remove(source.messageId); }
    assert.equal((await f.status(publication.publicationId)).status, 'revoked');
    const copies = await f.db.transactions.read(tx => tx.rows('SELECT id,text_content,deleted_at FROM messages WHERE deletion_root_id=?', [source.messageId]));
    for (const copy of copies) { assert.equal(copy.text_content, null); assert.ok(copy.deleted_at); await assert.rejects(f.get(copy.id), denied); }
    await assert.rejects(f.request(source.messageId), denied);
    assert.equal(await publishText(f.db.transactions, claimed), 'lease_lost');
    const [live] = await f.db.transactions.read(tx => tx.rows('SELECT COUNT(*) AS total FROM messages WHERE deletion_root_id=? AND (text_content IS NOT NULL OR deleted_at IS NULL)', [source.messageId]));
    assert.equal(Number(live.total), 0);
  }
});

test('actual worker SIGKILL and restart process durable publication without claiming unimplemented purposes', { timeout: 30000 }, async t => {
  const f = await fixture(t); const source = await f.send(); const publication = await f.request(source.messageId);
  const unsupported = await f.db.transactions.write(tx => enqueueJob(tx, { purpose: 'MEDIA', roomId: f.room, resourceId: randomUUID() }));
  await f.db.transactions.write(tx => tx.execute("UPDATE jobs SET available_at=TIMESTAMPADD(HOUR,1,UTC_TIMESTAMP(3)) WHERE purpose='PUBLICATION' AND resource_id=?", [publication.publicationId]));
  const first = child('worker', { DATABASE_URL: process.env.DATABASE_URL }); f.children.push(first);
  await waitFor(() => first.output().includes('started')); first.proc.kill('SIGKILL');
  const [code, signal] = await first.exited; assert.equal(code, null); assert.equal(signal, 'SIGKILL');
  assert.equal((await f.status(publication.publicationId)).status, 'preparing');
  // Earlier integration fixtures leave PUSH work in the shared disposable DB.
  // Give this test's own publication first FIFO eligibility; this verifies
  // process durability, not a cross-purpose queue latency/fairness guarantee.
  await f.db.transactions.write(tx => tx.execute("UPDATE jobs SET available_at=TIMESTAMPADD(HOUR,-1,UTC_TIMESTAMP(3)) WHERE purpose='PUBLICATION' AND resource_id=?", [publication.publicationId]));
  const second = child('worker', { DATABASE_URL: process.env.DATABASE_URL }); f.children.push(second);
  await waitFor(() => second.output().includes('started'));
  await waitFor(async () => (await f.status(publication.publicationId)).status === 'published', 15000);
  const result = await f.status(publication.publicationId); assert.equal((await f.get(result.messageId)).author.kind, 'anonymous');
  const [job] = await f.db.transactions.read(tx => tx.rows("SELECT state FROM jobs WHERE purpose='PUBLICATION' AND resource_id=?", [publication.publicationId]));
  assert.equal(job.state, 'COMPLETED');
  const [untouched] = await f.db.transactions.read(tx => tx.rows('SELECT state,attempts FROM jobs WHERE id=?', [unsupported]));
  assert.equal(untouched.state, 'PENDING'); assert.equal(Number(untouched.attempts), 0);
  await stopChild(second); assert.ok(second.output().includes('shutdown_complete'));
  for (const instance of [first, second]) {
    for (const sensitive of [f.owner.token, f.fan.token, source.messageId, f.fan.id]) assert.ok(!instance.output().includes(sensitive));
  }
});
