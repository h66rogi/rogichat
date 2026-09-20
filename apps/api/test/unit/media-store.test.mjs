import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { mediaKey, readMediaConfig, R2MediaStore } from '../../dist/modules/media/adapters/media-store.js';

test('private R2 configuration is file-only, strict and missing configuration disables media', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'media-config-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'config.json');
  const credentials = { accountId: randomBytes(16).toString('hex'), bucket: 'fixture-private', accessKeyId: randomBytes(16).toString('hex'), secretAccessKey: randomBytes(32).toString('hex') };
  assert.equal(readMediaConfig('qa', {}), undefined);
  await writeFile(file, JSON.stringify(credentials), { mode: 0o600 });
  const config = readMediaConfig('qa', { MEDIA_SECRET_FILE: file });
  assert.equal(config.prefix, 'qa'); assert.equal(config.bucket, credentials.bucket); assert.ok(Object.isFrozen(config));
  await chmod(file, 0o644); assert.throws(() => readMediaConfig('qa', { MEDIA_SECRET_FILE: file }), { field: 'MEDIA_SECRET_FILE' });
  await chmod(file, 0o600);
  for (const mutation of [{ endpoint: 'https://example.invalid' }, { bucket: '../other' }, { accountId: 'arbitrary-host' }, { public: true }]) {
    await writeFile(file, JSON.stringify({ ...credentials, ...mutation }));
    assert.throws(() => readMediaConfig('qa', { MEDIA_SECRET_FILE: file }), error => error.field === 'MEDIA_SECRET_FILE' && !error.message.includes(credentials.secretAccessKey));
  }
});

test('signed GET is exactly 60 seconds and key/environment scope cannot be selected by a caller', async () => {
  const config = { accountId: randomBytes(16).toString('hex'), bucket: 'fixture-private', accessKeyId: randomBytes(16).toString('hex'), secretAccessKey: randomBytes(32).toString('hex'), prefix: 'test' };
  const store = new R2MediaStore(config);
  try {
    const key = mediaKey('test', randomUUID(), randomUUID(), 'image');
    const url = new URL(await store.signedGet(key));
    assert.equal(url.protocol, 'https:'); assert.equal(url.hostname, `${config.accountId}.r2.cloudflarestorage.com`);
    assert.equal(url.pathname, `/${config.bucket}/${key}`); assert.equal(url.searchParams.get('X-Amz-Expires'), '60');
    assert.equal(url.searchParams.get('x-id'), 'GetObject'); assert.ok(url.searchParams.get('X-Amz-Signature'));
    for (const invalid of [key.replace('test/', 'qa/'), key + '?x=1', key.replace('/image', '/../../secrets'), 'https://example.invalid/private']) {
      assert.throws(() => store.signedGet(invalid), /invalid_media_key/);
    }
    assert.equal('signedPut' in store, false);
  } finally { store.close(); }
});

// Mock only the SDK request transport: real signing, command serialization and
// error deserialization run; no network, credentials or production wiring.
function removalFixture(t, replies) {
  const config = { accountId: randomBytes(16).toString('hex'), bucket: 'fixture-private', accessKeyId: randomBytes(16).toString('hex'), secretAccessKey: randomBytes(32).toString('hex'), prefix: 'test' };
  const store = new R2MediaStore(config); t.after(() => store.close());
  const key = mediaKey('test', randomUUID(), randomUUID(), 'input');
  const requests = [];
  store.client.config.requestHandler = { async handle(request, options) {
    requests.push({ method: request.method, path: request.path });
    assert.equal(request.hostname, `${config.accountId}.r2.cloudflarestorage.com`);
    assert.equal(request.protocol, 'https:'); assert.equal(options.abortSignal.aborted, false);
    assert.equal(request.path, `/${config.bucket}${request.method === 'HEAD' && requests.length === 3 ? '/' : `/${key}`}`);
    const reply = replies.shift(); assert.notEqual(reply, undefined, 'unexpected SDK request');
    if (typeof reply === 'function') return reply(options);
    if (reply instanceof Error) throw reply;
    return { response: { statusCode: reply, headers: {}, body: new Uint8Array() } };
  }, destroy() {} };
  return { store, key, requests, config };
}

test('remove proves exact immutable key missing with fresh bucket 200 after DELETE ACK', async t => {
  const f = removalFixture(t, [204, 404, 200]);
  await f.store.remove(f.key, new globalThis.AbortController().signal);
  assert.deepEqual(f.requests.map(r => r.method), ['DELETE', 'HEAD', 'HEAD']);
});

for (const fault of [200, 403, 429, 500, 503, new Error('private network details')]) {
  test(`remove refuses uncertain object HEAD ${fault instanceof Error ? 'network' : fault}`, async t => {
    const f = removalFixture(t, [204, fault]);
    await assert.rejects(f.store.remove(f.key, new globalThis.AbortController().signal), { message: 'media_absence_unverified' });
    assert.equal(f.requests.length, 2);
  });
}
for (const fault of [404, 403, 429, 500, 503, 204, new Error('private bucket details')]) {
  test(`object 404 is insufficient with bucket ${fault instanceof Error ? 'network' : fault}`, async t => {
    const f = removalFixture(t, [204, 404, fault]);
    await assert.rejects(f.store.remove(f.key, new globalThis.AbortController().signal), { message: 'media_absence_unverified' });
  });
}
for (const fault of [new Error('lost DELETE ACK'), 500, 503]) {
  test(`unknown DELETE ${fault instanceof Error ? 'ACK' : fault} permits independent verified read-back`, async t => {
    const f = removalFixture(t, [fault, 404, 200]);
    await f.store.remove(f.key, new globalThis.AbortController().signal);
    assert.equal(f.requests.length, 3);
  });
}
for (const fault of [400, 401, 403, 404, 429]) {
  test(`explicit DELETE ${fault} fails closed before read-back`, async t => {
    const f = removalFixture(t, [fault]);
    await assert.rejects(f.store.remove(f.key, new globalThis.AbortController().signal), { message: 'media_absence_unverified' });
    assert.equal(f.requests.length, 1);
  });
}

test('malformed/name-only/status-only HEAD errors cannot prove absence or leak details', async t => {
  for (const fault of [Object.assign(new Error('secret'), { name: 'NotFound' }), Object.assign(new Error('secret'), { $metadata: { httpStatusCode: 404 } }), Object.assign(new Error('secret'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } })]) {
    const f = removalFixture(t, [204, fault]);
    await assert.rejects(f.store.remove(f.key, new globalThis.AbortController().signal), error => {
      assert.equal(error.message, 'media_absence_unverified'); assert.equal(error.cause, undefined);
      assert.equal(JSON.stringify(error).includes('secret'), false); return true;
    });
  }
});

for (const stage of [0, 1, 2]) test(`caller abort at request ${stage + 1} rejects even if transport ignores abort`, async t => {
  const controller = new globalThis.AbortController();
  const replies = [204, 404, 200]; replies[stage] = () => { controller.abort(); return new Promise(() => {}); };
  const f = removalFixture(t, replies);
  await assert.rejects(f.store.remove(f.key, controller.signal), { message: 'media_absence_unverified' });
  assert.equal(f.requests.length, stage + 1);
});

test('abort arriving with final bucket success cannot authorize cleanup', async t => {
  const controller = new globalThis.AbortController();
  const f = removalFixture(t, [204, 404, () => { controller.abort(); return { response: { statusCode: 200, headers: {}, body: new Uint8Array() } }; }]);
  await assert.rejects(f.store.remove(f.key, controller.signal), { message: 'media_absence_unverified' });
});

test('already aborted removal and invalid keys perform no I/O', async t => {
  const f = removalFixture(t, []); const controller = new globalThis.AbortController(); controller.abort();
  await assert.rejects(f.store.remove(f.key, controller.signal), { message: 'media_absence_unverified' });
  for (const key of [f.key.replace('test/', 'qa/'), `${f.key}?x=1`, '../input', 'https://example.invalid/key']) {
    await assert.rejects(f.store.remove(key, new globalThis.AbortController().signal), /invalid_media_key/);
  }
  assert.equal(f.requests.length, 0);
});

test('removal has a 30-second total deadline even when transport never settles', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let entered; const ready = new Promise(resolve => { entered = resolve; });
  const f = removalFixture(t, [options => { entered(options.abortSignal); return new Promise(() => {}); }]);
  const pending = f.store.remove(f.key, new globalThis.AbortController().signal);
  const signal = await ready;
  const rejected = assert.rejects(pending, { message: 'media_absence_unverified' });
  t.mock.timers.tick(30_000);
  await rejected; assert.equal(signal.aborted, true); assert.equal(f.requests.length, 1);
});

for (const name of ['NoSuchBucket', 'AccessDenied', 'UnrecognizedError']) test(`HEAD 404 with explicit ${name} cannot establish absence`, async t => {
  const f = removalFixture(t, [204, () => ({ response: { statusCode: 404, headers: {}, body: Buffer.from(`<Error><Code>${name}</Code></Error>`) } })]);
  await assert.rejects(f.store.remove(f.key, new globalThis.AbortController().signal), { message: 'media_absence_unverified' });
  assert.equal(f.requests.length, 2);
});

test('explicit NoSuchKey 404 still requires fresh bucket existence', async t => {
  const f = removalFixture(t, [204, () => ({ response: { statusCode: 404, headers: {}, body: Buffer.from('<Error><Code>NoSuchKey</Code></Error>') } }), 200]);
  await f.store.remove(f.key, new globalThis.AbortController().signal);
  assert.equal(f.requests.length, 3);
});

test('named write denial without metadata cannot be converted into verified success', async t => {
  const f = removalFixture(t, [Object.assign(new Error('sensitive denial'), { name: 'AccessDenied' })]);
  await assert.rejects(f.store.remove(f.key, new globalThis.AbortController().signal), { message: 'media_absence_unverified' });
  assert.equal(f.requests.length, 1);
});

for (const stage of [1, 2]) test(`aggregate deadline does not restart at read-back request ${stage + 1}`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let entered; const ready = new Promise(resolve => { entered = resolve; });
  const replies = [() => { t.mock.timers.tick(29_000); return { response: { statusCode: 204, headers: {}, body: new Uint8Array() } }; }, 404, 200];
  replies[stage] = options => { entered(options.abortSignal); return new Promise(() => {}); };
  const f = removalFixture(t, replies);
  const pending = f.store.remove(f.key, new globalThis.AbortController().signal);
  const signal = await ready;
  const rejected = assert.rejects(pending, { message: 'media_absence_unverified' });
  t.mock.timers.tick(1000);
  await rejected; assert.equal(signal.aborted, true); assert.equal(f.requests.length, stage + 1);
});

test('lost DELETE ACK with object still present cannot resolve', async t => {
  const f = removalFixture(t, [new Error('lost ACK'), 200]);
  await assert.rejects(f.store.remove(f.key, new globalThis.AbortController().signal), { message: 'media_absence_unverified' });
  assert.equal(f.requests.length, 2);
});
