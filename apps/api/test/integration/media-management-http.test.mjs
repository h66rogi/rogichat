import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRoom, joinRoom } from '../support/domain-fixture.mjs';
import { PrismaDatabase } from '../../dist/infrastructure/database/database.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { createApi } from '../../dist/application.js';
import { LifecycleState } from '../../dist/common/lifecycle/lifecycle-state.js';
import { MediaSpooler } from '../../dist/common/media/media-spool.js';

async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new PrismaDatabase(readConfig('api'));
  const directory = await mkdtemp(join(tmpdir(), 'rogichat-media-management-'));
  let app;
  t.after(async () => { await app?.close(); await db.close(); await rm(directory, { recursive: true, force: true }); });
  const key = randomBytes(32);
  const config = { key, secure: false, audience: 'media-management-http', origin: 'http://localhost:3001', callback: 'http://127.0.0.1/callback', broker: undefined };
  const sessions = new SessionService(new SessionRepository(), config.audience, key);
  const account = capabilities => db.transactions.write(async tx => {
    const id = randomUUID();
    await tx.prisma.users.create({ data: { id, profile: { create: { nickname: '합성 미디어 관리자' } },
      soop: { create: { id: randomUUID(), provider_subject: Buffer.from(randomUUID()), verified_at: await tx.now() } },
      ...(capabilities ? { admin: { create: capabilities } } : {}) }, select: { id: true } });
    return { id, ...await sessions.issue(tx, id) };
  });
  const owner = await account(), fan = await account(), outside = await account();
  const operator = await account({ manage_stickers: true }), manager = await account({ manage_rooms: true });
  const roomId = await db.transactions.write(async tx => {
    const id = await createRoom(tx, '합성 미디어 정책방', 'FAN');
    const actor = await joinRoom(tx, id, owner.id); await joinRoom(tx, id, fan.id);
    await tx.prisma.room_members.update({ where: { id: actor }, data: { role: 'STREAMER' }, select: { id: true } });
    await tx.prisma.rooms.update({ where: { id }, data: { owner_member_id: actor }, select: { id: true } });
    return id;
  });
  // Persisted READY fixture only. Upload/decoder/R2 verification belongs to separate suites.
  const assetId = await db.transactions.write(async tx => {
    const id = randomUUID(), attempt = randomUUID();
    await tx.prisma.media_assets.create({ data: { id, owner_user_id: operator.id, kind: 'STICKER', content_type: 'image/png',
      state: 'READY', declared_bytes: 32n, reserved_bytes: 0n, expires_at: new Date((await tx.now()).getTime() + 3600000),
      objects: { create: { id: randomUUID(), attempt_id: attempt, variant: 'image', object_key: `test/${id}/${attempt}/image`, state: 'READY', byte_length: 32n, sha256: 'a'.repeat(64), width: 32, height: 32 } } }, select: { id: true } });
    return id;
  });
  app = await createApi(db, { event() {} }, new LifecycleState(), { sessions, config, flow: {} },
    { store: { async signedGet() { throw new Error('unexpected signing'); } }, prefix: 'test', spool: new MediaSpooler({ directory }) });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const request = async (person, method, path, body, extra = {}) => {
    const response = await fetch(base + path, { method, headers: { cookie: `rogi_session=${person.token}`, origin: config.origin,
      'x-csrf-token': person.csrf, 'content-type': 'application/json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  return { db, owner, fan, outside, operator, manager, roomId, assetId, request };
}

test('room media HTTP routes expose minimal policy and enforce owner/capability, membership, CSRF and strict fields', async t => {
  const f = await fixture(t), path = `/v1/rooms/${f.roomId}/media-policy`;
  const policy = await f.request(f.fan, 'GET', path);
  assert.equal(policy.status, 200);
  assert.deepEqual(Object.keys(policy.body).sort(), ['photoEnabled', 'photoMaxBytes', 'stickerEnabled', 'videoEnabled', 'videoMaxBytes']);
  assert.equal((await f.request(f.outside, 'GET', path)).status, 404);
  assert.equal((await f.request(f.fan, 'PATCH', path, { photoEnabled: false })).status, 403);
  assert.equal((await f.request(f.owner, 'PATCH', path, { photoEnabled: false }, { 'x-csrf-token': randomBytes(32).toString('base64url') })).status, 403);
  assert.equal((await f.request(f.owner, 'PATCH', path, { photoEnabled: false, ownerId: f.owner.id })).status, 400);
  assert.equal((await f.request(f.owner, 'GET', path + '?includeOwner=true')).status, 400);
  assert.equal((await f.request(f.owner, 'PATCH', path, { photoEnabled: false })).body.photoEnabled, false);
  assert.equal((await f.request(f.manager, 'PATCH', path, { photoEnabled: true })).body.photoEnabled, true);
});

test('sticker HTTP registry keeps drafts private and applies capability, approval and per-room catalog policy', async t => {
  const f = await fixture(t), list = `/v1/rooms/${f.roomId}/stickers`;
  assert.equal((await f.request(f.manager, 'POST', '/v1/admin/stickers', { assetId: f.assetId, label: '합성' })).status, 403);
  const created = await f.request(f.operator, 'POST', '/v1/admin/stickers', { assetId: f.assetId, label: '합성' });
  assert.equal(created.status, 201);
  assert.deepEqual(Object.keys(created.body).sort(), ['assetId', 'id', 'label', 'status']);
  assert.equal(created.body.status, 'DRAFT');
  assert.deepEqual((await f.request(f.fan, 'GET', list)).body, { items: [], nextCursor: null });
  const statusPath = `/v1/admin/stickers/${created.body.id}`;
  assert.equal((await f.request(f.fan, 'PATCH', statusPath, { status: 'ACTIVE' })).status, 403);
  assert.equal((await f.request(f.operator, 'PATCH', statusPath, { status: 'ACTIVE', approvedBy: f.operator.id })).status, 400);
  assert.equal((await f.request(f.operator, 'PATCH', statusPath, { status: 'ACTIVE' })).status, 200);
  assert.deepEqual((await f.request(f.fan, 'GET', list)).body, { items: [{ id: created.body.id, label: '합성', assetId: f.assetId }], nextCursor: null });
  assert.equal((await f.request(f.outside, 'GET', list)).status, 404);
  await f.request(f.owner, 'PATCH', `/v1/rooms/${f.roomId}/media-policy`, { stickerEnabled: false });
  assert.equal((await f.request(f.fan, 'GET', list)).status, 403);
});

test('sticker admin admission commits rejected-operation budget and revoked sessions cannot mutate', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 20; i++) {
    assert.equal((await f.request(f.fan, 'POST', '/v1/admin/stickers', { assetId: f.assetId, label: '금지' })).status, 403);
  }
  assert.equal((await f.request(f.fan, 'POST', '/v1/admin/stickers', { assetId: f.assetId, label: '금지' })).status, 429);
  await f.db.transactions.write(async tx => {
    await tx.prisma.auth_sessions.updateMany({ where: { user_id: f.operator.id }, data: { revoked_at: await tx.now() } });
  });
  assert.equal((await f.request(f.operator, 'POST', '/v1/admin/stickers', { assetId: f.assetId, label: '취소' })).status, 401);
  assert.equal(await f.db.transactions.read(tx => tx.prisma.sticker_catalog.count({ where: { asset_id: f.assetId } })), 0);
});
