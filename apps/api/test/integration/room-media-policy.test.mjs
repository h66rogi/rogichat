import { createUser, createRoom, joinRoom, leaveRoom, readRoomMediaPolicy, setRoomMediaPolicy, requireRoomMedia, reserveMedia, beginUpload, finishUpload, failUpload } from '../support/domain-fixture.mjs';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { MEDIA_LIMITS } from '../../dist/common/media/media-policy.js';

const defaults = Object.freeze({ photoEnabled: true, videoEnabled: true, stickerEnabled: true,
  photoMaxBytes: MEDIA_LIMITS.photoBytes, videoMaxBytes: MEDIA_LIMITS.videoBytes });
const inputs = [
  { kind: 'PHOTO', contentType: 'image/jpeg', byteLength: 1024 },
  { kind: 'VIDEO', contentType: 'video/mp4', byteLength: 1024 },
];
const sha256 = 'a'.repeat(64);
const rejects = (promise, code, status) => assert.rejects(promise, error => error.code === code && error.getStatus?.() === status);

async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api')); const attempts = [];
  // Even an assertion failure must release synthetic UPLOADING slots before the next test.
  // failUpload preserves reservations/keys for cleanup; no storage object is fabricated here.
  t.after(async () => {
    try { for (const attempt of attempts) await db.transactions.write(tx => failUpload(tx, attempt)); }
    finally { await db.close(); }
  });
  const sessions = new SessionService(new SessionRepository(), 'room-media-policy', randomBytes(32));
  const user = nickname => db.transactions.write(async tx => {
    const id = await createUser(tx, nickname);
    await tx.execute('INSERT INTO platform_soop (id,user_id,provider_subject,verified_at) VALUES (?,?,?,UTC_TIMESTAMP(3))',
      [randomUUID(), id, Buffer.from(`fixture-${randomUUID()}`)]);
    return { id, ...await sessions.issue(tx, id) };
  });
  const owner = await user('정책 방장'), fan = await user('정책 팬'), streamer = await user('비방장 스트리머');
  const admin = await user('정책 관리자'), outside = await user('정책 외부인');
  const room = await db.transactions.write(async tx => {
    const id = await createRoom(tx, '미디어 정책 합성방', 'FAN');
    for (const person of [owner, fan, streamer]) person.actor = await joinRoom(tx, id, person.id);
    for (const person of [owner, streamer]) await tx.execute("UPDATE room_members SET role='STREAMER' WHERE id=?", [person.actor]);
    await tx.execute('UPDATE rooms SET owner_member_id=? WHERE id=?', [owner.actor, id]);
    await tx.execute('INSERT INTO admin_capabilities (user_id,manage_rooms) VALUES (?,1)', [admin.id]);
    return id;
  });
  const auth = (person, writable, operation) => db.transactions[writable ? 'write' : 'read'](async tx => {
    await sessions.require(tx, person.token, writable ? person.csrf : undefined, true);
    return operation(tx);
  });
  const read = (person = fan, roomId = room) => auth(person, false, tx => readRoomMediaPolicy(tx, roomId, person.id));
  const set = (body, person = owner, roomId = room) => auth(person, true, tx => setRoomMediaPolicy(tx, roomId, person.id, body));
  const reserve = (person = fan, input = inputs[0], roomId = room) => auth(person, true, tx => reserveMedia(tx, person.id, roomId, input));
  const begin = async (person, assetId) => {
    const attempt = await auth(person, true, tx => beginUpload(tx, person.id, assetId, 'test'));
    attempts.push(attempt); return attempt;
  };
  const finish = (person, attempt) => auth(person, true, tx => finishUpload(tx, person.id, attempt, attempt.input.byteLength, sha256));
  const fail = attempt => db.transactions.write(tx => failUpload(tx, attempt));
  const total = () => db.transactions.read(async tx => BigInt((await tx.rows("SELECT reserved_bytes FROM media_budget WHERE id='global'"))[0]?.reserved_bytes ?? 0));
  const counters = () => db.transactions.read(async tx => {
    const [version] = await tx.rows('SELECT policy_version FROM rooms WHERE id=?', [room]);
    const [audit] = await tx.rows("SELECT COUNT(*) AS n FROM audit_events WHERE room_id=? AND action='MEDIA_POLICY_CHANGED'", [room]);
    const [policy] = await tx.rows('SELECT COUNT(*) AS n FROM room_media_policy WHERE room_id=?', [room]);
    return { version: Number(version.policy_version), audit: Number(audit.n), rows: Number(policy.n) };
  });
  const state = assetId => db.transactions.read(async tx => {
    const [asset] = await tx.rows('SELECT state,reserved_bytes,deleted_at FROM media_assets WHERE id=?', [assetId]);
    const objects = await tx.rows('SELECT id,object_key,state,byte_length,sha256 FROM media_objects WHERE asset_id=? ORDER BY id', [assetId]);
    const [jobs] = await tx.rows("SELECT COUNT(*) AS n FROM jobs WHERE purpose='MEDIA' AND resource_id=?", [assetId]);
    return { asset, objects, jobs: Number(jobs.n) };
  });
  return { db, owner, fan, streamer, admin, outside, room, auth, read, set, reserve, begin, finish, fail, total, counters, state };
}

test('room media defaults are member-readable; only the owner STREAMER or manage_rooms capability can change them', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  for (const person of [f.owner, f.fan, f.streamer]) assert.deepEqual(await f.read(person), defaults);
  assert.equal((await f.counters()).rows, 0);
  for (const person of [f.outside, f.admin]) await rejects(f.read(person), 'NOT_FOUND', 404);
  for (const person of [f.fan, f.streamer, f.outside]) await rejects(f.set({ photoEnabled: false }, person), 'FORBIDDEN', 403);
  await f.db.transactions.write(tx => tx.execute('INSERT INTO admin_capabilities (user_id,manage_users,manage_stickers) VALUES (?,1,1)', [f.outside.id]));
  await rejects(f.set({ photoEnabled: false }, f.outside), 'FORBIDDEN', 403);
  assert.equal((await f.set({ photoEnabled: false }, f.admin)).photoEnabled, false);
  assert.equal((await f.set({ photoEnabled: true })).photoEnabled, true);
  // Role alone is insufficient even if owner_member_id still points at this membership.
  await f.db.transactions.write(tx => tx.execute("UPDATE room_members SET role='FAN' WHERE id=?", [f.owner.actor]));
  await rejects(f.set({ photoEnabled: false }), 'FORBIDDEN', 403);
  await f.db.transactions.write(tx => tx.execute("UPDATE room_members SET role='STREAMER' WHERE id=?", [f.owner.actor]));
  await f.db.transactions.write(tx => tx.execute('UPDATE membership_periods SET left_at=UTC_TIMESTAMP(3) WHERE member_id=? AND left_at IS NULL', [f.owner.actor]));
  await rejects(f.set({ photoEnabled: false }), 'FORBIDDEN', 403);
  await rejects(f.read(f.owner), 'NOT_FOUND', 404);
  await rejects(f.set({ photoEnabled: false }, f.admin, randomUUID()), 'NOT_FOUND', 404);
  assert.equal((await f.counters()).audit, 2);
});

test('room media policy rejects unknown fields, invalid shapes/types and values outside global caps atomically', { timeout: 20000 }, async t => {
  const f = await fixture(t); const before = await f.counters();
  const invalid = [null, undefined, [], {}, 'policy', 1, new Date(), Object.create({ photoEnabled: false }),
    { extra: true }, { photoEnabled: true, bucket: 'caller-controlled' }, { [Symbol('unknown')]: true }];
  for (const key of ['photoEnabled', 'videoEnabled', 'stickerEnabled']) {
    for (const value of [null, undefined, 0, 1, 'true', [], {}]) invalid.push({ [key]: value });
  }
  for (const [key, cap] of [['photoMaxBytes', MEDIA_LIMITS.photoBytes], ['videoMaxBytes', MEDIA_LIMITS.videoBytes]]) {
    for (const value of [null, undefined, '1', true, 0, -1, 1.5, NaN, Infinity, cap + 1, Number.MAX_SAFE_INTEGER + 1]) invalid.push({ [key]: value });
  }
  for (const input of invalid) await rejects(f.set(input), 'INVALID_REQUEST', 400);
  assert.deepEqual(await f.counters(), before); assert.deepEqual(await f.read(), defaults);
  assert.deepEqual(await f.set({ photoMaxBytes: MEDIA_LIMITS.photoBytes, videoMaxBytes: MEDIA_LIMITS.videoBytes }), defaults);
  assert.deepEqual(await f.counters(), before);
  const smallest = Object.assign(Object.create(null), { photoMaxBytes: 1, videoMaxBytes: 1 });
  assert.deepEqual(await f.set(smallest), { ...defaults, photoMaxBytes: 1, videoMaxBytes: 1 });
});

test('policy version and fixed audit advance once per actual change, preserving unrelated concurrent patches', { timeout: 20000 }, async t => {
  const f = await fixture(t); const before = await f.counters();
  assert.deepEqual(await f.set({ photoEnabled: true }), defaults);
  assert.deepEqual(await f.counters(), before);
  await f.set({ photoEnabled: false, photoMaxBytes: 100 });
  assert.deepEqual(await f.counters(), { version: before.version + 1, audit: before.audit + 1, rows: 1 });
  await f.set({ photoEnabled: false, photoMaxBytes: 100 });
  assert.deepEqual(await f.counters(), { version: before.version + 1, audit: before.audit + 1, rows: 1 });
  await Promise.all([f.set({ videoEnabled: false }), f.set({ stickerEnabled: false }, f.admin)]);
  assert.deepEqual(await f.counters(), { version: before.version + 3, audit: before.audit + 3, rows: 1 });
  assert.deepEqual(await f.read(), { ...defaults, photoEnabled: false, photoMaxBytes: 100, videoEnabled: false, stickerEnabled: false });
  const audit = await f.db.transactions.read(tx => tx.rows('SELECT actor_user_id,room_id,action FROM audit_events WHERE room_id=?', [f.room]));
  assert.equal(audit.length, 3);
  for (const row of audit) {
    assert.equal(row.action, 'MEDIA_POLICY_CHANGED'); assert.equal(row.room_id, f.room);
    assert.ok([f.owner.id, f.admin.id].includes(row.actor_user_id));
  }
});

test('internal admission enforces all enabled switches, strict positive bytes and global/room caps', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const require = (kind, bytes) => f.auth(f.fan, true, tx => requireRoomMedia(tx, f.room, kind, bytes));
  for (const [kind, cap] of [['PHOTO', MEDIA_LIMITS.photoBytes], ['VIDEO', MEDIA_LIMITS.videoBytes], ['STICKER', MEDIA_LIMITS.stickerBytes]]) {
    await require(kind, cap); await rejects(require(kind, cap + 1), 'INVALID_MEDIA_INTENT', 400);
    for (const bytes of [0, -1, 1.5, NaN, Infinity, '1']) await rejects(require(kind, bytes), 'INVALID_MEDIA_INTENT', 400);
  }
  await rejects(require('AVATAR', 1), 'INVALID_MEDIA_INTENT', 400);
  await f.set({ photoMaxBytes: 100, videoMaxBytes: 200 });
  await require('PHOTO', 100); await rejects(require('PHOTO', 101), 'INVALID_MEDIA_INTENT', 400);
  await require('VIDEO', 200); await rejects(require('VIDEO', 201), 'INVALID_MEDIA_INTENT', 400);
  for (const [kind, key] of [['PHOTO', 'photoEnabled'], ['VIDEO', 'videoEnabled'], ['STICKER', 'stickerEnabled']]) {
    await f.set({ [key]: false }); await rejects(require(kind, 1), 'MEDIA_FORBIDDEN', 403);
    await f.set({ [key]: true }); await require(kind, 1);
  }
});

test('PHOTO/VIDEO disable blocks reserve, begin and finalize without losing durable cleanup; AVATAR is room-independent', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  for (const input of inputs) {
    const enabledKey = input.kind === 'PHOTO' ? 'photoEnabled' : 'videoEnabled';
    const reserved = await f.reserve(f.fan, input);
    const active = await f.reserve(f.owner, input); const attempt = await f.begin(f.owner, active.assetId);
    const before = await f.total(); const reservedState = await f.state(reserved.assetId); const activeState = await f.state(active.assetId);
    await f.set({ [enabledKey]: false });
    await rejects(f.reserve(f.streamer, input), 'MEDIA_FORBIDDEN', 403);
    await rejects(f.begin(f.fan, reserved.assetId), 'MEDIA_FORBIDDEN', 403);
    await rejects(f.finish(f.owner, attempt), 'MEDIA_FORBIDDEN', 403);
    assert.deepEqual(await f.state(reserved.assetId), reservedState);
    assert.deepEqual(await f.state(active.assetId), activeState); assert.equal(await f.total(), before);
    await f.fail(attempt); await f.fail(attempt);
    const cleanup = await f.state(active.assetId);
    assert.equal(cleanup.asset.state, 'DELETING'); assert.ok(cleanup.asset.deleted_at); assert.equal(cleanup.jobs, 1);
    assert.deepEqual(cleanup.objects, activeState.objects); assert.equal(await f.total(), before);
    assert.equal(cleanup.objects[0].object_key, attempt.key);
  }
  const avatar = await f.reserve(f.outside, { kind: 'AVATAR', contentType: 'image/png', byteLength: 1 }, null);
  const attempt = await f.begin(f.outside, avatar.assetId);
  assert.deepEqual(await f.finish(f.outside, attempt), { assetId: avatar.assetId, status: 'processing' });
});

test('stricter room byte limits are rechecked at every upload stage and cleanup survives membership loss', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  for (const input of inputs) {
    const maxKey = input.kind === 'PHOTO' ? 'photoMaxBytes' : 'videoMaxBytes';
    const reserved = await f.reserve(f.fan, input);
    await f.set({ [maxKey]: input.byteLength - 1 });
    const before = await f.total();
    await rejects(f.reserve(f.streamer, input), 'INVALID_MEDIA_INTENT', 400);
    await rejects(f.begin(f.fan, reserved.assetId), 'INVALID_MEDIA_INTENT', 400);
    assert.equal((await f.state(reserved.assetId)).asset.state, 'RESERVED'); assert.equal(await f.total(), before);
    await f.set({ [maxKey]: input.byteLength });
    const attempt = await f.begin(f.fan, reserved.assetId);
    await f.set({ [maxKey]: input.byteLength - 1 });
    await rejects(f.finish(f.fan, attempt), 'INVALID_MEDIA_INTENT', 400);
    assert.equal((await f.state(reserved.assetId)).objects[0].state, 'ALLOCATED');
    await f.fail(attempt);
    assert.equal((await f.state(reserved.assetId)).jobs, 1); assert.equal(await f.total(), before);
  }
  await f.set({ photoMaxBytes: 1024 });
  const reserved = await f.reserve(f.streamer); const attempt = await f.begin(f.streamer, reserved.assetId);
  await f.db.transactions.write(tx => leaveRoom(tx, f.room, f.streamer.id));
  await f.set({ photoEnabled: false });
  await rejects(f.finish(f.streamer, attempt), 'NOT_FOUND', 404);
  await f.fail(attempt);
  const cleanup = await f.state(reserved.assetId); assert.equal(cleanup.asset.state, 'DELETING'); assert.equal(cleanup.jobs, 1);
});

test('command admission observes committed policy revocation even after an older consistent snapshot', { timeout: 20000 }, async t => {
  const f = await fixture(t); let markSnapshot; let release;
  const snapshot = new Promise(resolve => { markSnapshot = resolve; });
  const resumed = new Promise(resolve => { release = resolve; });
  const admission = f.auth(f.fan, true, async tx => {
    // A non-locking read establishes REPEATABLE READ's old snapshot before another TX changes policy.
    await tx.rows('SELECT policy_version FROM rooms WHERE id=?', [f.room]); markSnapshot();
    await resumed;
    await requireRoomMedia(tx, f.room, 'PHOTO', 1);
  });
  const rejected = rejects(admission, 'MEDIA_FORBIDDEN', 403);
  try { await snapshot; await f.set({ photoEnabled: false }); }
  finally { release(); }
  await rejected;
});
