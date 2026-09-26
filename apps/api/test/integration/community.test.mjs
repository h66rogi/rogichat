import { createUser, createRoom, joinRoom, nextOrder } from '../support/domain-fixture.mjs';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { createApi } from '../../dist/application.js';
import { SafeLogger } from '../../dist/infrastructure/observability/logging.js';

async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api'));
  let app;
  t.after(async () => { try { await app?.close(); } finally { await db.close(); } });
  const config = { audience: 'community-fixture', origin: 'http://localhost:3001', secure: false, key: randomBytes(32) };
  const sessions = new SessionService(new SessionRepository(), config.audience, config.key);
  // Only this test process can issue fixture sessions; no production auth bypass route.
  const user = (name, { creator = false, admin = false, linked = true } = {}) => db.transactions.write(async tx => {
    const id = await createUser(tx, name);
    if (linked) await tx.execute('INSERT INTO platform_soop (id,user_id,provider_subject,verified_at) VALUES (?,?,?,UTC_TIMESTAMP(3))', [randomUUID(), id, Buffer.from(`fixture-${randomUUID()}`)]);
    if (creator) await tx.execute('INSERT INTO creator_accounts (user_id,enabled) VALUES (?,1)', [id]);
    if (admin) await tx.execute('INSERT INTO admin_capabilities (user_id,manage_rooms,manage_users) VALUES (?,1,0)', [id]);
    return { id, ...await sessions.issue(tx, id) };
  });
  const people = {
    fan1: await user('합성 팬 하나'), fan2: await user('합성 팬 둘'),
    streamer1: await user('합성 스트리머 하나', { creator: true }), streamer2: await user('합성 스트리머 둘', { creator: true }),
    admin: await user('합성 관리자', { admin: true }), unlinked: await user('합성 미연결', { linked: false }),
  };
  app = await createApi(db, new SafeLogger('api', () => {}), undefined, { sessions, config });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const call = async (who, method, path, body, headers = {}) => {
    const response = await fetch(`${base}/v1${path}`, { method, headers: {
      Origin: config.origin, Cookie: `rogi_session=${who.token}`, 'X-CSRF-Token': who.csrf,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers,
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? undefined : await response.json() };
  };
  const provision = async (owner, mode = 'FAN', historyPolicy = 'SINCE_JOIN') => {
    const result = await call(people.admin, 'POST', '/admin/rooms', { name: '합성 시험방', mode, ownerUserId: owner.id, historyPolicy });
    assert.equal(result.status, 201); return result.body;
  };
  const join = async (who, room) => {
    const result = await call(who, 'POST', `/rooms/${room.roomId}/join`, {});
    assert.equal(result.status, 200); return result.body;
  };
  const profile = (who, room, actor) => call(who, 'GET', `/rooms/${room.roomId}/actors/${actor}/profile`);
  return { db, ...people, call, provision, join, profile };
}

test('birthday global consent is role/room scoped, applies to new rooms, and hides privacy-only changes from fans', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const a = await f.provision(f.streamer1);
  const b = await f.provision(f.streamer2, 'GROUP');
  const fa = await f.join(f.fan1, a); await f.join(f.fan2, a);
  const fb = await f.join(f.fan1, b); await f.join(f.fan2, b); await f.join(f.streamer1, b);
  let result = await f.call(f.fan1, 'PATCH', '/me/profile', { birthday: { month: 2, day: 29 } });
  assert.equal(result.status, 200); assert.equal(result.body.birthdayVisibleToStreamers, false);
  const hidden = await f.profile(f.streamer1, a, fa.actorId);
  assert.equal(hidden.status, 200); assert.ok(!('birthday' in hidden.body.profile));
  result = await f.call(f.fan1, 'PATCH', '/me/profile', { birthdayVisibleToStreamers: true }); assert.equal(result.status, 200);
  const shown = await f.profile(f.streamer1, a, fa.actorId);
  assert.deepEqual(shown.body.profile.birthday, { month: 2, day: 29 });
  assert.notEqual(shown.body.profile.revision, hidden.body.profile.revision);
  assert.deepEqual(Object.keys(shown.body).sort(), ['profile', 'replace']); assert.equal(shown.body.replace, true);
  assert.deepEqual(Object.keys(shown.body.profile).sort(), ['actorId', 'avatar', 'birthday', 'nickname', 'revision', 'role']);
  assert.ok(!JSON.stringify(shown.body).includes(f.fan1.id));
  assert.deepEqual((await f.profile(f.streamer2, b, fb.actorId)).body.profile.birthday, { month: 2, day: 29 });
  // Being a creator/streamer elsewhere never grants streamer projection in this room.
  const fanView = await f.profile(f.streamer1, b, fb.actorId);
  assert.equal(fanView.status, 200); assert.ok(!('birthday' in fanView.body.profile));
  const peerView = await f.profile(f.fan2, b, fb.actorId); assert.ok(!('birthday' in peerView.body.profile));
  assert.equal((await f.profile(f.fan2, a, fa.actorId)).status, 404);
  assert.equal((await f.profile(f.streamer2, a, fa.actorId)).status, 404);
  assert.equal((await f.profile(f.admin, a, fa.actorId)).status, 404);
  assert.equal((await f.profile(f.streamer1, a, fb.actorId)).status, 404);
  await f.join(f.admin, b);
  const adminView = await f.profile(f.admin, b, fb.actorId);
  assert.equal(adminView.status, 200); assert.ok(!('birthday' in adminView.body.profile));
  const newer = await f.provision(f.streamer1); const fn = await f.join(f.fan1, newer);
  assert.deepEqual((await f.profile(f.streamer1, newer, fn.actorId)).body.profile.birthday, { month: 2, day: 29 });
  const beforeManifest = await f.call(f.streamer1, 'GET', `/rooms/${a.roomId}/profile-revisions`);
  assert.equal(beforeManifest.status, 200); assert.equal(beforeManifest.body.partial, true);
  assert.deepEqual(Object.keys(beforeManifest.body.profiles[0]).sort(), ['actorId', 'revision']);
  assert.equal((await f.call(f.fan1, 'GET', `/rooms/${a.roomId}/profile-revisions`)).status, 403);
  assert.equal((await f.call(f.fan1, 'PATCH', '/me/profile', { birthdayVisibleToStreamers: false })).status, 200);
  const withdrawn = await f.profile(f.streamer1, a, fa.actorId);
  assert.ok(!('birthday' in withdrawn.body.profile)); assert.notEqual(withdrawn.body.profile.revision, shown.body.profile.revision);
  assert.deepEqual((await f.profile(f.streamer1, b, fb.actorId)).body, fanView.body);
  assert.deepEqual((await f.profile(f.fan2, b, fb.actorId)).body, peerView.body);
  assert.ok(!('birthday' in (await f.profile(f.streamer2, b, fb.actorId)).body.profile));
  assert.ok(!('birthday' in (await f.profile(f.streamer1, newer, fn.actorId)).body.profile));
  const manifest = await f.call(f.streamer1, 'GET', `/rooms/${a.roomId}/profile-revisions`);
  assert.notEqual(manifest.body.profiles.find(p => p.actorId === fa.actorId).revision, beforeManifest.body.profiles.find(p => p.actorId === fa.actorId).revision);
  await f.call(f.fan1, 'PATCH', '/me/profile', { birthday: { month: 12, day: 31 } });
  assert.deepEqual((await f.profile(f.fan2, b, fb.actorId)).body, peerView.body);
  await f.call(f.fan1, 'POST', `/rooms/${a.roomId}/leave`, {});
  assert.equal((await f.profile(f.streamer1, a, fa.actorId)).status, 404);
});

test('admin provisioning requires explicit capabilities and creator owner; no joining account auto-promotes', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const input = { name: '권한 시험방', mode: 'FAN', ownerUserId: f.streamer1.id, historyPolicy: 'SINCE_JOIN' };
  for (const person of [f.fan1, f.streamer1]) assert.equal((await f.call(person, 'POST', '/admin/rooms', input)).status, 403);
  assert.equal((await f.call(f.admin, 'POST', '/admin/rooms', { ...input, ownerUserId: f.fan1.id })).status, 400);
  assert.equal((await f.call(f.admin, 'POST', '/admin/rooms', { ...input, ownerUserId: undefined })).status, 400);
  const room = await f.provision(f.streamer1);
  assert.deepEqual(Object.keys(room).sort(), ['ownerActorId', 'roomId']);
  const joined = await f.join(f.admin, room);
  assert.equal((await f.profile(f.admin, room, joined.actorId)).body.profile.role, 'FAN');
  assert.equal((await f.profile(f.admin, room, room.ownerActorId)).body.profile.role, 'STREAMER');
  assert.equal((await f.call(f.streamer1, 'POST', `/rooms/${room.roomId}/leave`, {})).status, 204);
  assert.equal((await f.call(f.admin, 'GET', `/rooms/${room.roomId}/profile-revisions`)).status, 404);
  assert.equal((await f.call(f.admin, 'POST', `/rooms/${room.roomId}/join`, {})).status, 404);
  assert.equal((await f.call(f.streamer1, 'POST', `/rooms/${room.roomId}/join`, {})).status, 404);
  const emptyId = await f.db.transactions.write(tx => createRoom(tx, '방장 없는 합성 방', 'FAN'));
  const entered = await f.join(f.streamer2, { roomId: emptyId });
  const [stored] = await f.db.transactions.read(tx => tx.rows('SELECT r.owner_member_id,m.role FROM rooms r JOIN room_members m ON m.room_id=r.id WHERE r.id=? AND m.id=?', [emptyId, entered.actorId]));
  assert.equal(stored.owner_member_id, null); assert.equal(stored.role, 'FAN');
  assert.equal((await f.call(f.streamer2, 'PATCH', `/rooms/${emptyId}/history-policy`, { historyPolicy: 'ALL_AVAILABLE' })).status, 403);
  const events = await f.db.transactions.read(tx => tx.rows('SELECT action FROM audit_events WHERE room_id=?', [room.roomId]));
  assert.deepEqual(events.map(row => row.action), ['ROOM_CREATED']);
});

test('membership history remains fixed until rejoin, owner/admin policy changes are audited and DTOs exclude private keys', { timeout: 20000 }, async t => {
  const f = await fixture(t); const room = await f.provision(f.streamer1);
  const original = await f.join(f.fan1, room);
  assert.equal(original.historyPolicy, 'SINCE_JOIN'); assert.match(original.membershipScope, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(Object.keys(original).sort(), ['actorId', 'authorizationRevision', 'historyPolicy', 'membershipScope', 'policyVersion']);
  assert.equal((await f.call(f.fan1, 'PATCH', `/rooms/${room.roomId}/history-policy`, { historyPolicy: 'ALL_AVAILABLE' })).status, 403);
  assert.equal((await f.call(f.streamer1, 'PATCH', `/rooms/${room.roomId}/history-policy`, { historyPolicy: 'ALL_AVAILABLE' })).status, 200);
  const samePeriod = await f.join(f.fan1, room);
  assert.equal(samePeriod.membershipScope, original.membershipScope);
  assert.notEqual(samePeriod.authorizationRevision, original.authorizationRevision);
  assert.equal(samePeriod.historyPolicy, original.historyPolicy);
  assert.equal((await f.call(f.fan1, 'POST', `/rooms/${room.roomId}/leave`, {})).status, 204);
  const again = await f.join(f.fan1, room);
  assert.equal(again.actorId, original.actorId); assert.equal(again.historyPolicy, 'ALL_AVAILABLE'); assert.notEqual(again.membershipScope, original.membershipScope);
  assert.ok(again.policyVersion > original.policyVersion);
  await f.call(f.fan1, 'POST', `/rooms/${room.roomId}/leave`, {});
  await f.call(f.admin, 'PATCH', `/rooms/${room.roomId}/history-policy`, { historyPolicy: 'SINCE_JOIN' });
  await f.db.transactions.write(tx => nextOrder(tx, room.roomId));
  const third = await f.join(f.fan1, room);
  assert.notEqual(third.membershipScope, again.membershipScope);
  const periods = await f.db.transactions.read(tx => tx.rows('SELECT left_at,history_policy FROM membership_periods WHERE member_id=?', [original.actorId]));
  assert.equal(periods.length, 3); assert.equal(periods.filter(row => row.left_at === null).length, 1);
  const listed = await f.call(f.fan1, 'GET', '/rooms'); assert.equal(listed.status, 200);
  const item = listed.body.rooms.find(value => value.roomId === room.roomId);
  assert.deepEqual(Object.keys(item).sort(), ['actorId', 'authorizationRevision', 'joined', 'membershipScope', 'mode', 'name', 'roomId']);
  const events = await f.db.transactions.read(tx => tx.rows('SELECT action FROM audit_events WHERE room_id=?', [room.roomId]));
  assert.equal(events.filter(row => row.action === 'HISTORY_POLICY_CHANGED').length, 2);
});

test('community HTTP rejects missing CSRF, unlinked chat, overbroad fields and revoked identities', { timeout: 20000 }, async t => {
  const f = await fixture(t); const room = await f.provision(f.streamer1);
  assert.equal((await f.call(f.unlinked, 'GET', '/me/profile')).status, 200);
  assert.equal((await f.call(f.unlinked, 'GET', '/rooms')).status, 403);
  assert.equal((await f.call(f.unlinked, 'POST', `/rooms/${room.roomId}/join`, {})).status, 403);
  for (const headers of [{ 'X-CSRF-Token': '' }, { 'X-CSRF-Token': randomBytes(32).toString('base64url') }, { Origin: 'https://evil.invalid' }]) {
    assert.ok([400, 403].includes((await f.call(f.fan1, 'PATCH', '/me/profile', { nickname: '불허 변경' }, headers)).status));
  }
  for (const body of [{ birthday: { month: 2, day: 30 } }, { birthday: { month: 1, day: 1, year: 2000 } },
    { birthdayVisibleToStreamers: 'true' }, { role: 'STREAMER' }, { userId: f.streamer1.id }, {}]) {
    assert.equal((await f.call(f.fan1, 'PATCH', '/me/profile', body)).status, 400);
  }
  assert.equal((await f.call(f.fan1, 'POST', `/rooms/${room.roomId}/join`, { role: 'STREAMER' })).status, 400);
  const self = await f.call(f.fan1, 'GET', '/me/profile');
  assert.deepEqual(Object.keys(self.body).sort(), ['avatar', 'birthday', 'birthdayVisibleToStreamers', 'capabilities', 'id', 'nickname', 'onboardingState', 'providerAvatarUrl', 'soop', 'soopLinkStatus']);
  assert.equal(self.body.nickname, '합성 팬 하나');
  await f.db.transactions.write(tx => tx.execute("UPDATE platform_soop SET status='REVOKED' WHERE user_id=?", [f.fan1.id]));
  assert.equal((await f.call(f.fan1, 'GET', '/rooms')).status, 403);
  await f.db.transactions.write(tx => tx.execute("UPDATE users SET status='SUSPENDED' WHERE id=?", [f.fan2.id]));
  assert.equal((await f.call(f.fan2, 'GET', '/me/profile')).status, 401);
});

test('profile revision pages and room listing obey the 50-item boundary without duplicates or hidden-field projection', { timeout: 20000 }, async t => {
  const f = await fixture(t); const room = await f.provision(f.streamer1);
  const actors = new Set([room.ownerActorId]);
  const rooms = new Set([room.roomId]);
  for (let index = 0; index < 51; index++) {
    const made = await f.db.transactions.write(async tx => {
      const id = await createUser(tx, `페이지 합성 ${index}`);
      await tx.execute('INSERT INTO platform_soop (id,user_id,provider_subject,verified_at) VALUES (?,?,?,UTC_TIMESTAMP(3))', [randomUUID(), id, Buffer.from(`fixture-page-${randomUUID()}`)]);
      return { actor: await joinRoom(tx, room.roomId, id), room: await createRoom(tx, `목록 합성 ${index}`, 'GROUP') };
    });
    actors.add(made.actor); rooms.add(made.room);
  }
  const first = await f.call(f.streamer1, 'GET', `/rooms/${room.roomId}/profile-revisions`);
  assert.equal(first.status, 200); assert.equal(first.body.partial, true);
  assert.equal(first.body.profiles.length, 50); assert.equal(first.body.next, first.body.profiles.at(-1).actorId);
  const second = await f.call(f.streamer1, 'GET', `/rooms/${room.roomId}/profile-revisions?after=${first.body.next}`);
  assert.equal(second.status, 200); assert.equal(second.body.profiles.length, 2); assert.equal(second.body.next, null);
  const combined = [...first.body.profiles, ...second.body.profiles];
  assert.deepEqual(new Set(combined.map(p => p.actorId)), actors);
  for (const value of combined) assert.deepEqual(Object.keys(value).sort(), ['actorId', 'revision']);
  const found = [];
  let cursor;
  do {
    const page = await f.call(f.fan1, 'GET', `/rooms${cursor ? `?after=${cursor}` : ''}`);
    assert.equal(page.status, 200); assert.ok(page.body.rooms.length <= 50);
    if (page.body.next) assert.equal(page.body.next, page.body.rooms.at(-1).roomId);
    found.push(...page.body.rooms.map(value => value.roomId)); cursor = page.body.next;
  } while (cursor);
  assert.equal(new Set(found).size, found.length);
  for (const id of rooms) assert.ok(found.includes(id));
});
