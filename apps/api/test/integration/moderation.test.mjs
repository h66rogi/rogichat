import { deletionFixture } from '../support/deletion-fixture.mjs';

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
  const db = new MysqlDatabase(readConfig('api')); const deletion = deletionFixture(); let app;
  t.after(async () => { try { await app?.close(); } finally { await db.close(); } });
  const config = { audience: 'moderation-fixture', origin: 'http://localhost:3001', secure: false, key: randomBytes(32) };
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
  app = await createApi(db, new SafeLogger('api', () => {}), undefined, { sessions, config }, undefined, 'test', deletion);
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
const reportBody = () => ({ idempotencyKey: randomUUID(), reason: 'harassment', detail: '합성 신고 상세' });
const path = (f, id) => `/rooms/${f.room}/messages/${id}/reports`;

test('report commits a minimal receipt, recovers lost response, isolates IDOR and survives message deletion', { timeout: 30000 }, async t => {
  const f = await fixture(t); const message = await f.send(f.owner, '합성 신고 대상'); const body = reportBody();
  const result = await f.call(f.fan1, 'POST', path(f, message), body);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(Object.keys(result.body).sort(), ['createdAt', 'reportId', 'status']);
  assert.equal(result.body.status, 'received');
  assert.deepEqual((await f.call(f.fan1, 'GET', `/report-receipts/${body.idempotencyKey}`)).body, result.body);
  assert.equal((await f.call(f.fan2, 'GET', `/reports/${result.body.reportId}`)).status, 404);
  assert.equal((await f.call(f.fan2, 'GET', `/report-receipts/${body.idempotencyKey}`)).status, 404);
  const replay = await f.call(f.fan1, 'POST', path(f, message), body);
  assert.deepEqual(replay.body, result.body);
  // Avoid the intentionally strict report burst limiter before another command.
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal((await f.call(f.fan1, 'POST', path(f, message), { ...body, reason: 'spam' })).status, 409);
  await f.remove(f.owner, message);
  assert.deepEqual((await f.call(f.fan1, 'GET', `/report-receipts/${body.idempotencyKey}`)).body, result.body);
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.deepEqual((await f.call(f.fan1, 'POST', path(f, message), body)).body, result.body);
  const unseen = await f.send(f.fan2, '다른 팬 비공개', f.owner);
  assert.equal((await f.call(f.fan1, 'POST', path(f, unseen), reportBody())).status, 404);
});

test('personal FAN block isolates reads and direct interactions without evicting peers; unblock restores retained content', { timeout: 30000 }, async t => {
  const f = await fixture(t); const shared = await f.send(f.owner, '차단 전 공개');
  const direct = await f.send(f.owner, '차단 전 개인', f.fan1);
  const snapshot = await f.roomSync(f.fan1, 'snapshot');
  const peerSnapshot = await f.roomSync(f.fan2, 'snapshot');
  const blockPath = `/rooms/${f.room}/blocks/${f.owner.actor}`;
  assert.equal((await f.call(f.fan1, 'PUT', `/rooms/${f.room}/blocks/${f.fan2.actor}`, {})).status, 404);
  assert.equal((await f.call(f.fan1, 'PUT', `/rooms/${f.room}/blocks/${randomUUID()}`, {})).status, 404);
  const result = await f.call(f.fan1, 'PUT', blockPath, {});
  assert.deepEqual(result.body, { actorId: f.owner.actor, blocked: true, resetRequired: true });
  for (const id of [shared, direct]) {
    assert.equal((await f.call(f.fan1, 'GET', `/rooms/${f.room}/messages/${id}`)).status, 404);
    assert.equal((await f.call(f.fan1, 'GET', `/rooms/${f.room}/messages/${id}/reactions`)).status, 404);
  }
  assert.equal((await f.call(f.fan2, 'GET', `/rooms/${f.room}/messages/${shared}`)).status, 200);
  const blockedSnapshot = await f.roomSync(f.fan1, 'snapshot');
  assert.equal(blockedSnapshot.body.messages.length, 0);
  assert.equal(blockedSnapshot.body.membershipScope, snapshot.body.membershipScope);
  assert.notEqual(blockedSnapshot.body.authorizationRevision, snapshot.body.authorizationRevision);
  assert.equal((await f.roomSync(f.fan2, 'snapshot')).body.authorizationRevision, peerSnapshot.body.authorizationRevision);
  const stale = await f.roomSync(f.fan1, 'events', { cursor: snapshot.body.nextCursor });
  assert.equal(stale.body.resetRequired, true);
  for (const [sender, target] of [[f.owner, f.fan1], [f.fan1, f.owner]]) {
    const result = await f.call(sender, 'POST', `/rooms/${f.room}/messages`, { clientMessageId: randomUUID(), intent: 'PRIVATE', recipientActorId: target.actor, content: { type: 'TEXT', text: '차단된 전송' } });
    assert.equal(result.status, 404);
  }
  assert.deepEqual((await f.call(f.fan1, 'GET', `/rooms/${f.room}/private-recipients`)).body.recipients, []);
  const list = await f.call(f.fan1, 'GET', `/rooms/${f.room}/blocks`);
  assert.equal(list.body.blocks[0].actorId, f.owner.actor);
  assert.deepEqual((await f.call(f.fan1, 'DELETE', blockPath)).body, { actorId: f.owner.actor, blocked: false, resetRequired: true });
  assert.equal((await f.call(f.fan1, 'GET', `/rooms/${f.room}/messages/${direct}`)).status, 200);
  await f.send(f.fan1, '해제 후 새 개인', f.owner);
});

test('owner ban revokes periods and grants; unban cannot restore old grants or autojoin', { timeout: 30000 }, async t => {
  const f = await fixture(t); const old = await f.send(f.owner, '강퇴 전 개인', f.fan1);
  const endpoint = `/rooms/${f.room}/bans/${f.fan1.actor}`;
  assert.equal((await f.call(f.fan2, 'POST', endpoint, {})).status, 403);
  assert.equal((await f.call(f.owner, 'POST', endpoint, {})).status, 200);
  assert.equal((await f.call(f.fan1, 'POST', `/rooms/${f.room}/join`, {})).status, 403);
  assert.equal((await f.call(f.fan1, 'GET', `/rooms/${f.room}/messages/${old}`)).status, 404);
  assert.deepEqual((await f.call(f.owner, 'GET', `/rooms/${f.room}/bans`)).body.bans, [{ actorId: f.fan1.actor }]);
  assert.equal((await f.call(f.fan2, 'GET', `/rooms/${f.room}/bans`)).status, 403);
  assert.equal((await f.call(f.owner, 'DELETE', endpoint)).body.rejoinRequired, true);
  assert.equal((await f.call(f.fan1, 'GET', `/rooms/${f.room}/messages/${old}`)).status, 404);
  assert.equal((await f.call(f.fan1, 'POST', `/rooms/${f.room}/join`, {})).status, 200);
  assert.equal((await f.call(f.fan1, 'GET', `/rooms/${f.room}/messages/${old}`)).status, 404);
  const grants = await f.db.transactions.read(tx => tx.prisma.stream_grants.findMany({ where: { member_id: f.fan1.actor }, select: { revoked_at: true, can_read: true, can_send: true } }));
  assert.ok(grants.length); assert.ok(grants.every(g => g.revoked_at && !g.can_read && !g.can_send));
});

test('operator review checks current manage_users, audits real resolutions and never exposes source identity', { timeout: 30000 }, async t => {
  const f = await fixture(t); const id = await f.send(f.owner, '운영 검토 합성');
  const result = await f.call(f.fan1, 'POST', path(f, id), reportBody());
  assert.equal((await f.call(f.outsider, 'GET', '/admin/reports')).status, 403);
  await f.db.transactions.write(tx => tx.prisma.admin_capabilities.create({ data: { user_id: f.outsider.id, manage_users: true } }));
  const queue = await f.call(f.outsider, 'GET', '/admin/reports');
  assert.equal(queue.status, 200); const row = queue.body.reports.find(r => r.reportId === result.body.reportId);
  assert.ok(row); assert.deepEqual(Object.keys(row).sort(), ['createdAt', 'detail', 'reason', 'reportId', 'status']);
  assert.doesNotMatch(JSON.stringify(row), new RegExp(`${f.fan1.id}|${f.fan1.actor}|${id}`));
  const endpoint = `/admin/reports/${result.body.reportId}/resolve`;
  assert.equal((await f.call(f.outsider, 'POST', endpoint, { status: 'resolved' })).body.status, 'resolved');
  assert.equal((await f.call(f.outsider, 'POST', endpoint, { status: 'dismissed' })).status, 409);
  await f.db.transactions.write(tx => tx.prisma.admin_capabilities.update({ where: { user_id: f.outsider.id }, data: { manage_users: false } }));
  assert.equal((await f.call(f.outsider, 'POST', endpoint, { status: 'resolved' })).status, 403);
  const stored = await f.db.transactions.read(tx => tx.prisma.moderation_reports.findUnique({ where: { id: result.body.reportId }, select: { detail: true, status: true } }));
  assert.deepEqual(stored, { detail: null, status: 'resolved' });
});

test('report races deletion safely and never recreates a deleted message', { timeout: 30000 }, async t => {
  const f = await fixture(t); const id = await f.send(f.owner, '삭제 경합 합성'); const input = reportBody();
  const [report] = await Promise.all([f.call(f.fan1, 'POST', path(f, id), input), f.remove(f.owner, id)]);
  assert.ok([200, 404].includes(report.status), JSON.stringify(report));
  assert.equal((await f.call(f.fan1, 'GET', `/rooms/${f.room}/messages/${id}`)).status, 404);
  if (report.status === 200) assert.deepEqual((await f.call(f.fan1, 'GET', `/report-receipts/${input.idempotencyKey}`)).body, report.body);
});

test('concurrent block/unblock preserves content and final state matches all read surfaces', { timeout: 30000 }, async t => {
  const f = await fixture(t); const id = await f.send(f.owner, '가역 차단 합성');
  const endpoint = `/rooms/${f.room}/blocks/${f.owner.actor}`;
  const results = await Promise.all([f.call(f.fan1, 'PUT', endpoint, {}), f.call(f.fan1, 'DELETE', endpoint)]);
  assert.ok(results.every(r => r.status === 200), JSON.stringify(results));
  const list = await f.call(f.fan1, 'GET', `/rooms/${f.room}/blocks`); const blocked = list.body.blocks.length > 0;
  assert.equal((await f.call(f.fan1, 'GET', `/rooms/${f.room}/messages/${id}`)).status, blocked ? 404 : 200);
  await f.call(f.fan1, 'DELETE', endpoint);
  assert.equal((await f.call(f.fan1, 'GET', `/rooms/${f.room}/messages/${id}`)).status, 200);
  await f.call(f.fan1, 'PUT', endpoint, {});
  assert.equal((await f.call(f.fan1, 'POST', `/rooms/${f.room}/leave`, {})).status, 204);
  assert.equal((await f.call(f.fan1, 'GET', `/rooms/${f.room}/blocks`)).body.blocks.length, 1);
  assert.equal((await f.call(f.fan1, 'DELETE', endpoint)).status, 200);
  const content = await f.db.transactions.read(tx => tx.prisma.messages.findUnique({ where: { id }, select: { deleted_at: true, text_content: true } }));
  assert.equal(content.deleted_at, null); assert.ok(content.text_content);
});

test('blocked author cannot reappear through own quotes, profiles or reaction counts', { timeout: 30000 }, async t => {
  const f = await fixture(t); const shared = await f.send(f.owner, '인용 합성 원문');
  const quoted = await f.send(f.fan1, '내 인용 합성', f.owner, shared);
  await f.call(f.owner, 'PUT', `/rooms/${f.room}/messages/${quoted}/reactions/me`, { emoji: '😀' });
  const before = await f.call(f.fan1, 'GET', `/rooms/${f.room}/messages/${quoted}`); assert.equal(before.body.quote.id, shared);
  assert.deepEqual(before.body.reactions, { counts: [{ emoji: '😀', count: 1 }], mine: null });
  await f.call(f.fan1, 'PUT', `/rooms/${f.room}/blocks/${f.owner.actor}`, {});
  const after = await f.call(f.fan1, 'GET', `/rooms/${f.room}/messages/${quoted}`);
  assert.equal(after.status, 200); assert.equal(after.body.quote, null); assert.equal(after.body.counterpart, null);
  assert.equal(after.body.allowedActions.reply, false);
  assert.deepEqual(after.body.reactions, { counts: [], mine: null });
  const reactions = await f.call(f.fan1, 'GET', `/rooms/${f.room}/messages/${quoted}/reactions`);
  assert.deepEqual(reactions.body.counts, []);
  assert.equal((await f.call(f.fan1, 'PUT', `/rooms/${f.room}/messages/${quoted}/reactions/me`, { emoji: '😀' })).status, 404);
  assert.equal((await f.call(f.owner, 'PUT', `/rooms/${f.room}/messages/${quoted}/reactions/me`, { emoji: '😀' })).status, 404);
  const page = await f.roomSync(f.fan1, 'snapshot'); assert.equal(page.body.messages.find(m => m.id === quoted).quote, null);
  assert.deepEqual(page.body.messages.find(m => m.id === quoted).reactions, { counts: [], mine: null });
  assert.equal((await f.call(f.fan1, 'GET', `/rooms/${f.room}/actors/${f.owner.actor}/profile`)).status, 404);
  await f.call(f.fan1, 'DELETE', `/rooms/${f.room}/blocks/${f.owner.actor}`);
  assert.equal((await f.call(f.fan1, 'GET', `/rooms/${f.room}/messages/${quoted}`)).body.quote.id, shared);
  assert.equal((await f.call(f.fan1, 'GET', `/rooms/${f.room}/messages/${quoted}/reactions`)).body.counts[0].count, 1);
});


test('anonymous publication permits report but never exposes or targets its hidden fan', { timeout: 30000 }, async t => {
  const f = await fixture(t); const root = await f.send(f.fan1, '익명 원본 합성', f.owner);
  const publication = await f.db.transactions.write(async tx => {
    const stream = await tx.prisma.message_streams.findFirstOrThrow({ where: { room_id: f.room, kind: 'ROOM_SHARED' }, select: { id: true } });
    const id = randomUUID(); await tx.prisma.messages.create({ data: { id, room_id: f.room, stream_id: stream.id,
      sender_member_id: f.owner.actor, content_owner_user_id: f.fan1.id, deletion_root_id: root,
      text_content: '익명 원본 합성', created_order: await nextOrder(tx, f.room) } });
    await tx.prisma.message_publications.create({ data: { id: randomUUID(), room_id: f.room,
      source_message_id: root, source_version: 1n, publisher_member_id: f.owner.actor,
      published_message_id: id, state: 'PUBLISHED' } });
    return id;
  });
  const shown = await f.call(f.fan2, 'GET', `/rooms/${f.room}/messages/${publication}`);
  assert.equal(shown.status, 200); assert.deepEqual(shown.body.author, { kind: 'anonymous' });
  assert.ok(!JSON.stringify(shown.body).includes(f.fan1.actor)); assert.ok(!JSON.stringify(shown.body).includes(root));
  const receipt = await f.call(f.fan2, 'POST', path(f, publication), reportBody()); assert.equal(receipt.status, 200);
  assert.deepEqual(Object.keys(receipt.body).sort(), ['createdAt', 'reportId', 'status']);
  assert.equal((await f.call(f.fan2, 'PUT', `/rooms/${f.room}/blocks/${f.fan1.actor}`, {})).status, 404);
  await f.call(f.fan2, 'PUT', `/rooms/${f.room}/blocks/${f.owner.actor}`, {});
  assert.equal((await f.call(f.fan2, 'GET', `/rooms/${f.room}/messages/${publication}`)).status, 404);
  await f.call(f.fan2, 'DELETE', `/rooms/${f.room}/blocks/${f.owner.actor}`);
  assert.equal((await f.call(f.fan2, 'GET', `/rooms/${f.room}/messages/${publication}`)).status, 200);
});


test('owned block recovery labels remain current after leave without granting profiles or disclosing hidden/deleting targets', { timeout: 30000 }, async t => {
  const f = await fixture(t); const endpoint = `/rooms/${f.room}/blocks`;
  await f.call(f.fan1, 'PUT', `${endpoint}/${f.owner.actor}`, {});
  const list = () => f.call(f.fan1, 'GET', endpoint);
  const initial = await list(); assert.equal(initial.body.blocks[0].displayName, '동기화 방장');
  assert.deepEqual(Object.keys(initial.body.blocks[0]).sort(), ['actorId', 'blockedAt', 'displayName']);
  assert.deepEqual((await f.call(f.outsider, 'GET', endpoint)).body.blocks, []);
  assert.deepEqual((await f.call(f.fan2, 'GET', endpoint)).body.blocks, []);
  assert.equal((await f.call(f.fan1, 'POST', `/rooms/${f.room}/leave`, {})).status, 204);
  await f.db.transactions.write(tx => tx.prisma.user_profiles.update({ where: { user_id: f.owner.id }, data: { nickname: '새 현재 닉네임' } }));
  assert.equal((await list()).body.blocks[0].displayName, '새 현재 닉네임');
  assert.equal((await f.call(f.fan1, 'GET', `/rooms/${f.room}/actors/${f.owner.actor}/profile`)).status, 404);
  // A historical block cannot become an oracle if the target is now a hidden fan.
  await f.db.transactions.write(tx => tx.prisma.room_members.update({ where: { id: f.owner.actor }, data: { role: 'FAN' } }));
  assert.equal((await list()).body.blocks[0].displayName, null);
  await f.db.transactions.write(async tx => {
    await tx.prisma.room_members.update({ where: { id: f.owner.actor }, data: { role: 'STREAMER' } });
    await tx.prisma.users.update({ where: { id: f.owner.id }, data: { status: 'DELETING' } });
  });
  assert.equal((await list()).body.blocks[0].displayName, null);
  assert.equal((await f.call(f.fan1, 'DELETE', `${endpoint}/${f.owner.actor}`)).status, 200);
});


test('fresh-session account recovery discovers only owned blocked rooms after leave with current visibility and ban suppression', { timeout: 30000 }, async t => {
  const f = await fixture(t); const endpoint = `/rooms/${f.room}/blocks/${f.owner.actor}`;
  assert.deepEqual((await f.call(f.fan1, 'GET', '/blocked-rooms')).body, { rooms: [], nextCursor: null });
  await f.call(f.fan1, 'PUT', endpoint, {});
  await f.call(f.fan1, 'POST', `/rooms/${f.room}/leave`, {});
  // A fresh login/device has no saved room references. The account endpoint must rediscover them.
  const fresh = { id: f.fan1.id, ...await f.db.transactions.write(tx => f.sessions.issue(tx, f.fan1.id)) };
  const list = () => f.call(fresh, 'GET', '/blocked-rooms');
  const result = await list(); assert.equal(result.status, 200); assert.equal(result.body.rooms[0].roomId, f.room);
  assert.deepEqual(Object.keys(result.body.rooms[0]).sort(), ['displayName', 'roomId']);
  assert.deepEqual((await f.call(f.outsider, 'GET', '/blocked-rooms')).body.rooms, []);
  assert.deepEqual((await f.call(f.fan2, 'GET', '/blocked-rooms')).body.rooms, []);
  assert.equal((await f.call(fresh, 'GET', `/blocked-rooms?userId=${f.owner.id}`)).status, 400);
  assert.equal((await f.call(fresh, 'GET', '/blocked-rooms?cursor=forged')).status, 400);
  await f.db.transactions.write(tx => tx.prisma.rooms.update({ where: { id: f.room }, data: { name: '현재 방 이름' } }));
  assert.equal((await list()).body.rooms[0].displayName, '현재 방 이름');
  await f.db.transactions.write(tx => tx.prisma.rooms.update({ where: { id: f.room }, data: { join_policy: 'INVITE_ONLY' } }));
  assert.equal((await list()).body.rooms[0].displayName, null, 'LEFT has no current private room label authority');
  assert.equal((await f.call(fresh, 'GET', `/rooms/${f.room}/snapshot?${new globalThis.URLSearchParams(f.device)}`)).status, 404);
  await f.db.transactions.write(tx => tx.prisma.rooms.update({ where: { id: f.room }, data: { join_policy: 'OPEN_AUTHENTICATED' } }));
  assert.equal((await f.call(f.owner, 'POST', `/rooms/${f.room}/bans/${f.fan1.actor}`, {})).status, 200);
  assert.equal((await list()).body.rooms[0].displayName, null);
  assert.equal((await f.call(fresh, 'DELETE', endpoint)).status, 200);
  assert.deepEqual((await list()).body.rooms, []);
});


test('bounded account recovery continues past nonblocked memberships without leaking or reusing another session cursor', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  await f.call(f.fan1, 'PUT', `/rooms/${f.room}/blocks/${f.owner.actor}`, {});
  const unrelated = Array.from({ length: 50 }, () => ({ room: randomUUID(), actor: randomUUID() }));
  await f.db.transactions.write(async tx => {
    await tx.prisma.rooms.createMany({ data: unrelated.map(row => ({ id: row.room, name: 'private recovery fixture', mode: 'FAN', join_policy: 'INVITE_ONLY' })) });
    await tx.prisma.room_members.createMany({ data: unrelated.map(row => ({ id: row.actor, room_id: row.room, user_id: f.fan1.id, role: 'FAN', status: 'LEFT' })) });
  });
  const first = await f.call(f.fan1, 'GET', '/blocked-rooms');
  assert.equal(first.status, 200); assert.equal(typeof first.body.nextCursor, 'string');
  const next = `/blocked-rooms?${new globalThis.URLSearchParams({ cursor: first.body.nextCursor })}`;
  assert.equal((await f.call(f.outsider, 'GET', next)).body.error.code, 'INVALID_CURSOR');
  const fresh = { id: f.fan1.id, ...await f.db.transactions.write(tx => f.sessions.issue(tx, f.fan1.id)) };
  assert.equal((await f.call(fresh, 'GET', next)).body.error.code, 'INVALID_CURSOR');
  const second = await f.call(f.fan1, 'GET', next);
  assert.equal(second.status, 200); assert.equal(second.body.nextCursor, null);
  assert.deepEqual([...first.body.rooms, ...second.body.rooms].map(room => room.roomId), [f.room]);
  assert.ok(!JSON.stringify([first.body.rooms, second.body.rooms]).includes('private recovery fixture'));
});
