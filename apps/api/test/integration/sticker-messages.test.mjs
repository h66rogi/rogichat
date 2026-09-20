import { createRoom, joinRoom, sendMessage, sendInput, stickers, processMedia, recoverMedia, enqueueJob } from '../support/domain-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { createApi } from '../../dist/application.js';

// READY pixels, storage and signer are synthetic. These tests prove real MySQL
// command/ACL/fencing behavior, not R2 or decoder isolation.
async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api')); let app;
  t.after(async () => { try { await app?.close(); } finally { await db.close(); } });
  const config = { audience: 'sticker-message-fixture', origin: 'http://localhost:3001', secure: false, key: randomBytes(32) };
  const sessions = new SessionService(new SessionRepository(), config.audience, config.key);
  const user = nickname => db.transactions.write(async tx => {
    const id = randomUUID();
    await tx.prisma.users.create({ data: { id, profile: { create: { nickname } },
      soop: { create: { id: randomUUID(), provider_subject: Buffer.from(randomUUID()), verified_at: await tx.now() } } }, select: { id: true } });
    return { id, actors: new Map(), ...await sessions.issue(tx, id) };
  });
  const registrar = await user('스티커 등록'), approver = await user('스티커 승인');
  const owner = await user('스티커 방장'), fan = await user('스티커 팬'), other = await user('다른 팬'), outsider = await user('외부인');
  await db.transactions.write(tx => tx.prisma.admin_capabilities.createMany({ data: [registrar, approver].map(person => ({ user_id: person.id, manage_stickers: true })) }));
  const rooms = [];
  for (let index = 0; index < 2; index++) rooms.push(await db.transactions.write(async tx => {
    const id = await createRoom(tx, '스티커 메시지 합성방', 'FAN');
    for (const person of [owner, fan, other]) person.actors.set(id, await joinRoom(tx, id, person.id));
    await tx.prisma.room_members.update({ where: { id: owner.actors.get(id) }, data: { role: 'STREAMER' }, select: { id: true } });
    await tx.prisma.rooms.update({ where: { id }, data: { owner_member_id: owner.actors.get(id) }, select: { id: true } });
    return id;
  }));
  const auth = (who, action) => db.transactions.write(async tx => {
    await sessions.require(tx, who.token, who.csrf, true); return action(tx);
  });
  const catalog = async (approve = true) => {
    const assetId = randomUUID(), attempt = randomUUID(), objectKey = `test/${assetId}/${attempt}/image`;
    await db.transactions.write(tx => tx.prisma.media_assets.create({ data: { id: assetId, owner_user_id: registrar.id,
      kind: 'STICKER', content_type: 'image/webp', state: 'READY', declared_bytes: 32n, reserved_bytes: 0n,
      expires_at: new Date(Date.now() + 3600000), objects: { create: { id: randomUUID(), attempt_id: attempt,
        variant: 'image', object_key: objectKey, state: 'READY', byte_length: 32n, sha256: 'a'.repeat(64), width: 32, height: 64 } } }, select: { id: true } }));
    const draft = await auth(registrar, tx => stickers.register(tx, registrar.id, { assetId, label: '합성 스티커' }));
    return { ...(approve ? await auth(approver, tx => stickers.changeState(tx, approver.id, draft.id, { status: 'ACTIVE' })) : draft), objectKey };
  };
  const signed = [], removed = [];
  const store = { async signedGet(key) { signed.push(key); return 'https://media.test.invalid/sticker'; }, async remove(key) { removed.push(key); } };
  app = await createApi(db, { event() {} }, undefined, { sessions, config }, { store, prefix: 'test', spool: {} });
  await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
  const call = async (who, method, path, body, headers = {}) => {
    const response = await fetch(`${base}/v1${path}`, { method, headers: { origin: config.origin,
      cookie: `rogi_session=${who.token}`, 'x-csrf-token': who.csrf,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? undefined : await response.json(), cache: response.headers.get('cache-control') };
  };
  const command = (who, item, room = rooms[0]) => ({ clientMessageId: randomUUID(),
    intent: who === owner ? 'SHARED' : 'PRIVATE', ...(who === owner ? {} : { recipientActorId: owner.actors.get(room) }),
    content: { type: 'STICKER', stickerId: item.id } });
  const send = async (who, item, room = rooms[0], body = command(who, item, room)) => {
    const response = await call(who, 'POST', `/rooms/${room}/messages`, body);
    assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body;
  };
  const directSend = (who, item, room = rooms[0]) => auth(who, tx => sendMessage(tx, room, who.id, sendInput(command(who, item, room)), config.key));
  const state = (item, status) => auth(approver, tx => stickers.changeState(tx, approver.id, item.id, { status }));
  const device = { deviceId: randomUUID(), cacheId: randomUUID() };
  const sync = (who, endpoint = 'snapshot', query = {}, room = rooms[0]) => call(who, 'GET', `/rooms/${room}/${endpoint}?${new globalThis.URLSearchParams({ ...device, ...query })}`);
  const get = (who, id, room = rooms[0]) => call(who, 'GET', `/rooms/${room}/messages/${id}`);
  const access = (who, item, messageId, room = rooms[0], extra = {}) => call(who, 'POST', `/media/assets/${item.assetId}/access`, {
    roomId: room, stickerId: item.id, variant: 'image', ...(messageId ? { messageId } : {}), ...extra,
  });
  const lease = (assetId, jobId) => db.transactions.write(async tx => {
    const job = await tx.prisma.jobs.findFirstOrThrow({ where: { purpose: 'MEDIA', resource_id: assetId, state: { in: ['PENDING', 'RUNNING'] }, ...(jobId ? { id: jobId } : {}) },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }], select: { id: true, generation: true, attempts: true, max_attempts: true, room_id: true } });
    const generation = job.generation + 1n, leaseOwner = randomUUID(), leaseToken = randomUUID();
    await tx.prisma.jobs.update({ where: { id: job.id }, data: { state: 'RUNNING', generation, lease_owner: leaseOwner, lease_token: leaseToken,
      lease_until: new Date((await tx.now()).getTime() + 300000), attempts: { increment: 1 } }, select: { id: true } });
    return { id: job.id, purpose: 'MEDIA', roomId: job.room_id, resourceId: assetId, generation, leaseOwner, leaseToken, attempts: job.attempts + 1, maxAttempts: job.max_attempts };
  });
  const processJob = job => processMedia(db.transactions, store, {}, 'test', job);
  return { db, rooms, registrar, approver, owner, fan, other, outsider, auth, catalog, command, send, directSend, state, call, sync, get, access, signed, removed, lease, process: processJob };
}

test('initial approval locks registrar before asset and rejects deletion that won that fence', { timeout: 20000 }, async t => {
  const f = await fixture(t), item = await f.catalog(false);
  let locked, approvalEntered;
  const ownerLocked = new Promise(resolve => { locked = resolve; });
  const approvalWaiting = new Promise(resolve => { approvalEntered = resolve; });
  const deletion = f.db.transactions.write(async tx => {
    await tx.rows('SELECT id FROM users WHERE id=? FOR UPDATE', [f.registrar.id]);
    locked(); await approvalWaiting;
    // An asset-first approval would deadlock this explicit user -> asset order.
    await tx.rows('SELECT id FROM media_assets WHERE id=? FOR UPDATE', [item.assetId]);
    await tx.prisma.users.update({ where: { id: f.registrar.id }, data: { status: 'DELETING' }, select: { id: true } });
  });
  await ownerLocked;
  let approvalAttempts = 0;
  const approval = f.auth(f.approver, async tx => {
    approvalAttempts++;
    const rows = tx.rows.bind(tx);
    tx.rows = (sql, values) => {
      if (sql === 'SELECT status FROM users WHERE id=? FOR UPDATE' && values[0] === f.registrar.id) approvalEntered();
      return rows(sql, values);
    };
    return stickers.changeState(tx, f.approver.id, item.id, { status: 'ACTIVE' });
  });
  await Promise.all([deletion, assert.rejects(approval, { code: 'NOT_FOUND' })]);
  assert.equal(approvalAttempts, 1); // A deadlock retry must not hide a lock-order regression.
  const catalog = await f.db.transactions.read(tx => tx.prisma.sticker_catalog.findUniqueOrThrow({ where: { id: item.id }, select: { status: true, approved_at: true } }));
  assert.deepEqual(catalog, { status: 'DRAFT', approved_at: null });
});

test('sticker HTTP sends share one catalog asset across rooms with minimal projections and fresh access ACL', { timeout: 20000 }, async t => {
  const f = await fixture(t), item = await f.catalog();
  const shared = await f.send(f.owner, item), privateMessage = await f.send(f.fan, item), secondRoom = await f.send(f.owner, item, f.rooms[1]);
  const expected = { type: 'STICKER', stickerId: item.id, assetId: item.assetId, width: 32, height: 64 };
  assert.deepEqual((await f.get(f.fan, shared.messageId)).body.content, expected);
  const snapshot = (await f.sync(f.fan)).body;
  assert.deepEqual(snapshot.messages.map(message => message.content), [expected, expected]);
  assert.deepEqual((await f.sync(f.other)).body.messages.map(message => message.id), [shared.messageId]);
  const first = (await f.sync(f.fan, 'snapshot', { limit: '1' })).body;
  assert.deepEqual((await f.sync(f.fan, 'history', { cursor: first.historyCursor })).body.messages.map(message => message.id), [shared.messageId]);
  assert.equal((await f.get(f.other, privateMessage.messageId)).status, 404);
  for (const [who, id, room] of [[f.fan, shared.messageId, f.rooms[0]], [f.fan, privateMessage.messageId, f.rooms[0]], [f.fan, undefined, f.rooms[0]], [f.fan, secondRoom.messageId, f.rooms[1]]]) {
    const response = await f.access(who, item, id, room); assert.equal(response.status, 200);
    assert.deepEqual(response.body, { url: 'https://media.test.invalid/sticker', expiresIn: 60 }); assert.match(response.cache, /no-store/);
  }
  const signed = f.signed.length;
  for (const response of [await f.access(f.other, item, privateMessage.messageId), await f.access(f.outsider, item),
    await f.access(f.fan, item, secondRoom.messageId), await f.access(f.fan, item, shared.messageId, f.rooms[0], { stickerId: randomUUID() }),
    await f.access(f.fan, item, shared.messageId, f.rooms[0], { actorId: f.owner.actors.get(f.rooms[0]) }),
    await f.call(f.registrar, 'POST', `/media/assets/${item.assetId}/access`, { variant: 'image' })]) assert.equal(response.status, 404);
  assert.equal((await f.access(f.fan, item, shared.messageId, f.rooms[0], { objectKey: item.objectKey })).status, 400);
  assert.equal((await f.call(f.fan, 'POST', `/media/assets/${item.assetId}/access`, { roomId: f.rooms[0], stickerId: item.id, variant: 'image' }, { 'x-csrf-token': randomBytes(32).toString('base64url') })).status, 403);
  assert.equal(f.signed.length, signed);
  const persisted = await f.db.transactions.read(async tx => ({
    links: await tx.prisma.message_stickers.count({ where: { sticker_id: item.id } }),
    attachments: await tx.prisma.message_attachments.count({ where: { asset_id: item.assetId } }),
  }));
  assert.deepEqual(persisted, { links: 3, attachments: 0 });
  assert.ok(!JSON.stringify(snapshot).includes(item.objectKey)); assert.ok(!JSON.stringify(snapshot).includes(f.registrar.id));
});

test('retired sticker retains existing messages and idempotent receipt even when room sending is disabled', { timeout: 20000 }, async t => {
  const f = await fixture(t), item = await f.catalog(), body = f.command(f.owner, item);
  const committed = await f.send(f.owner, item, f.rooms[0], body);
  await f.state(item, 'RETIRED');
  await f.db.transactions.write(tx => tx.prisma.room_media_policy.upsert({ where: { room_id: f.rooms[0] },
    create: { room_id: f.rooms[0], sticker_enabled: false }, update: { sticker_enabled: false }, select: { room_id: true } }));
  assert.deepEqual(await f.send(f.owner, item, f.rooms[0], body), committed);
  assert.equal((await f.call(f.owner, 'POST', `/rooms/${f.rooms[0]}/messages`, f.command(f.owner, item))).status, 404);
  assert.equal((await f.get(f.fan, committed.messageId)).status, 200);
  assert.equal((await f.access(f.fan, item, committed.messageId)).status, 200);
  assert.equal((await f.access(f.fan, item)).status, 404);
  assert.deepEqual((await f.sync(f.fan)).body.messages.map(message => message.id), [committed.messageId]);
  assert.equal(await f.db.transactions.read(tx => tx.prisma.message_stickers.count({ where: { sticker_id: item.id } })), 1);
});

test('deleting one sticker message does not revoke the shared asset or another room reference', { timeout: 20000 }, async t => {
  const f = await fixture(t), item = await f.catalog();
  const own = await f.send(f.fan, item), other = await f.send(f.other, item), elsewhere = await f.send(f.owner, item, f.rooms[1]);
  assert.equal((await f.call(f.fan, 'POST', `/rooms/${f.rooms[0]}/messages/${own.messageId}/delete`, {})).status, 200);
  assert.equal((await f.get(f.fan, own.messageId)).status, 404);
  assert.equal((await f.access(f.fan, item, own.messageId)).status, 404);
  assert.equal((await f.get(f.other, other.messageId)).status, 200);
  assert.equal((await f.access(f.fan, item, elsewhere.messageId, f.rooms[1])).status, 200);
  const asset = await f.db.transactions.read(tx => tx.prisma.media_assets.findUniqueOrThrow({ where: { id: item.assetId }, select: { state: true, deleted_at: true } }));
  assert.deepEqual(asset, { state: 'READY', deleted_at: null });
  assert.equal((await f.access(f.fan, item)).status, 200);
});

test('approved sticker remains usable after registrar deletion and expiry, including recovery scan', { timeout: 20000 }, async t => {
  const f = await fixture(t), item = await f.catalog();
  await f.db.transactions.write(async tx => {
    await tx.prisma.users.update({ where: { id: f.registrar.id }, data: { status: 'DELETED' }, select: { id: true } });
    await tx.prisma.media_assets.update({ where: { id: item.assetId }, data: { expires_at: new Date(0), created_at: new Date(0) }, select: { id: true } });
  });
  await f.db.transactions.write(recoverMedia);
  const sent = await f.send(f.fan, item);
  assert.equal((await f.get(f.fan, sent.messageId)).status, 200);
  assert.equal((await f.access(f.fan, item, sent.messageId)).status, 200);
  assert.equal((await f.access(f.fan, item)).status, 200);
  assert.equal((await f.sync(f.fan)).body.messages[0].content.stickerId, item.id);
  const listed = await f.auth(f.fan, tx => stickers.list(tx, f.rooms[0], f.fan.id));
  assert.ok(listed.items.some(sticker => sticker.id === item.id));
  await f.state(item, 'RETIRED'); await f.state(item, 'ACTIVE');
  assert.equal((await f.access(f.fan, item)).status, 200);
});

test('revocation immediately resets only viewers who could see the sticker before asynchronous fan-out', { timeout: 20000 }, async t => {
  const f = await fixture(t), item = await f.catalog(), sent = await f.send(f.fan, item);
  const beforeFan = (await f.sync(f.fan)).body, beforeOther = (await f.sync(f.other)).body;
  await f.state(item, 'REVOKED');
  assert.equal((await f.get(f.fan, sent.messageId)).status, 404);
  assert.equal((await f.access(f.fan, item, sent.messageId)).status, 404);
  assert.equal((await f.access(f.fan, item)).status, 404);
  const affected = (await f.sync(f.fan, 'events', { cursor: beforeFan.nextCursor })).body;
  assert.equal(affected.resetRequired, true); assert.deepEqual(affected.events, []);
  const hidden = (await f.sync(f.other, 'events', { cursor: beforeOther.nextCursor })).body;
  assert.equal(hidden.resetRequired, false); assert.deepEqual(hidden.events, []);
  const fresh = (await f.sync(f.fan)).body; assert.deepEqual(fresh.messages, []);
  assert.equal(await f.process(await f.lease(item.assetId)), 'completed');
  const afterWorker = (await f.sync(f.fan, 'events', { cursor: fresh.nextCursor })).body;
  assert.equal(afterWorker.resetRequired, false);
  assert.deepEqual(afterWorker.events, [{ type: 'message.deleted', messageId: sent.messageId, version: '2' }]);
  assert.deepEqual((await f.sync(f.other, 'events', { cursor: hidden.nextCursor })).body.events, []);
});

test('revocation batches are bounded, fenced, durable across closed rooms and already deleted storage', { timeout: 30000 }, async t => {
  const f = await fixture(t), item = await f.catalog();
  for (let index = 0; index < 52; index++) await f.directSend(f.owner, item);
  await f.directSend(f.owner, item, f.rooms[1]);
  await f.state(item, 'REVOKED');
  await f.db.transactions.write(async tx => {
    await tx.prisma.rooms.update({ where: { id: f.rooms[1] }, data: { status: 'CLOSED' }, select: { id: true } });
    await tx.prisma.media_assets.update({ where: { id: item.assetId }, data: { state: 'DELETED' }, select: { id: true } });
  });
  const counts = () => f.db.transactions.read(async tx => ({
    moderated: await tx.prisma.messages.count({ where: { sticker: { sticker_id: item.id }, moderated: true } }),
    events: await tx.prisma.room_events.count({ where: { message: { sticker: { sticker_id: item.id } }, kind: 'MESSAGE_DELETED' } }),
  }));
  const stale = await f.lease(item.assetId);
  await f.db.transactions.write(tx => tx.prisma.jobs.update({ where: { id: stale.id }, data: { lease_until: new Date(0) }, select: { id: true } }));
  assert.equal(await f.process(stale), 'lease_lost'); assert.deepEqual(await counts(), { moderated: 0, events: 0 });
  const fresh = await f.lease(item.assetId, stale.id);
  assert.equal(await f.process(fresh), 'completed');
  let previous = await counts(); assert.ok(previous.moderated > 0 && previous.moderated <= 50); assert.equal(previous.moderated, previous.events);
  assert.equal(await f.process(fresh), 'lease_lost'); assert.deepEqual(await counts(), previous);
  for (let index = 0; index < 5 && previous.moderated < 53; index++) {
    assert.equal(await f.process(await f.lease(item.assetId)), 'completed');
    const current = await counts(); assert.ok(current.moderated - previous.moderated <= 50); assert.equal(current.moderated, current.events); previous = current;
  }
  assert.deepEqual(previous, { moderated: 53, events: 53 });
  assert.equal(await f.process(await f.lease(item.assetId)), 'completed');
  assert.deepEqual(await counts(), previous); assert.deepEqual(f.removed, []);
});

test('two concurrent revocation workers commit only one message invalidation and keep a durable continuation', { timeout: 20000 }, async t => {
  const f = await fixture(t), item = await f.catalog(), sent = await f.directSend(f.fan, item);
  await f.state(item, 'REVOKED');
  const first = await f.lease(item.assetId);
  const duplicateId = await f.db.transactions.write(tx => enqueueJob(tx, { purpose: 'MEDIA', resourceId: item.assetId }));
  const second = await f.lease(item.assetId, duplicateId);
  assert.deepEqual(await Promise.all([f.process(first), f.process(second)]), ['completed', 'completed']);
  const persisted = await f.db.transactions.read(async tx => ({
    message: await tx.prisma.messages.findUniqueOrThrow({ where: { id: sent.messageId }, select: { version: true, moderated: true } }),
    events: await tx.prisma.room_events.count({ where: { message_id: sent.messageId, kind: 'MESSAGE_DELETED' } }),
    pending: await tx.prisma.jobs.count({ where: { purpose: 'MEDIA', resource_id: item.assetId, state: 'PENDING' } }),
  }));
  assert.deepEqual(persisted.message, { version: 2n, moderated: true }); assert.equal(persisted.events, 1); assert.ok(persisted.pending >= 1);
});

test('concurrent send and revoke never leave an accessible revoked message or unlinked committed command', { timeout: 20000 }, async t => {
  const f = await fixture(t), item = await f.catalog();
  const [send, revoke] = await Promise.allSettled([f.directSend(f.fan, item), f.state(item, 'REVOKED')]);
  assert.equal(revoke.status, 'fulfilled');
  if (send.status === 'fulfilled') {
    assert.equal((await f.get(f.fan, send.value.messageId)).status, 404);
    assert.equal(await f.db.transactions.read(tx => tx.prisma.message_stickers.count({ where: { message_id: send.value.messageId, sticker_id: item.id } })), 1);
  } else assert.equal(send.reason.code, 'NOT_FOUND');
  assert.deepEqual((await f.sync(f.fan)).body.messages, []); assert.equal((await f.access(f.fan, item)).status, 404);
});
