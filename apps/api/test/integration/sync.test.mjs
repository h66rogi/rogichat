import { scopeNewHttpIntent } from '../support/membership-scope-fixture.mjs';
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
  const db = new MysqlDatabase(readConfig('api')); let app;
  t.after(async () => { try { await app?.close(); } finally { await db.close(); } });
  const config = { audience: 'sync-fixture', origin: 'http://localhost:3001', secure: false, key: randomBytes(32) };
  const sessions = new SessionService(new SessionRepository(), config.audience, config.key);
  const user = name => db.transactions.write(async tx => {
    const id = await createUser(tx, name);
    await tx.execute('INSERT INTO platform_soop (id,user_id,provider_subject,verified_at) VALUES (?,?,?,UTC_TIMESTAMP(3))', [randomUUID(), id, Buffer.from(`fixture-${randomUUID()}`)]);
    return { id, ...await sessions.issue(tx, id) };
  });
  const owner = await user('동기화 방장'), fan1 = await user('동기화 팬 하나'), fan2 = await user('동기화 팬 둘'), outsider = await user('동기화 외부인');
  const room = await db.transactions.write(async tx => {
    const id = await createRoom(tx, '동기화 합성방', 'FAN');
    for (const who of [owner, fan1, fan2]) who.actor = await joinRoom(tx, id, who.id);
    await tx.execute("UPDATE room_members SET role='STREAMER' WHERE id=?", [owner.actor]);
    await tx.execute('UPDATE rooms SET owner_member_id=? WHERE id=?', [owner.actor, id]);
    return id;
  });
  app = await createApi(db, new SafeLogger('api', () => {}), undefined, { sessions, config });
  await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
  const call = async (who, method, path, body) => {
    await scopeNewHttpIntent(db, config, who.id, method, path, body);
    const response = await fetch(`${base}/v1${path}`, { method, headers: { Origin: config.origin,
      Cookie: `rogi_session=${who.token}`, 'X-CSRF-Token': who.csrf,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? undefined : await response.json() };
  };
  const device = { deviceId: randomUUID(), cacheId: randomUUID() };
  const sync = (who, path, query = {}) => call(who, 'GET', `${path}?${new globalThis.URLSearchParams({ ...device, ...query })}`);
  const roomSync = (who, endpoint, query = {}) => sync(who, `/rooms/${room}/${endpoint}`, query);
  const send = async (who, text, target, quoteId) => {
    const response = await call(who, 'POST', `/rooms/${room}/messages`, { clientMessageId: randomUUID(),
      intent: target ? 'PRIVATE' : 'SHARED', ...(target ? { recipientActorId: target.actor } : {}),
      ...(quoteId ? { quoteId } : {}), content: { type: 'TEXT', text } });
    assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body.messageId;
  };
  const remove = async (who, id) => { const result = await call(who, 'POST', `/rooms/${room}/messages/${id}/delete`, {}); assert.equal(result.status, 200); };
  return { db, sessions, config, owner, fan1, fan2, outsider, room, call, sync, roomSync, send, remove, device };
}
const ids = messages => messages.map(message => message.id);

test('snapshot/history expose only eligible messages; hidden events cannot affect pagination or hasMore', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const shared1 = await f.send(f.owner, '공개 첫째');
  const own = await f.send(f.fan1, '내 비공개', f.owner);
  const hidden = await f.send(f.fan2, '다른 팬의 비공개', f.owner);
  const shared2 = await f.send(f.owner, '공개 둘째');
  const first = await f.roomSync(f.fan1, 'snapshot', { limit: '2' });
  assert.equal(first.status, 200); assert.deepEqual(ids(first.body.messages), [own, shared2]);
  const history = await f.roomSync(f.fan1, 'history', { cursor: first.body.historyCursor, limit: '2' });
  assert.equal(history.status, 200); assert.deepEqual(ids(history.body.messages), [shared1]); assert.equal(history.body.nextCursor, null);
  const anotherHidden = await f.send(f.fan2, '숨겨진 새 이벤트', f.owner);
  const visible = await f.send(f.owner, '공개 셋째');
  const events = await f.roomSync(f.fan1, 'events', { cursor: first.body.nextCursor, limit: '1' });
  assert.equal(events.status, 200); assert.equal(events.body.resetRequired, false); assert.equal(events.body.hasMore, false);
  assert.deepEqual(ids(events.body.events.map(event => event.message)), [visible]);
  for (const forbidden of [hidden, anotherHidden, f.owner.id, f.fan2.actor, 'created_order', 'event_order', 'stream_id', '다른 팬의 비공개']) {
    assert.ok(!JSON.stringify([first.body, history.body, events.body]).includes(forbidden), forbidden);
  }
  assert.equal(first.body.nextCursor.length, events.body.nextCursor.length);
  assert.notEqual(first.body.nextCursor, events.body.nextCursor);
});

test('fixed event high-water pages defer newer sends; replay projects deletion state instead of stale content', { timeout: 20000 }, async t => {
  const f = await fixture(t); const initial = (await f.roomSync(f.fan1, 'snapshot')).body;
  const one = await f.send(f.owner, '하나'), two = await f.send(f.owner, '둘'), three = await f.send(f.owner, '셋');
  const page1 = (await f.roomSync(f.fan1, 'events', { cursor: initial.nextCursor, limit: '1' })).body;
  assert.equal(page1.hasMore, true); assert.deepEqual(ids(page1.events.map(event => event.message)), [one]);
  const later = await f.send(f.owner, '고정 경계 뒤');
  const page2 = (await f.roomSync(f.fan1, 'events', { cursor: page1.nextCursor, limit: '100' })).body;
  assert.equal(page2.hasMore, false); assert.deepEqual(ids(page2.events.map(event => event.message)), [two, three]);
  const page3 = (await f.roomSync(f.fan1, 'events', { cursor: page2.nextCursor })).body;
  assert.deepEqual(ids(page3.events.map(event => event.message)), [later]);
  await f.remove(f.owner, one);
  const replay = (await f.roomSync(f.fan1, 'events', { cursor: initial.nextCursor })).body;
  const deleted = replay.events.filter(event => event.messageId === one);
  assert.equal(deleted.length, 2);
  for (const event of deleted) assert.deepEqual(event, { type: 'message.deleted', messageId: one, version: '2' });
  assert.ok(!JSON.stringify(replay).includes('하나'));
});

test('cursor bindings and fresh ACL deny other users/devices/rooms, revoked grants and rejoined periods', { timeout: 20000 }, async t => {
  const f = await fixture(t); const privateId = await f.send(f.fan1, '철회될 private', f.owner);
  const first = (await f.roomSync(f.fan1, 'snapshot')).body;
  for (const [who, query] of [[f.fan2, {}], [f.fan1, { deviceId: randomUUID() }], [f.fan1, { cacheId: randomUUID() }], [f.fan1, { cursor: 'forged' }]]) {
    const result = await f.roomSync(who, 'events', { cursor: first.nextCursor, ...query });
    assert.equal(result.status, 200); assert.equal(result.body.resetRequired, true); assert.deepEqual(result.body.events, []);
  }
  const other = await f.db.transactions.write(async tx => { const room = await createRoom(tx, '다른 동기화방', 'GROUP'); await joinRoom(tx, room, f.fan1.id); return room; });
  assert.equal((await f.sync(f.fan1, `/rooms/${other}/events`, { cursor: first.nextCursor })).body.resetRequired, true);
  const fresh = (await f.roomSync(f.fan1, 'snapshot')).body;
  await f.db.transactions.write(tx => tx.execute('UPDATE stream_grants SET revoked_at=UTC_TIMESTAMP(3) WHERE member_id=?', [f.fan1.actor]));
  assert.equal((await f.roomSync(f.fan1, 'events', { cursor: fresh.nextCursor })).body.resetRequired, true);
  assert.ok(!ids((await f.roomSync(f.fan1, 'snapshot')).body.messages).includes(privateId));
  const beforeLeave = (await f.roomSync(f.fan1, 'snapshot')).body;
  assert.equal((await f.call(f.fan1, 'POST', `/rooms/${f.room}/leave`, {})).status, 204);
  assert.equal((await f.roomSync(f.fan1, 'events', { cursor: beforeLeave.nextCursor })).status, 404);
  assert.equal((await f.call(f.fan1, 'POST', `/rooms/${f.room}/join`, {})).status, 200);
  assert.equal((await f.roomSync(f.fan1, 'events', { cursor: beforeLeave.nextCursor })).body.resetRequired, true);
  assert.equal((await f.roomSync(f.outsider, 'snapshot')).status, 404);
});

test('room manifest pages are one generation and membership changes invalidate incomplete replacement', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  await f.db.transactions.write(async tx => { for (let n = 0; n < 2; n++) await joinRoom(tx, await createRoom(tx, `목록 ${n}`, 'GROUP'), f.fan1.id); });
  const first = (await f.sync(f.fan1, '/sync', { limit: '1' })).body;
  assert.equal(first.complete, false); assert.equal(first.rooms.length, 1);
  const next = (await f.sync(f.fan1, '/sync', { limit: '100', cursor: first.nextCursor })).body;
  assert.equal(next.complete, true); assert.equal(next.generation, first.generation); assert.equal(next.rooms.length, 2);
  assert.equal(new Set([...first.rooms, ...next.rooms].map(room => room.roomId)).size, 3);
  for (const room of next.rooms) assert.deepEqual(Object.keys(room).sort(), ['actorId', 'authorizationRevision', 'membershipScope', 'mode', 'name', 'role', 'roomId']);
  await f.call(f.fan1, 'POST', `/rooms/${f.room}/leave`, {});
  const invalid = (await f.sync(f.fan1, '/sync', { cursor: first.nextCursor })).body;
  assert.equal(invalid.resetRequired, true); assert.equal(invalid.complete, false); assert.deepEqual(invalid.rooms, []);
});

test('ACL epoch, room policy and role changes reset cursors; fresh session/subject checks override all tokens', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  for (const mutation of [
    tx => tx.execute('UPDATE room_members SET acl_epoch=acl_epoch+1 WHERE id=?', [f.fan1.actor]),
    tx => tx.execute('UPDATE rooms SET policy_version=policy_version+1 WHERE id=?', [f.room]),
    tx => tx.execute("UPDATE room_members SET role='STREAMER' WHERE id=?", [f.fan1.actor]),
  ]) {
    const snapshot = (await f.roomSync(f.fan1, 'snapshot')).body;
    await f.db.transactions.write(mutation);
    assert.equal((await f.roomSync(f.fan1, 'events', { cursor: snapshot.nextCursor })).body.resetRequired, true);
  }
  const snapshot = (await f.roomSync(f.fan1, 'snapshot')).body;
  await f.db.transactions.write(tx => tx.execute("UPDATE users SET status='SUSPENDED' WHERE id=?", [f.fan1.id]));
  assert.ok([401, 403].includes((await f.roomSync(f.fan1, 'events', { cursor: snapshot.nextCursor })).status));
  await f.db.transactions.write(tx => tx.execute("UPDATE users SET status='ACTIVE' WHERE id=?", [f.fan1.id]));
  await f.db.transactions.write(tx => f.sessions.revoke(tx, f.fan1.token, f.fan1.csrf));
  assert.equal((await f.roomSync(f.fan1, 'events', { cursor: snapshot.nextCursor })).status, 401);
  assert.equal((await f.roomSync(f.fan2, 'events')).status, 400);
  assert.equal((await f.roomSync(f.fan2, 'history')).status, 400);
  assert.equal((await f.roomSync(f.fan2, 'snapshot', { limit: '101' })).status, 400);
  assert.equal((await f.roomSync(f.fan2, 'snapshot', { cursor: snapshot.nextCursor })).status, 400);
});

test('new since-join members get no old deletion IDs, and deleting content owners block fresh snapshot/history', { timeout: 20000 }, async t => {
  const f = await fixture(t); const old = await f.send(f.owner, '입장 전 기록');
  await f.call(f.outsider, 'POST', `/rooms/${f.room}/join`, {});
  const before = (await f.roomSync(f.outsider, 'snapshot')).body;
  assert.deepEqual(before.messages, []);
  await f.remove(f.owner, old);
  const after = (await f.roomSync(f.outsider, 'events', { cursor: before.nextCursor })).body;
  assert.deepEqual(after.events, []); assert.equal(after.resetRequired, false);
  assert.ok(!JSON.stringify(after).includes(old));
  const visible = await f.send(f.owner, '탈퇴 대상 기록');
  assert.ok(ids((await f.roomSync(f.fan2, 'snapshot')).body.messages).includes(visible));
  await f.db.transactions.write(tx => tx.execute("UPDATE users SET status='DELETING' WHERE id=?", [f.owner.id]));
  assert.ok(!ids((await f.roomSync(f.fan2, 'snapshot')).body.messages).includes(visible));
});

test('profile replacement is viewer-specific, generation-stable and birthday revocation resets only streamer projections', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  assert.equal((await f.call(f.fan1, 'PATCH', '/me/profile', { birthday: { month: 2, day: 29 }, birthdayVisibleToStreamers: true })).status, 200);
  const owner = (await f.roomSync(f.owner, 'profile-sync', { limit: '1' })).body;
  const fan = (await f.roomSync(f.fan2, 'profile-sync', { limit: '1' })).body;
  assert.equal(owner.complete, false); assert.equal(fan.complete, false);
  const rest = (await f.roomSync(f.owner, 'profile-sync', { cursor: owner.nextCursor })).body;
  assert.equal(rest.complete, true); assert.equal(rest.generation, owner.generation);
  const profiles = [...owner.profiles, ...rest.profiles];
  assert.equal(profiles.length, 3); assert.deepEqual(profiles.find(profile => profile.actorId === f.fan1.actor).birthday, { month: 2, day: 29 });
  await f.call(f.fan1, 'PATCH', '/me/profile', { birthdayVisibleToStreamers: false });
  const reset = (await f.roomSync(f.owner, 'profile-sync', { cursor: owner.nextCursor })).body;
  assert.equal(reset.resetRequired, true); assert.equal(reset.complete, false); assert.deepEqual(reset.profiles, []);
  const fanRest = (await f.roomSync(f.fan2, 'profile-sync', { cursor: fan.nextCursor })).body;
  assert.equal(fanRest.resetRequired, false); assert.equal(fanRest.generation, fan.generation);
  assert.ok(!JSON.stringify([...fan.profiles, ...fanRest.profiles]).includes(f.fan1.actor));
  assert.ok(!JSON.stringify([...fan.profiles, ...fanRest.profiles]).includes('birthday'));
  assert.ok(!(await f.roomSync(f.owner, 'profile-sync')).body.profiles.some(profile => 'birthday' in profile));
});

test('private root deletion produces only id-less reset for eligible publication viewers and no signal to unrelated fans', { timeout: 20000 }, async t => {
  const f = await fixture(t); const source = await f.send(f.fan1, '공개 삭제 원본', f.owner);
  const privateReply = await f.send(f.owner, '독립 private 답장', f.fan1, source);
  const unrelatedBefore = (await f.roomSync(f.fan2, 'snapshot')).body;
  const ownBefore = (await f.roomSync(f.fan1, 'snapshot')).body;
  await f.remove(f.fan1, source);
  const unrelated = (await f.roomSync(f.fan2, 'events', { cursor: unrelatedBefore.nextCursor })).body;
  assert.equal(unrelated.resetRequired, false); assert.deepEqual(unrelated.events, []); assert.equal(unrelated.hasMore, false);
  const own = (await f.roomSync(f.fan1, 'events', { cursor: ownBefore.nextCursor })).body;
  assert.equal(own.resetRequired, true); assert.deepEqual(own.events, []); assert.ok(!JSON.stringify(own).includes(source));
  assert.equal((await f.roomSync(f.fan1, 'snapshot')).body.messages.find(message => message.id === privateReply).quote, null);
  const second = await f.send(f.fan1, '익명 공개 원본', f.owner);
  const publication = await f.db.transactions.write(async tx => {
    const [stream] = await tx.rows("SELECT id FROM message_streams WHERE room_id=? AND kind='ROOM_SHARED'", [f.room]);
    const id = randomUUID(); const order = await nextOrder(tx, f.room);
    await tx.execute('INSERT INTO messages (id,room_id,stream_id,sender_member_id,content_owner_user_id,deletion_root_id,text_content,created_order) VALUES (?,?,?,?,?,?,?,?)', [id, f.room, stream.id, f.owner.actor, f.fan1.id, second, '익명 공개 원본', String(order)]);
    return id;
  });
  const quotedPublication = await f.send(f.owner, '공개본을 인용한 독립 답장', undefined, publication);
  const direct = await f.call(f.fan2, 'GET', `/rooms/${f.room}/messages/${quotedPublication}`);
  assert.equal(direct.status, 200); assert.equal(direct.body.quote.id, publication);
  const publicBefore = (await f.roomSync(f.fan2, 'snapshot')).body;
  assert.deepEqual(publicBefore.messages.find(message => message.id === publication).author, { kind: 'anonymous' });
  assert.deepEqual(publicBefore.messages.find(message => message.id === quotedPublication).quote, direct.body.quote);
  assert.ok(!JSON.stringify(publicBefore).includes(second));
  await f.remove(f.fan1, second);
  const publicAfter = (await f.roomSync(f.fan2, 'events', { cursor: publicBefore.nextCursor })).body;
  assert.equal(publicAfter.resetRequired, true); assert.deepEqual(publicAfter.events, []);
  assert.ok(!JSON.stringify(publicAfter).includes(second));
  const final = (await f.roomSync(f.fan2, 'snapshot')).body;
  assert.ok(!ids(final.messages).includes(publication));
  assert.equal(final.messages.find(message => message.id === quotedPublication).quote, null);
});

test('C06 shared M/A agrees across join, discovery, manifest, snapshots and profiles; other-room join invalidates only A', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const join = (await f.call(f.fan1, 'POST', `/rooms/${f.room}/join`, {})).body;
  const snapshot = (await f.roomSync(f.fan1, 'snapshot')).body;
  const profile = (await f.roomSync(f.fan1, 'profile-sync')).body;
  const manifest = (await f.sync(f.fan1, '/sync')).body;
  let discovery, after;
  do { const page = (await f.call(f.fan1, 'GET', `/rooms${after ? `?after=${after}` : ''}`)).body; discovery = page.rooms.find(r => r.roomId === f.room); after = page.next; } while (!discovery && after);
  assert.ok(discovery);
  for (const value of [snapshot, profile, manifest.rooms.find(r => r.roomId === f.room), discovery]) {
    assert.equal(value.membershipScope, join.membershipScope); assert.equal(value.authorizationRevision, join.authorizationRevision);
  }
  assert.equal(snapshot.schemaVersion, 2); assert.equal(manifest.schemaVersion, 2);
  assert.equal('membershipScope' in manifest, false); assert.equal('visibleFromOrder' in join, false);
  await f.send(f.fan2, 'hidden activity', f.owner);
  const hidden = (await f.roomSync(f.fan1, 'snapshot')).body;
  assert.equal(hidden.authorizationRevision, snapshot.authorizationRevision); assert.equal(hidden.membershipScope, snapshot.membershipScope);
  const other = await f.db.transactions.write(tx => createRoom(tx, 'scope other room', 'GROUP'));
  await f.call(f.fan1, 'POST', `/rooms/${other}/join`, {});
  const changed = (await f.roomSync(f.fan1, 'snapshot')).body;
  assert.equal(changed.membershipScope, snapshot.membershipScope); assert.notEqual(changed.authorizationRevision, snapshot.authorizationRevision);
  const reset = (await f.roomSync(f.fan1, 'events', { cursor: snapshot.nextCursor })).body;
  assert.deepEqual(reset, { schemaVersion: 2, resetRequired: true, membershipScope: null, authorizationRevision: null, events: [], hasMore: false, nextCursor: null });
});

test('C06 sorts authorized selected messages by millisecond time and UUID without losing the internal history edge', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const old = await f.send(f.owner, 'old internal edge'), middle = await f.send(f.owner, 'middle'), newest = await f.send(f.owner, 'newest');
  await f.db.transactions.write(async tx => {
    await tx.execute('UPDATE messages SET created_at=? WHERE id=?', [new Date('2026-09-20T00:00:00.100Z'), old]);
    await tx.execute('UPDATE messages SET created_at=? WHERE id=?', [new Date('2026-09-20T00:00:00.200Z'), middle]);
    await tx.execute('UPDATE messages SET created_at=? WHERE id=?', [new Date('2026-09-20T00:00:00.100Z'), newest]);
  });
  const page = (await f.roomSync(f.fan1, 'snapshot', { limit: '2' })).body;
  assert.deepEqual(ids(page.messages), [newest, middle]);
  const history = (await f.roomSync(f.fan1, 'history', { cursor: page.historyCursor })).body;
  assert.deepEqual(ids(history.messages), [old]);
  await f.db.transactions.write(tx => tx.execute('UPDATE messages SET created_at=? WHERE room_id=?', [new Date('2026-09-20T00:00:00.123Z'), f.room]));
  const ties = (await f.roomSync(f.fan1, 'snapshot')).body;
  assert.deepEqual(ids(ties.messages), [old, middle, newest].sort());
});

test('C06 MySQL authorization revision preserves original ACL serialization byte-for-byte within audience domain', { timeout: 20000 }, async t => {
  const f = await fixture(t); await f.send(f.fan1, 'grant for parity', f.owner);
  const { createHmac } = await import('node:crypto');
  const { SyncRepository } = await import('../../dist/modules/sync/sync.repository.js');
  const { MembershipRepository } = await import('../../dist/modules/access/membership.repository.js');
  const { MessagesQueryRepository } = await import('../../dist/modules/messages/messages-query.repository.js');
  const expected = await f.db.transactions.read(async tx => {
    const viewer = await new MembershipRepository().findActive(tx, f.room, f.fan1.id);
    const repo = new SyncRepository(); const [state] = await repo.state(tx, viewer.id);
    const grants = await repo.grants(tx, f.room, viewer.id);
    const revoked = (await new MessagesQueryRepository().stickerRevocations(tx, f.room, viewer.id, viewer.visible_from_order)).map(row => row.id);
    const vector = [viewer.id, viewer.role, viewer.mode, viewer.active_period_id, viewer.visible_from_order, String(state.acl_epoch), state.policy_version, String(state.membership_generation), grants, revoked];
    return createHmac('sha256', f.config.key).update('authorization-revision:v1:').update(JSON.stringify([f.config.audience, vector])).digest('base64url');
  });
  const snapshot = (await f.roomSync(f.fan1, 'snapshot')).body;
  assert.equal(snapshot.authorizationRevision, expected);
});
