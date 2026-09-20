import { createUser, createRoom, joinRoom } from '../support/domain-fixture.mjs';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { createApi } from '../../dist/application.js';
import { LifecycleState } from '../../dist/common/lifecycle/lifecycle-state.js';
import { MediaSpooler } from '../../dist/common/media/media-spool.js';

async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api')); const directory = await mkdtemp(join(tmpdir(), 'media-http-'));
  const key = randomBytes(32), sessions = new SessionService(new SessionRepository(), 'media-http-fixture', key);
  const config = { key, secure: false, audience: 'media-http-fixture', origin: 'http://localhost:3001', callback: 'http://127.0.0.1/callback', broker: undefined };
  const person = await db.transactions.write(async tx => {
    const id = await createUser(tx, '업로드 합성 사용자');
    await tx.execute("INSERT INTO platform_soop (id,user_id,provider_subject,verified_at) VALUES (?,?,?,UTC_TIMESTAMP(3))", [randomUUID(), id, Buffer.from(randomUUID())]);
    const room = await createRoom(tx, '업로드 합성방', 'GROUP'); await joinRoom(tx, room, id);
    return { id, room, ...await sessions.issue(tx, id) };
  });
  const stored = new Map(); let beforePut = async () => {};
  const store = { async put(key, path, bytes, mime) { await beforePut(); const body = await readFile(path); assert.equal(body.length, bytes); assert.equal(mime, 'application/octet-stream'); stored.set(key, body); }, async signedGet() { throw new Error('unexpected signing'); } };
  const spool = new MediaSpooler({ directory, idleMs: 1000 });
  const app = await createApi(db, { event() {} }, new LifecycleState(), { sessions, config, flow: {} }, { store, prefix: 'test', spool });
  await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
  t.after(async () => { await app.close(); await db.close(); await rm(directory, { recursive: true, force: true }); });
  const headers = { origin: config.origin, cookie: `rogi_session=${person.token}`, 'x-csrf-token': person.csrf };
  const request = async (path, body, extra = {}) => {
    const response = await fetch(base + path, { method: 'POST', headers: { ...headers, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(24)]);
  const reserve = (body = {}) => request('/v1/media/upload-intents', { roomId: person.room, kind: 'PHOTO', contentType: 'image/png', byteLength: png.length, ...body });
  const upload = (assetId, bytes = png, extra = {}) => fetch(`${base}/v1/media/upload-intents/${assetId}/content`, { method: 'POST', headers: { ...headers, 'content-type': 'application/octet-stream', ...extra }, body: bytes });
  return { db, person, headers, base, stored, spool, request, reserve, upload, beforePut: fn => { beforePut = fn; } };
}

test('binary upload streams to private quarantine with no key/URL DTO and cannot be read before decoding', async t => {
  const f = await fixture(t); const reserved = await f.reserve(); assert.equal(reserved.status, 201);
  assert.deepEqual(Object.keys(reserved.body).sort(), ['assetId', 'status']);
  const response = await f.upload(reserved.body.assetId); assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { assetId: reserved.body.assetId, status: 'processing' });
  assert.equal(f.stored.size, 1); assert.equal(f.spool.stats().reservedBytes, 0);
  const denied = await f.request(`/v1/media/assets/${reserved.body.assetId}/access`, { variant: 'image' }); assert.equal(denied.status, 404);
  const duplicate = await f.upload(reserved.body.assetId); assert.equal(duplicate.status, 409);
  const [job] = await f.db.transactions.read(tx => tx.rows("SELECT state FROM jobs WHERE purpose='MEDIA' AND resource_id=?", [reserved.body.assetId])); assert.equal(job.state, 'PENDING');
});

test('upload HTTP enforces exact intent fields, CSRF, binary type and bounded signature before R2', async t => {
  const f = await fixture(t);
  assert.equal((await f.reserve({ objectKey: 'chosen-by-user' })).status, 400);
  assert.equal((await f.request('/v1/media/upload-intents', {}, { 'x-csrf-token': randomBytes(32).toString('base64url') })).status, 403);
  const reserved = await f.reserve();
  assert.equal((await f.upload(reserved.body.assetId, Buffer.alloc(32), { 'content-type': 'application/json' })).status, 400);
  assert.equal((await f.upload(reserved.body.assetId, Buffer.alloc(32))).status, 400);
  assert.equal(f.stored.size, 0); assert.equal(f.spool.stats().reservedBytes, 0);
  const [asset] = await f.db.transactions.read(tx => tx.rows('SELECT state,reserved_bytes FROM media_assets WHERE id=?', [reserved.body.assetId]));
  assert.equal(asset.state, 'DELETING'); assert.ok(Number(asset.reserved_bytes) > 0);
});

test('revocation during external PUT prevents processing ACK and retains cleanup reservation', async t => {
  const f = await fixture(t); const reserved = await f.reserve();
  f.beforePut(() => f.db.transactions.write(tx => tx.execute('UPDATE auth_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE user_id=?', [f.person.id])));
  const response = await f.upload(reserved.body.assetId); assert.equal(response.status, 401);
  assert.equal(f.stored.size, 1); assert.equal(f.spool.stats().reservedBytes, 0);
  const [asset] = await f.db.transactions.read(tx => tx.rows('SELECT state,reserved_bytes FROM media_assets WHERE id=?', [reserved.body.assetId]));
  assert.equal(asset.state, 'DELETING'); assert.ok(Number(asset.reserved_bytes) > 0);
});

test('URL access has a committed account budget even when every requested asset is missing', async t => {
  const f = await fixture(t);
  for (let index = 0; index < 120; index++) {
    const response = await f.request(`/v1/media/assets/${randomUUID()}/access`, { variant: 'image' });
    assert.equal(response.status, 404);
  }
  const denied = await f.request(`/v1/media/assets/${randomUUID()}/access`, { variant: 'image' });
  assert.equal(denied.status, 429);
  assert.equal(f.stored.size, 0);
  const unauthenticated = await f.request(`/v1/media/assets/${randomUUID()}/access`, { variant: 'image' }, { 'x-csrf-token': randomBytes(32).toString('base64url') });
  assert.equal(unauthenticated.status, 403);
});
