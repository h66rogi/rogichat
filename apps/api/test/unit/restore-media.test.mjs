import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { unlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { NestFactory } from '@nestjs/core';
import { Transactions } from '../../dist/infrastructure/database/transactions.js';
import { RestoreMediaModule } from '../../dist/modules/media/restore-media.module.js';
import { RestoreMediaService } from '../../dist/modules/media/restore-media.service.js';
import { RestoreMediaRepository } from '../../dist/modules/media/restore-media.repository.js';
import { RestoreMediaR2Store, RESTORE_MEDIA_REQUIRED_PERMISSIONS } from '../../dist/modules/media/restore-media.store.js';
import { RESTORE_MEDIA_MAXIMUMS } from '../../dist/modules/media/restore-media.types.js';
import { restoreMediaFixture, sha } from '../support/restore-media-fixture.mjs';
import { imageBytes } from '../support/restore-media-bytes.mjs';

const { AbortController } = globalThis;

for (const video of [false, true]) test(`real temporary ${video ? 'MP4/poster' : 'PNG'} bytes produce stable scoped evidence and bind only issued current snapshots`, async t => {
  const f = await restoreMediaFixture(t, { video });
  const first = await f.reconcile(), second = await f.reconcile();
  assert.equal(first.status, 'verified'); assert.equal(first.counts.retained, video ? 2 : 1);
  assert.equal(first.manifestSha256, second.manifestSha256); assert.match(first.storageScopeSha256, /^[a-f0-9]{64}$/);
  assert.equal(await f.bind(first), true); assert.equal(await f.bind({ ...first }), false);
  f.store.prefix = 'qa'; assert.equal(await f.bind(first), false); f.store.prefix = 'test';
  const serialized = JSON.stringify(first);
  for (const value of [f.assetId, f.ownerId, ...f.snapshot.objects.map(object => object.object_key)]) assert.equal(serialized.includes(value), false);
  assert.ok(f.streams.every(stream => stream.destroyed));
  f.snapshot.objects[0].sha256 = 'a'.repeat(64); assert.equal(await f.bind(first), false);
});

for (const mode of ['missing', 'changed', 'orphan', 'failed-read', 'failed-list', 'database-drift', 'inventory-drift']) test(`restore blocks ${mode} without private identifiers or fabricated manifest`, async t => {
  const f = await restoreMediaFixture(t), key = f.snapshot.objects[0].object_key;
  if (mode === 'missing') await unlink(join(f.directory, key));
  if (mode === 'changed') await f.put(key, Buffer.alloc(imageBytes.length, 2));
  if (mode === 'orphan') await f.put(`test/${randomUUID()}/${randomUUID()}/image`, imageBytes);
  if (mode === 'failed-read') f.hooks.read = () => { throw new Error(`private ${key}`); };
  if (mode === 'failed-list') f.hooks.list = () => { throw new Error(`private ${key}`); };
  if (mode === 'database-drift') f.hooks.read = () => { f.snapshot.assets[0].state = 'DELETING'; };
  if (mode === 'inventory-drift') f.hooks.list = async number => { if (number === 2) await f.put(key, Buffer.alloc(imageBytes.length, 3)); };
  const evidence = await f.reconcile();
  assert.equal(evidence.status, mode.startsWith('failed') ? 'unavailable' : 'blocked');
  assert.equal(evidence.manifestSha256, null); assert.equal(JSON.stringify(evidence).includes(key), false);
  if (mode === 'missing') assert.equal(evidence.counts.missing, 1);
  if (mode === 'changed') assert.equal(evidence.counts.changed, 1);
  if (mode === 'orphan') assert.equal(evidence.counts.orphan, 1);
  if (mode === 'database-drift') assert.ok(evidence.reasons.includes('DATABASE_DRIFT'));
  if (mode === 'inventory-drift') assert.ok(evidence.reasons.includes('INVENTORY_DRIFT'));
});

test('unknown ALLOCATED and FK-free writer obligations remain unresolved even with complete empty storage inventory', async t => {
  const f = await restoreMediaFixture(t), object = f.snapshot.objects[0];
  f.snapshot.assets[0].state = 'DELETING'; object.state = 'ALLOCATED'; object.byte_length = null; object.sha256 = null;
  f.snapshot.attempts.push({ object_id: object.id, asset_id: object.asset_id, attempt_id: object.attempt_id, object_key: object.object_key, writer_acknowledged: false, delete_observed_at: null });
  await unlink(join(f.directory, object.object_key));
  let evidence = await f.reconcile(); assert.equal(evidence.status, 'blocked'); assert.ok(evidence.counts.deletionObligations > 0);
  f.snapshot.objects = []; f.snapshot.assets = [];
  evidence = await f.reconcile(); assert.equal(evidence.status, 'blocked'); assert.equal(evidence.counts.deletionObligations, 1);
});

test('durably closed keys require observed absence; resurrected bytes are deletion obligations, never retained success', async t => {
  const f = await restoreMediaFixture(t), object = f.snapshot.objects[0];
  f.snapshot.assets[0].state = 'DELETED'; f.snapshot.assets[0].reserved_bytes = 0n; object.state = 'DELETED';
  f.snapshot.attempts.push({ object_id: object.id, asset_id: object.asset_id, attempt_id: object.attempt_id, object_key: object.object_key, writer_acknowledged: true, delete_observed_at: new Date('2026-01-01T00:00:00Z') });
  assert.equal((await f.reconcile()).status, 'blocked');
  await unlink(join(f.directory, object.object_key)); assert.equal((await f.reconcile()).status, 'verified');
  f.snapshot.attempts[0].writer_acknowledged = false; assert.equal((await f.reconcile()).status, 'blocked');
});

test('revoked ACCOUNT provenance blocks restored READY while approved service and independent sharing remain retained', async t => {
  const f = await restoreMediaFixture(t);
  f.snapshot.assets[0].owner.status = 'DELETING'; assert.equal((await f.reconcile()).status, 'blocked');
  f.snapshot.assets[0].catalog_entry = { id: randomUUID(), status: 'ACTIVE', approved_at: new Date('2026-01-01T00:00:00Z') };
  assert.equal((await f.reconcile()).status, 'verified');
  f.snapshot.assets[0].catalog_entry = null; f.snapshot.assets[0].attachments.push({ id: randomUUID() });
  assert.equal((await f.reconcile()).status, 'verified');
  f.snapshot.provenance.push({ request_id: randomUUID(), reference_kind: 'ACCOUNT', reference_id: f.ownerId, asset_id: f.assetId, disposition: 'REVOKED' });
  assert.equal((await f.reconcile()).status, 'blocked');
});

test('retained media permits absent terminal historical attempts only with exact durable ordered proof', async t => {
  const f = await restoreMediaFixture(t), original = f.snapshot.objects[0], attempt = randomUUID();
  const old = { ...original, id: randomUUID(), attempt_id: attempt, object_key: `test/${f.assetId}/${attempt}/image`, state: 'DELETED' };
  f.snapshot.objects.push(old);
  f.snapshot.attempts.push({ object_id: old.id, asset_id: old.asset_id, attempt_id: attempt, object_key: old.object_key, writer_acknowledged: true, delete_observed_at: new Date('2026-01-01T00:00:00Z') });
  assert.equal((await f.reconcile()).status, 'verified');
  await f.put(old.object_key, imageBytes); assert.equal((await f.reconcile()).status, 'blocked');
  await unlink(join(f.directory, old.object_key)); f.snapshot.attempts[0].delete_observed_at = null;
  assert.equal((await f.reconcile()).status, 'blocked');
});

test('restored READY does not override revoked catalog/publication provenance', async t => {
  const f = await restoreMediaFixture(t), asset = f.snapshot.assets[0];
  asset.catalog_entry = { id: randomUUID(), status: 'REVOKED', approved_at: new Date('2026-01-01T00:00:00Z') };
  assert.equal((await f.reconcile()).status, 'blocked');
  asset.catalog_entry = null;
  asset.publication_copy = { id: randomUUID(), publication: { state: 'REVOKED', source: { deleted_at: null, content_owner: { status: 'ACTIVE' } } } };
  assert.equal((await f.reconcile()).status, 'blocked');
});

test('READY metadata cannot override independent unknown/deleted writer evidence or alias another object identity', async t => {
  const f = await restoreMediaFixture(t), object = f.snapshot.objects[0];
  const proof = { object_id: object.id, asset_id: object.asset_id, attempt_id: object.attempt_id, object_key: object.object_key, writer_acknowledged: false, delete_observed_at: null };
  f.snapshot.attempts.push(proof); assert.equal((await f.reconcile()).status, 'blocked');
  proof.writer_acknowledged = true; assert.equal((await f.reconcile()).status, 'verified');
  proof.delete_observed_at = new Date('2026-01-01T00:00:00Z'); assert.equal((await f.reconcile()).status, 'blocked');
  proof.object_id = randomUUID(); assert.deepEqual((await f.reconcile()).reasons, ['INVALID_DATABASE']);
});

for (const mode of ['missing-video', 'missing-image', 'duplicate-image', 'split-video-attempt']) test(`canonical ready variants reject ${mode}`, async t => {
  const video = mode.includes('video'), f = await restoreMediaFixture(t, { video });
  if (mode.startsWith('missing')) {
    const variant = video ? 'video' : 'image', index = f.snapshot.objects.findIndex(object => object.variant === variant);
    await unlink(join(f.directory, f.snapshot.objects[index].object_key)); f.snapshot.objects.splice(index, 1);
    const evidence = await f.reconcile(); assert.equal(evidence.status, 'blocked'); assert.equal(evidence.counts.missing, 1);
  } else {
    const row = f.snapshot.objects[0], attempt = randomUUID();
    if (mode === 'duplicate-image') f.snapshot.objects.push({ ...row, id: randomUUID(), attempt_id: attempt, object_key: `test/${f.assetId}/${attempt}/image` });
    else { row.attempt_id = attempt; row.object_key = `test/${f.assetId}/${attempt}/${row.variant}`; }
    assert.deepEqual((await f.reconcile()).reasons, ['INVALID_DATABASE']);
  }
});

test('even an empty database requires two complete inventories; missing configuration and changed configured scope fail closed', async t => {
  const f = await restoreMediaFixture(t), key = f.snapshot.objects[0].object_key;
  await unlink(join(f.directory, key)); f.snapshot.objects = []; f.snapshot.assets = [];
  const evidence = await f.reconcile(); assert.equal(evidence.status, 'verified'); assert.equal(f.calls.list, 2);
  f.store.storageScopeSha256 = 'a'.repeat(64); assert.equal(await f.bind(evidence), false);
  await f.put(`test/${randomUUID()}/${randomUUID()}/image`, imageBytes); assert.equal((await f.reconcile()).status, 'blocked');
  const infrastructure = { module: class FixtureInfrastructure {}, providers: [{ provide: Transactions, useValue: f.transactions }], exports: [Transactions] };
  const context = await NestFactory.createApplicationContext(RestoreMediaModule.register(infrastructure, undefined), { logger: false, abortOnError: false });
  t.after(() => context.close());
  assert.deepEqual((await context.get(RestoreMediaService).reconcile(new AbortController().signal)).reasons, ['CONFIGURATION_UNAVAILABLE']);
});

test('operator module can inject an actual directory-backed store without adding a product route or endpoint configuration', async t => {
  const f = await restoreMediaFixture(t);
  const infrastructure = { module: class FixtureInfrastructure {}, providers: [{ provide: Transactions, useValue: f.transactions }], exports: [Transactions] };
  const context = await NestFactory.createApplicationContext(RestoreMediaModule.register(infrastructure, { store: f.store }), { logger: false, abortOnError: false });
  t.after(() => context.close());
  const evidence = await context.get(RestoreMediaService).reconcile(new AbortController().signal);
  assert.equal(evidence.status, 'verified'); assert.equal(evidence.counts.retained, 1);
});

for (const mode of ['objects', 'rows', 'pages', 'totalBytes']) test(`bounded reconciliation rejects ${mode} exhaustion`, async t => {
  const limits = { [mode]: 1 };
  const f = await restoreMediaFixture(t, { video: true, limits });
  const result = await f.reconcile(); assert.equal(result.status, 'unavailable'); assert.deepEqual(result.reasons, ['LIMIT_EXCEEDED']);
});

test('stream byte cap destroys an oversized body and never binds a success', async t => {
  const f = await restoreMediaFixture(t); let stream;
  f.store.read = async () => ({ stream: stream = Readable.from([Buffer.alloc(imageBytes.length + 1)]), bytes: imageBytes.length, etag: sha(imageBytes) });
  const result = await f.reconcile(); assert.deepEqual(result.reasons, ['LIMIT_EXCEEDED']); assert.equal(stream.destroyed, true);
});

test('caller cancellation and deadline bound blocked streams and ignored adapter promises', async t => {
  const f = await restoreMediaFixture(t, { limits: { deadlineMs: 1000 } }); let stream;
  f.store.read = async () => ({ stream: stream = new Readable({ read() {} }), bytes: imageBytes.length, etag: sha(imageBytes) });
  const result = await f.reconcile(); assert.deepEqual(result.reasons, ['DEADLINE_EXCEEDED']); assert.equal(stream.destroyed, true);
  f.store.list = () => new Promise(() => {});
  assert.deepEqual((await f.reconcile()).reasons, ['DEADLINE_EXCEEDED']);
  const controller = new AbortController(); controller.abort();
  assert.deepEqual((await f.service.reconcile(controller.signal)).reasons, ['CANCELLED']);
});

test('invalid/cyclic inventory and unavailable database never become empty successful inventory', async t => {
  const f = await restoreMediaFixture(t);
  f.store.list = async () => ({ objects: [], next: 'same-token' });
  assert.deepEqual((await f.reconcile()).reasons, ['STORAGE_UNAVAILABLE']);
  f.hooks.db = () => { throw new Error('private DB details'); };
  assert.deepEqual((await f.reconcile()).reasons, ['DATABASE_UNAVAILABLE']);
  assert.throws(() => new RestoreMediaService(f.transactions, new RestoreMediaRepository(), f.store, { ...RESTORE_MEDIA_MAXIMUMS, objects: Infinity }), /limits/);
});

test('production adapter uses fixed scoped GET/list only and requires explicit object-read and bucket-list permissions', async t => {
  const config = { accountId: '0'.repeat(32), bucket: 'isolated-fixture', prefix: 'test', accessKeyId: 'x'.repeat(20), secretAccessKey: 'x'.repeat(32) };
  const store = new RestoreMediaR2Store(config); t.after(() => store.close());
  assert.throws(() => { store.prefix = 'qa'; }, TypeError);
  config.bucket = 'changed-external-config'; // Constructor retains its own immutable configured scope.
  const key = `test/${randomUUID()}/${randomUUID()}/image`, etag = 'fixture-etag', seen = [];
  store.client.config.requestHandler = { async handle(request) {
    seen.push(request); assert.equal(request.method, 'GET'); assert.equal(request.hostname, `${config.accountId}.r2.cloudflarestorage.com`);
    assert.ok(request.path.startsWith('/isolated-fixture/'));
    if (request.query['list-type']) {
      assert.equal(request.query.prefix, 'test/'); assert.equal(String(request.query['max-keys']), '1000');
      const xml = `<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>${key}</Key><Size>${imageBytes.length}</Size><ETag>${etag}</ETag><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents></ListBucketResult>`;
      return { response: { statusCode: 200, headers: { 'content-type': 'application/xml' }, body: Readable.from([xml]) } };
    }
    return { response: { statusCode: 200, headers: { 'content-length': String(imageBytes.length), etag }, body: Readable.from([imageBytes]) } };
  }, destroy() {} };
  const signal = new AbortController().signal;
  const list = await store.list(null, signal); assert.equal(list.objects[0].key, key); assert.equal(list.next, null);
  const read = await store.read(key, signal); const chunks = []; for await (const chunk of read.stream) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), imageBytes); assert.equal(read.etag, etag); assert.equal(seen.length, 2);
  assert.deepEqual(RESTORE_MEDIA_REQUIRED_PERMISSIONS, ['s3:ListBucket', 's3:GetObject']);
  await assert.rejects(store.read(key.replace('test/', 'qa/'), signal)); assert.equal(seen.length, 2);
  assert.equal((await readFile(new URL('../../src/modules/media/restore-media.store.ts', import.meta.url), 'utf8')).includes('PutObjectCommand'), false);
});
