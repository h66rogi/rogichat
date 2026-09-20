import { createUser, createRoom, joinRoom, leaveRoom, sendMessage, sendInput, deleteMessage, reserveMedia, beginUpload, finishUpload, failUpload, authorizedMediaObject, mediaStatus, setRoomMediaPolicy } from '../support/domain-fixture.mjs';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';

const MiB = 1024 * 1024;
const photo = { kind: 'PHOTO', contentType: 'image/jpeg', byteLength: MiB };
const sha256 = 'a'.repeat(64);
const denied = promise => assert.rejects(promise, { code: 'NOT_FOUND' });

async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  // Independent pools model two API replicas, with only MySQL shared admission state.
  const databases = [new MysqlDatabase(readConfig('api')), new MysqlDatabase(readConfig('api'))];
  t.after(() => Promise.all(databases.map(db => db.close())));
  const [db] = databases; const key = randomBytes(32);
  const sessions = databases.map(() => new SessionService(new SessionRepository(), 'media-fixture', key));
  const user = name => db.transactions.write(async tx => {
    const id = await createUser(tx, name);
    await tx.execute('INSERT INTO platform_soop (id,user_id,provider_subject,verified_at) VALUES (?,?,?,UTC_TIMESTAMP(3))', [randomUUID(), id, Buffer.from(`fixture-${randomUUID()}`)]);
    return { id, ...await sessions[0].issue(tx, id) };
  });
  const owner = await user('미디어 방장'), a = await user('미디어 팬 하나'), b = await user('미디어 팬 둘'), outside = await user('미디어 외부인');
  const room = await db.transactions.write(async tx => {
    const id = await createRoom(tx, '미디어 합성방', 'FAN');
    for (const person of [owner, a, b]) person.actor = await joinRoom(tx, id, person.id);
    await tx.execute("UPDATE room_members SET role='STREAMER' WHERE id=?", [owner.actor]);
    await tx.execute('UPDATE rooms SET owner_member_id=? WHERE id=?', [owner.actor, id]);
    return id;
  });
  const auth = (person, writable, operation, replica = 0) => databases[replica].transactions[writable ? 'write' : 'read'](async tx => {
    await sessions[replica].require(tx, person.token, writable ? person.csrf : undefined, true);
    return operation(tx);
  });
  const reserve = (person = a, input = photo, replica = 0, roomId = room) => auth(person, true, tx => reserveMedia(tx, person.id, roomId, input), replica);
  const begin = (person, assetId, replica = 0) => auth(person, true, tx => beginUpload(tx, person.id, assetId, 'test'), replica);
  const finish = (person, attempt, bytes = attempt.input.byteLength, hash = sha256) => auth(person, true, tx => finishUpload(tx, person.id, attempt, bytes, hash));
  const fail = attempt => db.transactions.write(tx => failUpload(tx, attempt));
  const get = (person, assetId, context = { variant: 'image' }) => auth(person, false, tx => authorizedMediaObject(tx, person.id, assetId, context));
  const send = (person, recipient) => auth(person, true, tx => sendMessage(tx, room, person.id, sendInput({ clientMessageId: randomUUID(), intent: recipient ? 'PRIVATE' : 'SHARED', ...(recipient ? { recipientActorId: recipient.actor } : {}), content: { type: 'TEXT', text: '합성 첨부 ACL 시험' } }), key));
  const sendPhoto = (assetId, clientMessageId = randomUUID()) => auth(a, true, tx => sendMessage(tx, room, a.id,
    sendInput({ clientMessageId, intent: 'PRIVATE', recipientActorId: owner.actor, content: { type: 'PHOTO', assetIds: [assetId] } }), key));
  const total = () => db.transactions.read(async tx => BigInt((await tx.rows("SELECT reserved_bytes FROM media_budget WHERE id='global'"))[0]?.reserved_bytes ?? 0));
  // READY is synthetic ACL/state setup only. These tests do NOT prove decoding or R2 storage.
  const ready = assetId => db.transactions.write(async tx => {
    const objectKey = `test/${assetId}/${randomUUID()}/image`;
    await tx.execute("UPDATE media_assets SET state='READY' WHERE id=?", [assetId]);
    await tx.execute("INSERT INTO media_objects (id,asset_id,attempt_id,variant,object_key,state,byte_length,sha256) VALUES (?,?,?,'image',?,'READY',?,?)", [randomUUID(), assetId, randomUUID(), objectKey, MiB, sha256]);
    return objectKey;
  });
  return { db, databases, owner, a, b, outside, room, auth, reserve, begin, finish, fail, get, send, sendPhoto, total, ready };
}

test('two API pools enforce two pending intents and atomically account only successful reservations', { timeout: 20000 }, async t => {
  const f = await fixture(t); const before = await f.total();
  const results = await Promise.allSettled([f.reserve(f.a, photo, 0), f.reserve(f.a, photo, 1), f.reserve(f.a, photo, 0)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  assert.deepEqual(results.filter(result => result.status === 'rejected').map(result => result.reason.code), ['RATE_LIMITED']);
  assert.equal(await f.total() - before, BigInt(22 * MiB));
  const [daily] = await f.db.transactions.read(tx => tx.rows('SELECT input_bytes FROM media_daily_usage WHERE user_id=? AND day=UTC_DATE()', [f.a.id]));
  assert.equal(Number(daily.input_bytes), 2 * MiB);
  for (const result of results.filter(result => result.status === 'fulfilled')) assert.deepEqual(Object.keys(result.value).sort(), ['assetId', 'status']);
  await assert.rejects(f.reserve(f.b, { ...photo, kind: 'STICKER', contentType: 'image/png' }), { code: 'MEDIA_FORBIDDEN' });
});

test('daily 200 MiB and global 10 GiB limits deny atomically, including cross-replica last-slot races', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  await f.db.transactions.write(tx => tx.execute('INSERT INTO media_daily_usage (user_id,day,input_bytes) VALUES (?,UTC_DATE(),?)', [f.a.id, 200 * MiB]));
  const before = await f.total();
  await assert.rejects(f.reserve(), { code: 'RATE_LIMITED' }); assert.equal(await f.total(), before);
  await f.db.transactions.write(async tx => {
    await tx.execute("INSERT IGNORE INTO media_budget (id) VALUES ('global')");
    const [budget] = await tx.rows("SELECT limit_bytes FROM media_budget WHERE id='global' FOR UPDATE");
    assert.equal(BigInt(budget.limit_bytes), 10n * 1024n * 1024n * 1024n);
    await tx.execute("UPDATE media_budget SET reserved_bytes=limit_bytes-? WHERE id='global'", [11 * MiB]);
  });
  let successful = 0;
  try {
    const results = await Promise.allSettled([f.reserve(f.b, photo, 0), f.reserve(f.owner, photo, 1)]);
    successful = results.filter(result => result.status === 'fulfilled').length;
    assert.equal(successful, 1);
    assert.deepEqual(results.filter(result => result.status === 'rejected').map(result => result.reason.code), ['MEDIA_CAPACITY']);
    assert.equal(await f.total(), 10n * 1024n * 1024n * 1024n);
    await assert.rejects(f.reserve(f.outside, { kind: 'AVATAR', contentType: 'image/png', byteLength: 1 }, 1, null), { code: 'MEDIA_CAPACITY' });
  } finally {
    // Restore only the synthetic occupancy; retain actual successful reservations.
    await f.db.transactions.write(tx => tx.execute("UPDATE media_budget SET reserved_bytes=? WHERE id='global'", [String(before + BigInt(successful * 11 * MiB))]));
  }
});

test('two API pools admit only two global uploads and failure keeps reservations and immutable cleanup keys', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const intents = [await f.reserve(f.a), await f.reserve(f.a), await f.reserve(f.b)];
  const before = await f.total();
  const results = await Promise.allSettled(intents.map((intent, index) => f.begin(index === 2 ? f.b : f.a, intent.assetId, index % 2)));
  const attempts = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  assert.equal(attempts.length, 2);
  assert.deepEqual(results.filter(result => result.status === 'rejected').map(result => result.reason.code), ['RATE_LIMITED']);
  try {
    for (const attempt of attempts) {
      const [object] = await f.db.transactions.read(tx => tx.rows('SELECT object_key,state FROM media_objects WHERE id=?', [attempt.objectId]));
      assert.equal(object.object_key, attempt.key); assert.equal(object.state, 'ALLOCATED');
      await f.fail({ ...attempt, token: randomUUID() });
      const [asset] = await f.db.transactions.read(tx => tx.rows('SELECT state FROM media_assets WHERE id=?', [attempt.assetId]));
      assert.equal(asset.state, 'UPLOADING');
      await f.fail(attempt); await f.fail(attempt);
      const [jobs] = await f.db.transactions.read(tx => tx.rows("SELECT COUNT(*) AS n FROM jobs WHERE purpose='MEDIA' AND resource_id=?", [attempt.assetId]));
      assert.equal(Number(jobs.n), 1);
      await assert.rejects(f.finish(attempt.assetId === intents[2].assetId ? f.b : f.a, attempt), { code: 'MEDIA_STATE' });
    }
    assert.equal(await f.total(), before);
  } finally { await Promise.all(attempts.map(attempt => f.fail(attempt))); }
  const rejectedIndex = results.findIndex(result => result.status === 'rejected');
  const admitted = await f.begin(rejectedIndex === 2 ? f.b : f.a, intents[rejectedIndex].assetId, 1);
  await f.fail(admitted);
});

test('completion fences expired/replaced tokens, exact bytes, owner and duplicate commits; processing has one durable job', { timeout: 20000 }, async t => {
  const f = await fixture(t); const { assetId } = await f.reserve();
  await denied(f.begin(f.b, assetId)); await denied(f.get(f.a, assetId));
  const attempt = await f.begin(f.a, assetId);
  try {
    await assert.rejects(f.finish(f.b, attempt), { code: 'MEDIA_STATE' });
    await assert.rejects(f.finish(f.a, { ...attempt, token: randomUUID() }), { code: 'MEDIA_STATE' });
    await assert.rejects(f.finish(f.a, attempt, MiB - 1), { code: 'INVALID_REQUEST' });
    await assert.rejects(f.finish(f.a, attempt, MiB, 'invalid'), { code: 'INVALID_REQUEST' });
    await f.db.transactions.write(tx => tx.execute("UPDATE users SET status='DELETING' WHERE id=?", [f.a.id]));
    await assert.rejects(f.finish(f.a, attempt), { code: 'UNAUTHENTICATED' });
    // Independently check the service's owner guard in addition to the outer session gate.
    await denied(f.db.transactions.write(tx => finishUpload(tx, f.a.id, attempt, MiB, sha256)));
    await f.db.transactions.write(tx => tx.execute("UPDATE users SET status='ACTIVE' WHERE id=?", [f.a.id]));
    await f.db.transactions.write(tx => tx.execute('UPDATE media_assets SET upload_until=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE id=?', [assetId]));
    await assert.rejects(f.finish(f.a, attempt), { code: 'MEDIA_STATE' });
    await f.db.transactions.write(tx => tx.execute('UPDATE media_assets SET upload_until=TIMESTAMPADD(MINUTE,1,UTC_TIMESTAMP(3)) WHERE id=?', [assetId]));
    assert.deepEqual(await f.finish(f.a, attempt), { assetId, status: 'processing' });
    await assert.rejects(f.finish(f.a, attempt), { code: 'MEDIA_STATE' });
    await f.fail(attempt); // A delayed failure cannot regress a committed completion.
    const [asset] = await f.db.transactions.read(tx => tx.rows('SELECT state FROM media_assets WHERE id=?', [assetId]));
    assert.equal(asset.state, 'PROCESSING');
    const [jobs] = await f.db.transactions.read(tx => tx.rows("SELECT COUNT(*) AS n FROM jobs WHERE purpose='MEDIA' AND resource_id=?", [assetId]));
    assert.equal(Number(jobs.n), 1); await denied(f.get(f.a, assetId));
    const [object] = await f.db.transactions.read(tx => tx.rows('SELECT state,byte_length,sha256 FROM media_objects WHERE id=?', [attempt.objectId]));
    assert.equal(object.state, 'STORED'); assert.equal(Number(object.byte_length), MiB); assert.equal(object.sha256, sha256);
  } finally { await f.fail(attempt); }
});

test('READY synthetic attachments use current private-message ACL and source deletion, not possession of an asset ID', { timeout: 20000 }, async t => {
  const f = await fixture(t); const { assetId } = await f.reserve(); const key = await f.ready(assetId);
  assert.equal(await f.get(f.a, assetId), key);
  await denied(f.get(f.b, assetId)); await denied(f.get(f.owner, assetId));
  await denied(f.get(f.a, assetId, { variant: 'input' }));
  await denied(f.get(f.a, assetId, { roomId: f.room, variant: 'image' }));
  const { messageId } = await f.send(f.a, f.owner);
  await f.db.transactions.write(tx => tx.execute('INSERT INTO message_attachments (id,room_id,message_id,asset_id,position) VALUES (?,?,?,?,0)', [randomUUID(), f.room, messageId, assetId]));
  const context = { roomId: f.room, messageId, variant: 'image' };
  assert.equal(await f.get(f.a, assetId, context), key); assert.equal(await f.get(f.owner, assetId, context), key);
  await denied(f.get(f.a, assetId)); await denied(f.get(f.b, assetId, context)); await denied(f.get(f.outside, assetId, context));
  await denied(f.get(f.owner, assetId, { ...context, roomId: randomUUID() }));
  await denied(f.get(f.owner, assetId, { ...context, messageId: randomUUID() }));
  await f.db.transactions.write(tx => tx.execute('UPDATE stream_grants SET revoked_at=UTC_TIMESTAMP(3) WHERE member_id=?', [f.a.actor]));
  await denied(f.get(f.a, assetId, context)); assert.equal(await f.get(f.owner, assetId, context), key);
  await deleteMessage(f.db.transactions, f.room, f.a.id, messageId);
  await denied(f.get(f.owner, assetId, context));
});

test('current source-owner deletion blocks another viewer; room leave and intent expiry block uploads', { timeout: 20000 }, async t => {
  const f = await fixture(t); const { assetId } = await f.reserve(); await f.ready(assetId);
  // Deliberately use another sender/content owner: denial must come from the asset owner guard.
  const { messageId } = await f.send(f.owner);
  await f.db.transactions.write(tx => tx.execute('INSERT INTO message_attachments (id,room_id,message_id,asset_id,position) VALUES (?,?,?,?,0)', [randomUUID(), f.room, messageId, assetId]));
  const context = { roomId: f.room, messageId, variant: 'image' };
  assert.equal(typeof await f.get(f.b, assetId, context), 'string');
  await f.db.transactions.write(tx => tx.execute("UPDATE users SET status='DELETING' WHERE id=?", [f.a.id]));
  await denied(f.get(f.b, assetId, context));
  await assert.rejects(f.auth(f.a, false, tx => mediaStatus(tx, f.a.id, assetId)), { code: 'UNAUTHENTICATED' });
  const expired = await f.reserve(f.b);
  await f.db.transactions.write(tx => tx.execute('UPDATE media_assets SET expires_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE id=?', [expired.assetId]));
  await denied(f.begin(f.b, expired.assetId));
  const left = await f.reserve(f.b);
  await f.db.transactions.write(tx => leaveRoom(tx, f.room, f.b.id));
  await denied(f.begin(f.b, left.assetId)); await denied(f.reserve(f.b));
});

test('new PHOTO attachment rechecks current room policy while an existing committed ACK stays idempotent', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const first = await f.reserve(); await f.ready(first.assetId);
  const clientMessageId = randomUUID(); const committed = await f.sendPhoto(first.assetId, clientMessageId);
  const next = await f.reserve(); await f.ready(next.assetId);
  const snapshot = () => f.db.transactions.read(async tx => ({
    counter: (await tx.rows('SELECT last_order FROM room_counters WHERE room_id=?', [f.room]))[0].last_order,
    links: (await tx.rows('SELECT COUNT(*) AS n FROM message_attachments WHERE room_id=?', [f.room]))[0].n,
    receipts: (await tx.rows('SELECT COUNT(*) AS n FROM command_receipts WHERE room_id=?', [f.room]))[0].n,
  }));
  await f.auth(f.owner, true, tx => setRoomMediaPolicy(tx, f.room, f.owner.id, { photoEnabled: false }));
  const before = await snapshot();
  await assert.rejects(f.sendPhoto(next.assetId), { code: 'MEDIA_FORBIDDEN' });
  assert.deepEqual(await f.sendPhoto(first.assetId, clientMessageId), committed);
  assert.deepEqual(await snapshot(), before);
  await f.auth(f.owner, true, tx => setRoomMediaPolicy(tx, f.room, f.owner.id, { photoEnabled: true, photoMaxBytes: MiB - 1 }));
  await assert.rejects(f.sendPhoto(next.assetId), { code: 'INVALID_MEDIA_INTENT' });
  assert.deepEqual(await f.sendPhoto(first.assetId, clientMessageId), committed);
  assert.deepEqual(await snapshot(), before);
});
