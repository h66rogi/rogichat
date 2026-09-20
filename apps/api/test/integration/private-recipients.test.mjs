import { createUser, createRoom, joinRoom, leaveRoom, sendMessage } from '../support/domain-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { createApi } from '../../dist/application.js';
import { SafeLogger } from '../../dist/infrastructure/observability/logging.js';

async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api')); let app;
  t.after(async () => { try { await app?.close(); } finally { await db.close(); } });
  const config = { audience: `recipient-${randomBytes(8).toString('hex')}`, origin: 'http://localhost:3001', secure: false, key: randomBytes(32) };
  const sessions = new SessionService(new SessionRepository(), config.audience, config.key);
  const user = nickname => db.transactions.write(async tx => {
    const id = await createUser(tx, nickname);
    await tx.prisma.platform_soop.create({ data: { id: randomUUID(), user_id: id, provider_subject: Buffer.from(`synthetic-${randomUUID()}`), verified_at: await tx.now() } });
    return { id, ...await sessions.issue(tx, id) };
  });
  const owner = await user('합성 수신자 방장'), fan = await user('합성 수신자 팬'), outsider = await user('합성 타 방장');
  const room = await db.transactions.write(async tx => {
    const id = await createRoom(tx, '합성 수신자 시험방', 'FAN');
    for (const person of [owner, fan]) person.actor = await joinRoom(tx, id, person.id);
    await tx.prisma.room_members.update({ where: { id: owner.actor }, data: { role: 'STREAMER' } });
    await tx.prisma.rooms.update({ where: { id }, data: { owner_member_id: owner.actor } });
    return id;
  });
  app = await createApi(db, new SafeLogger('api', () => {}), undefined, { config, sessions });
  await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
  const call = async (person, method, path, body) => {
    const response = await fetch(`${base}/v1${path}`, { method, headers: { Origin: config.origin,
      ...(person ? { Cookie: `rogi_session=${person.token}`, 'X-CSRF-Token': person.csrf } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: response.headers.get('content-type')?.includes('application/json') ? await response.json() : undefined, headers: response.headers };
  };
  const list = (person = owner, suffix = '', roomId = room) => call(person, 'GET', `/rooms/${roomId}/private-recipients${suffix}`);
  const sendAs = (person, target) => call(person, 'POST', `/rooms/${room}/messages`, { clientMessageId: randomUUID(), intent: 'PRIVATE', recipientActorId: target.actor, content: { type: 'TEXT', text: '합성 개인답장' } });
  const send = target => sendAs(owner, target);
  const sendDirect = target => db.transactions.write(async tx => {
    await sessions.require(tx, owner.token, owner.csrf, true);
    return sendMessage(tx, room, owner.id, { clientMessageId: randomUUID(), intent: 'PRIVATE', recipientActorId: target.actor,
      quoteId: null, content: { type: 'TEXT', text: '합성 개인답장 권한 검사' } }, config.key);
  });
  const addFan = async nickname => {
    const person = await user(nickname);
    person.actor = await db.transactions.write(tx => joinRoom(tx, room, person.id));
    return person;
  };
  const pair = (person, { missing = false, viewerRead = true, viewerSend = true, targetRead = true, targetSend = true,
    revoked = false, expired = false, future = false } = {}) => db.transactions.write(async tx => {
    const stream = randomUUID(), members = [owner.actor, person.actor].sort(), now = await tx.now();
    await tx.prisma.message_streams.create({ data: { id: stream, room_id: room, kind: 'RESTRICTED' } });
    await tx.prisma.stream_pairs.create({ data: { id: randomUUID(), room_id: room, stream_id: stream, left_member_id: members[0], right_member_id: members[1] } });
    await tx.prisma.stream_grants.create({ data: { id: randomUUID(), room_id: room, stream_id: stream, member_id: owner.actor, can_read: viewerRead, can_send: viewerSend } });
    if (!missing) await tx.prisma.stream_grants.create({ data: { id: randomUUID(), room_id: room, stream_id: stream, member_id: person.actor,
      can_read: targetRead, can_send: targetSend, revoked_at: revoked ? now : null, expires_at: expired ? new Date(now.getTime() - 1000) : null,
      valid_from: future ? new Date(now.getTime() + 60000) : now } });
    return stream;
  });
  return { db, owner, fan, outsider, room, list, call, send, sendAs, sendDirect, addFan, pair };
}

test('recipient HTTP endpoint restricts opposite-role actors to the exact FAN room with minimal current profile fields', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  await f.db.transactions.write(tx => tx.prisma.user_profiles.update({ where: { user_id: f.fan.id }, data: { birthday_month: 2, birthday_day: 29, birthday_visible_to_streamers: true } }));
  const result = await f.list();
  assert.equal(result.status, 200); assert.deepEqual(result.body, { recipients: [{ actorId: f.fan.actor, nickname: '합성 수신자 팬', avatar: null }], next: null });
  assert.ok(result.headers.get('cache-control')?.includes('no-store'));
  for (const id of [f.owner.id, f.fan.id, f.outsider.id]) assert.ok(!JSON.stringify(result.body).includes(id));
  assert.deepEqual((await f.list(f.fan)).body, { recipients: [{ actorId: f.owner.actor, nickname: '합성 수신자 방장', avatar: null }], next: null });
  assert.equal((await f.list(f.outsider)).status, 404); assert.equal((await f.list(null)).status, 401);
  for (const suffix of ['?limit=1', '?after=not-a-uuid', `?after=${f.fan.actor}&after=${f.fan.actor}`, '?after[x]=1']) assert.equal((await f.list(f.owner, suffix)).status, 400);
  assert.equal((await f.list(f.owner, '', randomUUID())).status, 404);
  await f.db.transactions.write(tx => tx.prisma.admin_capabilities.create({ data: { user_id: f.outsider.id, manage_rooms: true } }));
  assert.equal((await f.list(f.outsider)).status, 404);
  await f.db.transactions.write(tx => tx.prisma.rooms.update({ where: { id: f.room }, data: { mode: 'GROUP' } }));
  assert.equal((await f.list()).status, 403);
});

test('fan first-message lookup permits any eligible current-room streamer, never peers; later sends reauthorize grants', { timeout: 30000 }, async t => {
  const f = await fixture(t), peer = await f.addFan('합성 비공개 다른 팬'), second = await f.addFan('합성 두 번째 스트리머');
  await f.db.transactions.write(async tx => {
    await tx.prisma.room_members.update({ where: { id: second.actor }, data: { role: 'STREAMER' } });
    const otherRoom = await createRoom(tx, '합성 다른 방', 'FAN');
    const actor = await joinRoom(tx, otherRoom, f.outsider.id);
    await tx.prisma.room_members.update({ where: { id: actor }, data: { role: 'STREAMER' } });
  });
  const first = await f.list(f.fan); assert.equal(first.status, 200);
  assert.deepEqual(first.body.recipients.map(row => row.actorId).sort(), [f.owner.actor, second.actor].sort());
  for (const hidden of [peer.actor, peer.id, f.outsider.id]) assert.ok(!JSON.stringify(first.body).includes(hidden));
  assert.equal((await f.sendAs(f.fan, f.owner)).status, 200);
  await f.db.transactions.write(tx => tx.prisma.stream_grants.updateMany({ where: { room_id: f.room, member_id: f.fan.actor }, data: { can_send: false } }));
  assert.deepEqual((await f.list(f.fan)).body.recipients.map(row => row.actorId), [second.actor]);
  assert.equal((await f.sendAs(f.fan, f.owner)).status, 403);
  assert.ok((await f.list()).body.recipients.some(row => row.actorId === f.fan.actor));
  await f.db.transactions.write(tx => tx.prisma.stream_grants.updateMany({ where: { room_id: f.room, member_id: f.fan.actor }, data: { can_send: true } }));
  assert.equal((await f.list(f.fan)).body.recipients.length, 2);
  // A list is not a capability token: revocation between list and send wins.
  await f.db.transactions.write(async tx => tx.prisma.stream_grants.updateMany({ where: { room_id: f.room, member_id: f.owner.actor }, data: { revoked_at: await tx.now() } }));
  assert.equal((await f.sendAs(f.fan, f.owner)).status, 403);
  assert.deepEqual((await f.list(f.fan)).body.recipients.map(row => row.actorId), [second.actor]);
});

test('recipient list mirrors both grant reads and sender send, excludes revoked/expired/future/missing pairs without repair', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const permitted = await f.addFan('합성 수신만 허용'); await f.pair(permitted, { targetSend: false });
  const blocked = [];
  for (const options of [{ missing: true }, { viewerRead: false }, { viewerSend: false }, { targetRead: false }, { revoked: true }, { expired: true }, { future: true }]) {
    const person = await f.addFan('합성 차단 수신자'); person.stream = await f.pair(person, options); blocked.push(person);
  }
  const result = await f.list(); assert.equal(result.status, 200);
  assert.deepEqual(result.body.recipients.map(row => row.actorId).sort(), [f.fan.actor, permitted.actor].sort());
  assert.equal((await f.send(permitted)).status, 200);
  // Domain checks avoid conflating many expected ACL denials with the separately
  // tested HTTP burst limiter. HTTP admission and subsequent revocation remain tested.
  for (const person of blocked) await assert.rejects(f.sendDirect(person), { code: 'FORBIDDEN' });
  const revoked = blocked[4];
  await f.db.transactions.write(tx => leaveRoom(tx, f.room, revoked.id));
  assert.equal(await f.db.transactions.write(tx => joinRoom(tx, f.room, revoked.id)), revoked.actor);
  assert.ok(!(await f.list()).body.recipients.some(row => row.actorId === revoked.actor));
  assert.equal((await f.send(revoked)).status, 403);
  const grants = await f.db.transactions.read(tx => tx.prisma.stream_grants.findMany({ where: { stream_id: revoked.stream }, select: { revoked_at: true } }));
  assert.ok(grants.some(grant => grant.revoked_at !== null));
});

test('recipient eligibility and avatar track fresh account, SOOP, membership and current-profile state', { timeout: 30000 }, async t => {
  const f = await fixture(t), other = await f.addFan('합성 이미지 소유자');
  const avatar = randomUUID(), foreign = randomUUID();
  await f.db.transactions.write(async tx => {
    for (const [id, owner] of [[avatar, f.fan.id], [foreign, other.id]]) await tx.prisma.media_assets.create({ data: {
      id, owner_user_id: owner, kind: 'AVATAR', content_type: 'image/png', state: 'READY', declared_bytes: 32n, reserved_bytes: 0n,
      expires_at: new Date((await tx.now()).getTime() + 60000),
    } });
    await tx.prisma.user_profiles.update({ where: { user_id: f.fan.id }, data: { avatar_asset_id: avatar } });
  });
  const item = async () => (await f.list()).body.recipients.find(row => row.actorId === f.fan.actor);
  assert.deepEqual((await item()).avatar, { assetId: avatar });
  await f.db.transactions.write(tx => tx.prisma.user_profiles.update({ where: { user_id: f.fan.id }, data: { avatar_asset_id: foreign } }));
  assert.equal((await item()).avatar, null);
  await f.db.transactions.write(async tx => {
    await tx.prisma.user_profiles.update({ where: { user_id: f.fan.id }, data: { avatar_asset_id: avatar } });
    await tx.prisma.media_assets.update({ where: { id: avatar }, data: { state: 'DELETING', deleted_at: await tx.now() } });
  });
  assert.equal((await item()).avatar, null);
  for (const status of ['SUSPENDED', 'DELETING', 'DELETED']) {
    await f.db.transactions.write(tx => tx.prisma.users.update({ where: { id: f.fan.id }, data: { status } })); assert.equal(await item(), undefined);
  }
  await f.db.transactions.write(async tx => {
    await tx.prisma.users.update({ where: { id: f.fan.id }, data: { status: 'ACTIVE' } });
    await tx.prisma.platform_soop.update({ where: { user_id: f.fan.id }, data: { status: 'REVOKED' } });
  });
  assert.equal(await item(), undefined);
  await f.db.transactions.write(tx => tx.prisma.platform_soop.update({ where: { user_id: f.fan.id }, data: { status: 'VERIFIED' } }));
  await f.db.transactions.write(tx => leaveRoom(tx, f.room, f.fan.id)); assert.equal(await item(), undefined);
  await f.db.transactions.write(tx => joinRoom(tx, f.room, f.fan.id)); assert.ok(await item());
  await f.db.transactions.write(tx => tx.prisma.room_members.update({ where: { id: f.fan.actor }, data: { status: 'BANNED' } })); assert.equal(await item(), undefined);
  await f.db.transactions.write(tx => tx.prisma.platform_soop.update({ where: { user_id: f.owner.id }, data: { status: 'REVOKED' } })); assert.equal((await f.list()).status, 403);
  await f.db.transactions.write(tx => tx.prisma.platform_soop.update({ where: { user_id: f.owner.id }, data: { status: 'VERIFIED' } }));
  await f.db.transactions.write(tx => tx.prisma.rooms.update({ where: { id: f.room }, data: { status: 'CLOSED' } })); assert.equal((await f.list()).status, 404);
});

test('real MySQL eligible pagination scans past an entire blocked batch and uses only returned actor cursors', { timeout: 60000 }, async t => {
  const f = await fixture(t); const fans = [f.fan];
  // Isolated synthetic fixtures only. Deterministic sorting is applied after
  // generating random UUIDs, never a production seed or selectable fake role.
  for (let index = 0; index < 159; index++) fans.push(await f.addFan(`합성 페이지 팬 ${index}`));
  fans.sort((a, b) => a.actor.localeCompare(b.actor));
  for (const person of fans.slice(0, 105)) await f.pair(person, { revoked: true });
  const first = await f.list(); assert.equal(first.status, 200);
  assert.deepEqual(first.body.recipients.map(row => row.actorId), fans.slice(105, 155).map(person => person.actor));
  assert.equal(first.body.next, fans[154].actor);
  const second = await f.list(f.owner, `?after=${first.body.next}`); assert.equal(second.status, 200);
  assert.deepEqual(second.body.recipients.map(row => row.actorId), fans.slice(155).map(person => person.actor)); assert.equal(second.body.next, null);
  for (const person of fans.slice(0, 105)) assert.ok(!JSON.stringify(first.body).includes(person.actor));
});
