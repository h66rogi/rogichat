import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MediaClient } from './client';
import { imageContext, receipt, stickerPage, uploadInput } from './contracts';
import { MediaUpload } from './upload';
import { MediaImageResource } from './image-resource';

// Synthetic values are isolated tests, never imported by runtime entry points.
const asset = '11111111-1111-4111-8111-111111111111';
const room = '22222222-2222-4222-8222-222222222222';
const file = new Blob(['isolated-test-only'], { type: 'image/png' });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const status = (value: string, code = 200) => json({ assetId: asset, status: value }, code);
function setup(responses: Array<Response | (() => Promise<Response>)>) {
  const controller = new AbortController();
  let valid = true;
  const lifetime = { signal: controller.signal, isCurrent: () => valid };
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new MediaClient({ apiOrigin: 'https://api.qa.rogi.chat', storageOrigins: ['https://storage.example.test'],
    csrf: () => 'a'.repeat(43), lifetime, transport: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      const response = responses.shift();
      assert.ok(response, 'unexpected request (possible automatic replay)');
      return typeof response === 'function' ? response() : response;
    } });
  return { client, controller, calls, invalidate: () => { valid = false; } };
}
const idleSignal = () => new AbortController().signal;
const access = () => json({ url: 'https://storage.example.test/image?signature=isolated', expiresIn: 60 });
const image = () => new Response('isolated-test-only', { headers: { 'Content-Type': 'image/webp' } });

void test('strict receipt, context, catalog and input contracts reject unknown/non-UUID/non-image values', () => {
  assert.throws(() => receipt({ assetId: asset, status: 'READY' }));
  assert.throws(() => receipt({ assetId: asset, status: ['ready'] }));
  assert.throws(() => receipt({ assetId: room, status: 'ready' }, asset));
  assert.throws(() => receipt({ assetId: asset, status: 'ready', url: 'private' }));
  assert.throws(() => uploadInput('AVATAR', file, room));
  assert.throws(() => uploadInput('PHOTO', file));
  assert.throws(() => uploadInput('STICKER', new Blob(['x'], { type: 'image/jpeg' })));
  assert.throws(() => uploadInput('PHOTO', new Blob(['x'], { type: 'video/mp4' }), room));
  assert.throws(() => imageContext({ variant: 'image', roomId: room } as never));
  assert.throws(() => imageContext({ variant: 'image', actorId: asset, roomId: room, messageId: asset } as never));
  assert.throws(() => stickerPage({ items: [], nextCursor: undefined }));
  assert.throws(() => stickerPage({ items: [{ id: asset, assetId: asset, label: 'x', privateKey: 'x' }], nextCursor: null }));
});

void test('binary upload stays on authorized API; 202 is not READY and explicit status retry retains ID', async () => {
  const { client, calls } = setup([status('reserved', 201), status('processing', 202), status('processing'), status('ready')]);
  const upload = new MediaUpload(client, { intervalMs: 0, attempts: 1 });
  await upload.start('PHOTO', file, room);
  assert.equal(upload.getSnapshot().phase, 'pending');
  assert.throws(() => upload.readyAsset());
  assert.equal(calls[1]?.init.credentials, 'include');
  assert.equal((calls[1]?.init.headers as Record<string, string>)['Content-Type'], 'application/octet-stream');
  assert.equal((calls[1]?.init.headers as Record<string, string>)['X-CSRF-Token'], 'a'.repeat(43));
  assert.equal(calls[1]?.init.body, file);
  assert.equal(calls[1]?.init.redirect, 'error');
  await upload.refresh();
  assert.equal(upload.readyAsset(), asset);
  assert.equal(calls.filter(call => call.init.method === 'POST').length, 2);
  assert.equal(calls[2]?.url, calls[3]?.url);
  upload.dispose();
});

void test('lost reserve response never retries creation and requires explicit discard', async () => {
  const { client, calls } = setup([async () => { throw new TypeError('network'); }]);
  const upload = new MediaUpload(client);
  await upload.start('AVATAR', file);
  assert.deepEqual(upload.getSnapshot(), { phase: 'uncertain' });
  await assert.rejects(upload.refresh());
  await assert.rejects(upload.start('AVATAR', file));
  assert.equal(calls.length, 1);
  upload.dispose();
});

void test('uncertain binary transfer reconciles same asset and never retransmits bytes', async () => {
  const { client, calls } = setup([status('reserved', 201), async () => { throw new TypeError('network'); }, status('deleted')]);
  const upload = new MediaUpload(client, { intervalMs: 0, attempts: 1 });
  await upload.start('AVATAR', file);
  assert.equal(upload.getSnapshot().receipt?.assetId, asset);
  await upload.refresh();
  assert.equal(upload.getSnapshot().phase, 'failed');
  assert.throws(() => upload.readyAsset());
  assert.equal(calls.filter(call => call.url.endsWith('/content')).length, 1);
  upload.dispose();
});

void test('delayed reserve completion after revocation cannot upload or repopulate state', async () => {
  let resolve!: (value: Response) => void;
  const response = new Promise<Response>(done => { resolve = done; });
  const { client, controller, calls } = setup([() => response]);
  const upload = new MediaUpload(client);
  const pending = upload.start('AVATAR', file);
  controller.abort(); resolve(status('reserved', 201));
  await pending;
  assert.deepEqual(upload.getSnapshot(), { phase: 'empty' });
  assert.equal(calls.length, 1);
  upload.dispose();
});

void test('generation predicate also fences non-cooperative transports without abort', async () => {
  let resolve!: (value: Response) => void;
  const response = new Promise<Response>(done => { resolve = done; });
  const { client, invalidate } = setup([() => response]);
  const pending = client.status(asset, idleSignal());
  invalidate(); resolve(status('ready'));
  await assert.rejects(pending, /REVOKED/);
});

void test('late operation after explicit clear cannot overwrite a new empty draft', async () => {
  let resolve!: (value: Response) => void;
  const response = new Promise<Response>(done => { resolve = done; });
  const { client } = setup([() => response]);
  const upload = new MediaUpload(client);
  const pending = upload.start('AVATAR', file);
  upload.clear(); resolve(status('reserved', 201)); await pending;
  assert.deepEqual(upload.getSnapshot(), { phase: 'empty' });
  upload.dispose();
});

void test('authorization denial on refresh clears prior private asset reference', async () => {
  const { client } = setup([status('reserved', 201), status('processing', 202), status('ready'), json({}, 403)]);
  const upload = new MediaUpload(client, { intervalMs: 0, attempts: 1 });
  await upload.start('AVATAR', file); await upload.refresh();
  assert.deepEqual(upload.getSnapshot(), { phase: 'failed' });
  upload.dispose();
});

void test('signed image GET never forwards API credentials, headers or referrer', async () => {
  const { client, calls } = setup([access(), image()]);
  const lease = await client.image(asset, { variant: 'image', roomId: room, actorId: asset }, idleSignal());
  assert.equal(lease.blob.type, 'image/webp');
  assert.equal(calls[0]?.init.credentials, 'include');
  assert.equal(calls[1]?.init.credentials, 'omit');
  assert.equal(calls[1]?.init.headers, undefined);
  assert.equal(calls[1]?.init.referrerPolicy, 'no-referrer');
  assert.equal(calls[1]?.init.redirect, 'error');
  assert.equal(calls[1]?.init.cache, 'no-store');
});

void test('unapproved signer origin, lifetime and extra response fields fail before transfer', async () => {
  for (const value of [
    { url: 'https://unapproved.example.test/image', expiresIn: 60 },
    { url: 'https://storage.example.test/image', expiresIn: 61 },
    { url: 'https://storage.example.test/image', expiresIn: 60, headers: { Authorization: 'forbidden' } },
    { url: 'https://user:pass@storage.example.test/image', expiresIn: 60 },
    { url: 'http://storage.example.test/image', expiresIn: 60 },
  ]) {
    const { client, calls } = setup([json(value)]);
    await assert.rejects(client.image(asset, { variant: 'image' }, idleSignal()));
    assert.equal(calls.length, 1);
  }
});

void test('unavailable or non-image storage response never yields displayable content', async () => {
  for (const response of [json({}, 403), new Response('<html>error</html>', { headers: { 'Content-Type': 'text/html' } })]) {
    const { client } = setup([access(), response]);
    await assert.rejects(client.image(asset, { variant: 'image' }, idleSignal()));
  }
});

void test('image resource revokes object URL synchronously on authorization loss', async t => {
  const revoked: string[] = [];
  t.mock.method(URL, 'createObjectURL', () => 'blob:isolated-test');
  t.mock.method(URL, 'revokeObjectURL', (url: string) => { revoked.push(url); });
  const { client, controller } = setup([access(), image()]);
  const resource = new MediaImageResource(client);
  await resource.load(asset, { variant: 'image' });
  assert.equal(resource.getSnapshot().phase, 'ready');
  controller.abort();
  assert.deepEqual(resource.getSnapshot(), { phase: 'empty' });
  assert.deepEqual(revoked, ['blob:isolated-test']);
  resource.dispose();
});

void test('image expiry clears derived bytes; explicit reload gets fresh server authorization', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const revoked: string[] = [];
  t.mock.method(URL, 'createObjectURL', () => 'blob:isolated-test');
  t.mock.method(URL, 'revokeObjectURL', (url: string) => { revoked.push(url); });
  const { client, calls } = setup([access(), image(), json({}, 404)]);
  const resource = new MediaImageResource(client);
  await resource.load(asset, { variant: 'image' });
  t.mock.timers.tick(60_001);
  assert.equal(resource.getSnapshot().phase, 'expired');
  assert.deepEqual(revoked, ['blob:isolated-test']);
  await resource.load(asset, { variant: 'image' });
  assert.equal(resource.getSnapshot().phase, 'unavailable');
  assert.equal(calls.length, 3);
  resource.dispose();
});

void test('late image body after unmount cannot allocate object URL', async t => {
  let finish!: () => void;
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    finish = () => { controller.enqueue(new Uint8Array([1])); controller.close(); };
  } });
  const { client } = setup([access(), new Response(stream, { headers: { 'Content-Type': 'image/webp' } })]);
  const create = t.mock.method(URL, 'createObjectURL', () => 'blob:isolated-test');
  const resource = new MediaImageResource(client);
  const pending = resource.load(asset, { variant: 'image' });
  await new Promise(resolve => setImmediate(resolve));
  resource.clear(); finish(); await pending;
  assert.equal(create.mock.callCount(), 0);
  assert.deepEqual(resource.getSnapshot(), { phase: 'empty' });
  resource.dispose();
});

void test('catalog only returns server approved references and uses cursor without writes', async () => {
  const { client, calls } = setup([json({ items: [{ id: asset, assetId: room, label: '스티커' }], nextCursor: null })]);
  const page = await client.stickers(room, asset, idleSignal());
  assert.equal(page.items[0]?.id, asset);
  assert.equal(calls[0]?.init.method, 'GET');
  assert.ok(calls[0]?.url.endsWith(`?after=${asset}`));
});

void test('image response stream is bounded even without Content-Length', async () => {
  const { client } = setup([access(), new Response(new Uint8Array(10 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/webp' } })]);
  await assert.rejects(client.image(asset, { variant: 'image' }, idleSignal()), /INVALID_RESPONSE/);
});

void test('delayed signed access cannot extend sixty-second authorization window', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const { client, calls } = setup([async () => { t.mock.timers.setTime(61_001); return access(); }]);
  await assert.rejects(client.image(asset, { variant: 'image' }, idleSignal()), /EXPIRED/);
  assert.equal(calls.length, 1);
});

void test('fresh status reserved after uncertain upload still never retransmits automatically', async () => {
  const { client, calls } = setup([status('reserved', 201), async () => { throw new TypeError('network'); }, status('reserved')]);
  const upload = new MediaUpload(client, { intervalMs: 0, attempts: 1 });
  await upload.start('AVATAR', file); await upload.refresh();
  assert.equal(upload.getSnapshot().phase, 'pending');
  assert.equal(calls.filter(call => call.init.method === 'POST').length, 2);
  assert.throws(() => upload.readyAsset());
  upload.dispose();
});

void test('metadata rejects chunked bytes above 64 KiB despite absent or understated length', async () => {
  for (const declared of [undefined, '1']) {
    let cancelled = false;
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { pulls++; controller.enqueue(new Uint8Array(16 * 1024).fill(32)); },
      cancel() { cancelled = true; },
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (declared !== undefined) headers['Content-Length'] = declared;
    const { client } = setup([new Response(stream, { headers })]);
    await assert.rejects(client.status(asset, idleSignal()), { message: 'INVALID_RESPONSE' });
    assert.equal(cancelled, true);
    assert.equal(stream.locked, false);
    assert.ok(pulls <= 6, 'must stop reading at the first excess chunk');
  }
});

void test('oversized declared metadata is cancelled before any body read', async () => {
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull() { pulls++; }, cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const { client } = setup([new Response(stream, { headers: { 'Content-Type': 'application/json', 'Content-Length': '65537' } })]);
  await assert.rejects(client.status(asset, idleSignal()), { message: 'INVALID_RESPONSE' });
  assert.equal(pulls, 0);
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});

void test('metadata accepts exactly 64 KiB and decodes split multibyte catalog labels', async () => {
  const payload = JSON.stringify({ items: [{ id: asset, assetId: asset, label: '스티커' }], nextCursor: null });
  const encoded = new TextEncoder().encode(payload);
  const bytes = new Uint8Array(64 * 1024).fill(32);
  bytes.set(encoded);
  const split = encoded.indexOf(0xec) + 1;
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(bytes.slice(0, split)); controller.enqueue(bytes.slice(split)); controller.close();
  } });
  const { client } = setup([new Response(stream, { headers: { 'Content-Type': 'application/json', 'Content-Length': String(bytes.byteLength) } })]);
  assert.equal((await client.stickers(room, undefined, idleSignal())).items[0]?.label, '스티커');
  assert.equal(stream.locked, false);
});

void test('malformed JSON and HTTP errors never expose response payloads', async () => {
  const privatePayload = 'private-response-marker';
  for (const code of [200, 403]) {
    const { client } = setup([new Response(privatePayload, { status: code, headers: { 'Content-Type': 'application/json' } })]);
    await assert.rejects(client.status(asset, idleSignal()), error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, code === 200 ? 'INVALID_RESPONSE' : 'REQUEST_FAILED');
      assert.ok(!String(error.stack).includes(privatePayload));
      return true;
    });
  }
});

void test('abort cancels a pending metadata read and releases its lock', async () => {
  for (const revoke of [false, true]) {
    let reading!: () => void;
    const started = new Promise<void>(resolve => { reading = resolve; });
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ pull() { reading(); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const { client, controller } = setup([new Response(stream, { headers: { 'Content-Type': 'application/json' } })]);
    const operation = new AbortController();
    const pending = client.status(asset, operation.signal);
    await started;
    (revoke ? controller : operation).abort();
    await assert.rejects(pending, revoke ? /REVOKED/ : /abort/i);
    assert.equal(cancelled, true);
    assert.equal(stream.locked, false);
  }
});

void test('provider avatar reads use exact API ticket URL without cookie or CSRF forwarding', async () => {
  const url = 'https://api.qa.rogi.chat/v1/profile-images?ticket=' + 'A'.repeat(64);
  const { client, calls } = setup([json({ url, expiresIn: 60 }), image()]);
  const result = await client.providerAvatar(room, asset, idleSignal());
  assert.equal(result.blob.type, 'image/webp');
  assert.equal(calls[0]?.url, `https://api.qa.rogi.chat/v1/rooms/${room}/actors/${asset}/provider-avatar/access`);
  assert.equal(calls[0]?.init.body, '{}');
  assert.equal(calls[1]?.url, url);
  assert.equal(calls[1]?.init.credentials, 'omit');
  assert.equal(calls[1]?.init.headers, undefined);
  assert.equal(calls[1]?.init.redirect, 'error');
  assert.equal(calls[1]?.init.referrerPolicy, 'no-referrer');
  result.release?.();
});
void test('provider avatar rejects untrusted origins, paths, extra query, wrong type and oversized body', async () => {
  const base = 'https://api.qa.rogi.chat/v1/profile-images?ticket=' + 'A'.repeat(64);
  for (const url of [base.replace('api.qa.rogi.chat', 'evil.example'), base.replace('profile-images', 'me/profile'), base + '&extra=1', base + '#hash', base.replace('https:', 'http:')]) {
    const state = setup([json({ url, expiresIn: 60 })]);
    await assert.rejects(state.client.providerAvatar(room, asset, idleSignal()));
    assert.equal(state.calls.length, 1);
  }
  for (const response of [new Response('not-image', { headers: { 'Content-Type': 'image/svg+xml' } }), new Response(new Uint8Array(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/jpeg' } })]) {
    const state = setup([json({ url: base, expiresIn: 60 }), response]);
    await assert.rejects(state.client.providerAvatar(room, asset, idleSignal()));
  }
});
