import { users } from '../support/domain-fixture.mjs';
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';

const keys = value => Object.keys(value).sort();
const denied = promise => assert.rejects(promise, { code: 'NOT_FOUND' });

async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api'));
  t.after(() => db.close());
  const key = randomBytes(32);
  const sessions = new SessionService(new SessionRepository(), 'avatar-fixture', key);
  const profiles = users;
  // Test-only persisted users/sessions; no production authentication bypass or external identity.
  const user = nickname => db.transactions.write(async tx => {
    const id = randomUUID();
    await tx.execute('INSERT INTO users (id) VALUES (?)', [id]);
    await tx.execute('INSERT INTO user_profiles (user_id,nickname) VALUES (?,?)', [id, nickname]);
    await tx.execute('INSERT INTO platform_soop (id,user_id,provider_subject,verified_at) VALUES (?,?,?,UTC_TIMESTAMP(3))', [randomUUID(), id, Buffer.from(randomUUID())]);
    return { id, nickname, ...await sessions.issue(tx, id) };
  });
  const streamer = await user('아바타 합성 스트리머'), a = await user('아바타 합성 팬 하나'), b = await user('아바타 합성 팬 둘');
  const room = await db.transactions.write(async tx => {
    const id = randomUUID();
    await tx.execute("INSERT INTO rooms (id,name,mode) VALUES (?,?,'FAN')", [id, '아바타 합성방']);
    for (const person of [streamer, a, b]) {
      person.actor = randomUUID();
      const period = randomUUID();
      await tx.execute('INSERT INTO room_members (id,room_id,user_id,role) VALUES (?,?,?,?)', [person.actor, id, person.id, person === streamer ? 'STREAMER' : 'FAN']);
      await tx.execute("INSERT INTO membership_periods (id,room_id,member_id,policy_version,history_policy,visible_from_order) VALUES (?,?,?,1,'SINCE_JOIN',0)", [period, id, person.actor]);
      await tx.execute('UPDATE room_members SET active_period_id=? WHERE id=?', [period, person.actor]);
    }
    await tx.execute('UPDATE rooms SET owner_member_id=? WHERE id=?', [streamer.actor, id]);
    return id;
  });
  const auth = (person, writable, action) => db.transactions[writable ? 'write' : 'read'](async tx => {
    await sessions.require(tx, person.token, writable ? person.csrf : undefined, true);
    return action(tx);
  });
  const update = (person, body) => auth(person, true, tx => profiles.updateProfile(tx, person.id, body));
  const self = person => auth(person, false, tx => profiles.selfProfile(tx, person.id));
  const actor = (viewer, person) => auth(viewer, false, tx => profiles.roomProfile(tx, room, viewer.id, person.actor, key));
  // Synthetic asset state is solely profile/authorization setup: NOT decoder, quota, or R2 proof.
  const asset = (person = a, options = {}) => db.transactions.write(async tx => {
    const id = randomUUID();
    const { kind = 'AVATAR', roomId = null, state = 'READY', expired = false, deleted = false } = options;
    await tx.execute(`INSERT INTO media_assets (id,owner_user_id,room_id,kind,content_type,state,declared_bytes,reserved_bytes,expires_at,deleted_at)
      VALUES (?,?,?,?,'image/png',?,32,0,TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3)),${deleted ? 'UTC_TIMESTAMP(3)' : 'NULL'})`, [id, person.id, roomId, kind, state, expired ? -1 : 3600]);
    if (state === 'READY') {
      const attempt = randomUUID();
      await tx.execute("INSERT INTO media_objects (id,asset_id,attempt_id,variant,object_key,state,byte_length,sha256,width,height) VALUES (?,?,?,'image',?,'READY',32,?,1,1)", [randomUUID(), id, attempt, `test/${id}/${attempt}/image`, 'a'.repeat(64)]);
    }
    return id;
  });
  const changes = person => db.transactions.read(tx => tx.rows('SELECT id,public_changed,streamer_changed FROM profile_changes WHERE user_id=? ORDER BY id', [person.id]));
  const state = id => db.transactions.read(async tx => {
    const [row] = await tx.rows('SELECT state,deleted_at,reserved_bytes FROM media_assets WHERE id=?', [id]);
    const jobs = await tx.rows("SELECT id,state FROM jobs WHERE purpose='MEDIA' AND resource_id=?", [id]);
    return { row, jobs };
  });
  return { db, profiles, streamer, a, b, room, auth, update, self, actor, asset, changes, state };
}

test('own READY room-null avatar attaches with minimal self/actor DTOs and FAN profile privacy', { timeout: 20000 }, async t => {
  const f = await fixture(t), avatar = await f.asset();
  const result = await f.update(f.a, { avatarAssetId: avatar });
  assert.deepEqual(keys(result), ['avatar', 'birthday', 'birthdayVisibleToStreamers', 'id', 'nickname']);
  assert.deepEqual(result.avatar, { assetId: avatar });
  assert.deepEqual(await f.self(f.a), result);
  const visible = await f.actor(f.streamer, f.a);
  assert.deepEqual(keys(visible), ['actorId', 'avatar', 'nickname', 'revision', 'role']);
  assert.deepEqual(visible.avatar, { assetId: avatar });
  assert.equal(visible.actorId, f.a.actor);
  assert.ok(!JSON.stringify(visible).includes(f.a.id));
  assert.deepEqual((await f.actor(f.a, f.a)).avatar, { assetId: avatar });
  await denied(f.actor(f.b, f.a));
  const streamerAvatar = await f.asset(f.streamer);
  await f.update(f.streamer, { avatarAssetId: streamerAvatar });
  assert.deepEqual((await f.actor(f.b, f.streamer)).avatar, { assetId: streamerAvatar });
});

test('avatar initial attachment rejects foreign, PHOTO, room-scoped, quarantine, deleted and expired assets without side effects', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const candidates = [
    await f.asset(f.b), await f.asset(f.a, { kind: 'PHOTO' }), await f.asset(f.a, { kind: 'PHOTO', roomId: f.room }),
    await f.asset(f.a, { roomId: f.room }), await f.asset(f.a, { state: 'RESERVED' }),
    await f.asset(f.a, { state: 'PROCESSING' }), await f.asset(f.a, { deleted: true }),
    await f.asset(f.a, { state: 'DELETING', deleted: true }), await f.asset(f.a, { state: 'DELETED', deleted: true }),
    await f.asset(f.a, { expired: true }), randomUUID(),
  ];
  const before = await f.self(f.a);
  for (const id of candidates) await denied(f.update(f.a, { avatarAssetId: id }));
  assert.deepEqual(await f.self(f.a), before);
  assert.deepEqual(await f.changes(f.a), []);
});

test('avatar replacement/removal block old media and enqueue cleanup atomically, including transaction rollback', { timeout: 20000 }, async t => {
  const f = await fixture(t), old = await f.asset(), next = await f.asset();
  await f.update(f.a, { avatarAssetId: old });
  const changesBefore = await f.changes(f.a);
  const abort = new Error('fixture_rollback_after_avatar_and_jobs');
  const rollbackUpdate = body => assert.rejects(f.auth(f.a, true, async tx => {
    await f.profiles.updateProfile(tx, f.a.id, body);
    throw abort;
  }), error => error === abort);
  await rollbackUpdate({ avatarAssetId: next });
  assert.deepEqual((await f.self(f.a)).avatar, { assetId: old });
  assert.deepEqual(await f.changes(f.a), changesBefore);
  assert.equal((await f.state(old)).row.state, 'READY');
  assert.deepEqual((await f.state(old)).jobs, []);
  assert.equal((await f.state(next)).row.state, 'READY');
  await f.update(f.a, { avatarAssetId: next });
  const removed = await f.state(old);
  assert.equal(removed.row.state, 'DELETING'); assert.ok(removed.row.deleted_at);
  assert.equal(removed.jobs.length, 1); assert.equal(removed.jobs[0].state, 'PENDING');
  assert.deepEqual((await f.self(f.a)).avatar, { assetId: next });
  await rollbackUpdate({ avatarAssetId: null });
  assert.deepEqual((await f.self(f.a)).avatar, { assetId: next });
  assert.equal((await f.state(next)).row.state, 'READY'); assert.deepEqual((await f.state(next)).jobs, []);
  await f.update(f.a, { avatarAssetId: null });
  assert.equal((await f.self(f.a)).avatar, null);
  assert.equal((await f.state(next)).row.state, 'DELETING');
  assert.equal((await f.state(next)).jobs.length, 1);
  await f.update(f.a, { avatarAssetId: null });
  assert.equal((await f.state(next)).jobs.length, 1);
});

test('avatar changes emit only public profile flags; duplicate assignments do not emit changes or cleanup', { timeout: 20000 }, async t => {
  const f = await fixture(t), avatar = await f.asset();
  await f.update(f.a, { birthday: { month: 3, day: 4 } });
  assert.deepEqual(await f.changes(f.a), []);
  const before = await f.actor(f.streamer, f.a);
  await f.update(f.a, { avatarAssetId: avatar });
  const assigned = await f.changes(f.a);
  assert.equal(assigned.length, 1);
  assert.equal(Number(assigned[0].public_changed), 1);
  assert.equal(Number(assigned[0].streamer_changed), 0);
  const after = await f.actor(f.streamer, f.a);
  assert.notEqual(after.revision, before.revision);
  await f.update(f.a, { avatarAssetId: avatar });
  assert.deepEqual(await f.changes(f.a), assigned);
  assert.deepEqual(await f.actor(f.streamer, f.a), after);
  assert.deepEqual((await f.state(avatar)).jobs, []);
  await f.update(f.a, { avatarAssetId: null });
  const removed = await f.changes(f.a);
  assert.equal(removed.length, 2);
  assert.ok(removed.every(row => Number(row.public_changed) === 1 && Number(row.streamer_changed) === 0));
});

test('an already assigned avatar remains assignable after intent expiry without changing public revision or scheduling deletion', { timeout: 20000 }, async t => {
  const f = await fixture(t), avatar = await f.asset();
  await f.update(f.a, { avatarAssetId: avatar });
  const before = await f.actor(f.streamer, f.a), changes = await f.changes(f.a);
  await f.db.transactions.write(tx => tx.execute('UPDATE media_assets SET expires_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE id=?', [avatar]));
  // Reservation expiry applies to initial attachment, not an already installed current reference.
  const result = await f.update(f.a, { avatarAssetId: avatar });
  assert.deepEqual(result.avatar, { assetId: avatar });
  assert.deepEqual(await f.actor(f.streamer, f.a), before);
  assert.deepEqual(await f.changes(f.a), changes);
  assert.equal((await f.state(avatar)).row.state, 'READY');
  assert.deepEqual((await f.state(avatar)).jobs, []);
});
