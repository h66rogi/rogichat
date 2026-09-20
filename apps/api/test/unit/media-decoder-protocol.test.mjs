import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createConnection, createServer, Socket } from 'node:net';
import { once } from 'node:events';
import { Readable, PassThrough } from 'node:stream';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay, setImmediate as nextTurn } from 'node:timers/promises';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import sharp from 'sharp';
import { UnixImageDecoder } from '../../dist/modules/media/adapters/media-decoder-client.js';
import { frame, readFrame, payloadStream } from '../../dist/common/media/media-decoder-protocol.js';
import { decoderServer } from '../../dist/isolated/media-decoder/media-decoder-server.js';
import { MediaSpooler } from '../../dist/common/media/media-spool.js';

function waitForUpload(socket) {
  void (async () => {
    const request = await readFrame(socket, AbortSignal.timeout(3000));
    for await (const chunk of payloadStream(socket, request.intent.byteLength, AbortSignal.timeout(3000))) assert.ok(Buffer.isBuffer(chunk));
    socket.emit('uploaded');
  })().catch(() => socket.destroy());
}
const png = () => sharp({ create: { width: 32, height: 16, channels: 3, background: 'red' } }).png().toBuffer();
const intent = bytes => ({ kind: 'PHOTO', contentType: 'image/png', byteLength: bytes.length });
async function until(predicate) {
  for (let count = 0; count < 200; count++) { if (await predicate()) return; await delay(10); }
  assert.fail('bounded condition did not settle');
}
async function fixture(t, makeServer = decoderServer) {
  const dir = await mkdtemp(join(tmpdir(), 'rg-dec-')); const path = join(dir, 's');
  const sockets = new Set(); const server = makeServer(dir);
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    await until(async () => (await readdir(dir)).every(name => !name.startsWith('output-') && !name.startsWith('rogichat-upload-')));
    await rm(dir, { recursive: true, force: true });
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); });
  server.listen(path); await once(server, 'listening');
  const spool = new MediaSpooler({ directory: dir });
  return { dir, path, server, spool, client: new UnixImageDecoder(path, spool) };
}
async function connect(path) {
  const socket = createConnection({ path, allowHalfOpen: true }); socket.on('error', () => {});
  await once(socket, 'connect'); return socket;
}
async function rawRequest(path, headerChunks, body) {
  const socket = await connect(path); const response = readFrame(socket, AbortSignal.timeout(3000));
  try {
    for (const chunk of headerChunks) { socket.write(chunk); await nextTurn(); }
    socket.write(body);
    const metadata = await response; const chunks = [];
    for await (const chunk of socket) chunks.push(chunk);
    return { metadata, bytes: Buffer.concat(chunks) };
  } finally { socket.destroy(); }
}

test('real PNG streams through Unix socket, length-delimited upload, isolated child and canonical WebP response without inherited secrets', async t => {
  const f = await fixture(t); const bytes = await png();
  const original = childProcess.spawn; let observed;
  const key = 'ROGICHAT_DECODER_TEST_SECRET'; const previous = process.env[key];
  process.env[key] = 'test-only-not-a-real-secret';
  const replacement = mock.method(childProcess, 'spawn', (...args) => { observed = args[2].env; return original(...args); });
  syncBuiltinESMExports();
  t.after(() => { replacement.mock.restore(); syncBuiltinESMExports(); if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  const result = await f.client.decode(Readable.from([bytes]), intent(bytes), AbortSignal.timeout(5000));
  try {
    assert.equal(result.contentType, 'image/webp'); assert.equal(result.width, 32); assert.equal(result.height, 16);
    const metadata = await sharp(result.file.path).metadata(); assert.equal(metadata.format, 'webp');
    assert.equal((await readFile(result.file.path)).length, result.file.bytes);
    assert.deepEqual(Object.keys(observed).sort(), ['LANG', 'PATH']); assert.equal(observed[key], undefined);
  } finally { await result.file.dispose(); }
  assert.deepEqual(f.spool.stats(), { activeUploads: 0, reservedBytes: 0 });
});

test('request header fragmentation preserves binary prefix; one-chunk header/body is preserved too', async t => {
  const f = await fixture(t); const bytes = await png(); const header = frame({ version: 1, intent: intent(bytes) });
  const chunks = [...header].map(byte => Buffer.from([byte]));
  const result = await rawRequest(f.path, chunks, bytes);
  assert.equal(result.metadata.variants[0].byteLength, result.bytes.length); assert.equal((await sharp(result.bytes).metadata()).format, 'webp');
  await until(async () => (await readdir(f.dir)).every(name => name === 's'));
  const combined = await rawRequest(f.path, [Buffer.concat([header, bytes])], Buffer.alloc(0));
  assert.equal(combined.metadata.variants[0].width, 32); assert.equal(combined.metadata.variants[0].byteLength, combined.bytes.length);
});

test('bounded framing rejects oversized/truncated/invalid JSON headers and closed or aborted sockets promptly', async t => {
  assert.throws(() => frame({ value: 'a'.repeat(1024) }));
  for (const payload of [Buffer.from([0, 0, 4, 1]), Buffer.from([255, 255, 255, 255]), Buffer.from([0, 0, 0, 1, 123]),
    Buffer.from([0, 0, 0, 3, 123, 125]), Buffer.from([0, 0, 0, 2, 123, 120]), frame({ nope: true })]) {
    const f = await fixture(t);
    await assert.rejects(rawRequest(f.path, [payload], Buffer.alloc(0)));
  }
  const closed = new Socket(); closed.destroy();
  await assert.rejects(readFrame(closed, AbortSignal.timeout(200)));
  const controller = new globalThis.AbortController(); const waiting = new Socket();
  const pending = readFrame(waiting, controller.signal); controller.abort();
  await assert.rejects(pending); waiting.destroy();
  const abruptlyClosed = new Socket(); const abruptlyPending = readFrame(abruptlyClosed, AbortSignal.timeout(1000));
  abruptlyClosed.destroy(); await assert.rejects(abruptlyPending);
});

test('server rejects body length mismatch and unknown metadata; client rejects short/long/error input streams', async t => {
  const bytes = await png();
  for (const [header, body] of [[{ ...intent(bytes), byteLength: bytes.length + 1 }, bytes],
    [{ ...intent(bytes), byteLength: bytes.length - 1 }, bytes], [{ ...intent(bytes), bucket: 'forbidden' }, bytes]]) {
    const f = await fixture(t); await assert.rejects(rawRequest(f.path, [frame({ version: 1, intent: header })], body));
  }
  for (const source of [Readable.from([bytes.subarray(0, -1)]), Readable.from([bytes, Buffer.from([0])]),
    new Readable({ read() { this.destroy(new Error('test-stream-failure')); } })]) {
    const f = await fixture(t); await assert.rejects(f.client.decode(source, intent(bytes), AbortSignal.timeout(2000)));
    assert.equal(f.spool.stats().reservedBytes, 0);
  }
});

test('aborting upload closes request and releases busy slot; concurrent request is rejected without disturbing first', async t => {
  const f = await fixture(t); const bytes = await png(); const source = new PassThrough(); const controller = new globalThis.AbortController();
  const first = f.client.decode(source, intent(bytes), controller.signal);
  const rejectedFirst = assert.rejects(first);
  await until(async () => (await readdir(f.dir)).some(name => name.startsWith('rogichat-upload-')));
  await assert.rejects(f.client.decode(Readable.from([bytes]), intent(bytes), AbortSignal.timeout(1000)));
  controller.abort(); await rejectedFirst; assert.equal(source.destroyed, true);
  await until(async () => (await readdir(f.dir)).every(name => name === 's'));
  const final = await f.client.decode(Readable.from([bytes]), intent(bytes), AbortSignal.timeout(5000));
  await final.file.dispose();
});

const response = metadata => ({ version: 1, kind: 'IMAGE', variants: [{ role: 'image', ...metadata }] });
function fake(metadata, body = Buffer.from('bad')) {
  return () => createServer({ allowHalfOpen: true }, socket => {
    socket.on('error', () => {});
    waitForUpload(socket);
    socket.once('uploaded', () => { socket.end(Buffer.concat([frame(response(metadata)), body])); });
  });
}
test('client rejects response metadata escalation and short/long response bytes with spool cleanup', async t => {
  const bytes = await png(); const valid = { contentType: 'image/webp', byteLength: 3, width: 32, height: 16 };
  for (const metadata of [{ ...valid, extra: true }, { ...valid, width: 20_000_001 }, { ...valid, contentType: 'image/png' },
    { ...valid, byteLength: 10 * 1024 * 1024 + 1 }, { ...valid, byteLength: 4 }, { ...valid, byteLength: 2 }]) {
    const f = await fixture(t, fake(metadata));
    await assert.rejects(f.client.decode(Readable.from([bytes]), intent(bytes), AbortSignal.timeout(2000)));
    assert.deepEqual(f.spool.stats(), { activeUploads: 0, reservedBytes: 0 });
  }
  const f = await fixture(t, fake({ ...valid, width: 513 }));
  await assert.rejects(f.client.decode(Readable.from([bytes]), { ...intent(bytes), kind: 'AVATAR' }, AbortSignal.timeout(2000)));
});

test('client accepts fragmented response header with coalesced binary and preserves exact output bytes', async t => {
  const bytes = await png(); const output = await sharp(bytes).webp().toBuffer();
  const metadata = { contentType: 'image/webp', byteLength: output.length, width: 32, height: 16 };
  const f = await fixture(t, () => createServer({ allowHalfOpen: true }, socket => {
    socket.on('error', () => {});
    waitForUpload(socket);
    socket.once('uploaded', () => { void (async () => {
      const header = frame(response(metadata));
      for (const chunk of [header.subarray(0, 2), header.subarray(2, 5), header.subarray(5)]) { socket.write(chunk); await nextTurn(); }
      socket.end(output);
    })(); });
  }));
  const result = await f.client.decode(Readable.from([bytes]), intent(bytes), AbortSignal.timeout(2000));
  assert.deepEqual(await readFile(result.file.path), output); await result.file.dispose();
});

test('abort while receiving response cleans partial output; already-aborted requests and unavailable decoder fail promptly', async t => {
  const bytes = await png();
  const f = await fixture(t, () => createServer({ allowHalfOpen: true }, socket => {
    socket.on('error', () => {});
    waitForUpload(socket);
    socket.once('uploaded', () => socket.write(Buffer.concat([frame(response({ contentType: 'image/webp', byteLength: 100, width: 32, height: 16 })), Buffer.from([1])])));
  }));
  const controller = new globalThis.AbortController();
  const pending = assert.rejects(f.client.decode(Readable.from([bytes]), intent(bytes), controller.signal));
  await until(() => f.spool.stats().activeUploads === 1); controller.abort(); await pending;
  assert.deepEqual(f.spool.stats(), { activeUploads: 0, reservedBytes: 0 });
  await assert.rejects(f.client.decode(Readable.from([bytes]), intent(bytes), AbortSignal.abort()));
  const unavailable = new UnixImageDecoder(join(f.dir, 'absent'), f.spool);
  await assert.rejects(unavailable.decode(Readable.from([bytes]), intent(bytes), AbortSignal.timeout(1000)));
});

const videoIntent = { kind: 'VIDEO', contentType: 'video/mp4', byteLength: 3 };
const videoManifest = () => ({ version: 1, kind: 'VIDEO', variants: [
  { role: 'video', contentType: 'video/mp4', byteLength: 3, width: 32, height: 16, durationMs: 1000 },
  { role: 'poster', contentType: 'image/webp', byteLength: 2, width: 32, height: 16 },
] });
function fakeVideo(manifest, body = Buffer.from([1, 2, 3, 4, 5])) {
  return () => createServer({ allowHalfOpen: true }, socket => {
    socket.on('error', () => {});
    waitForUpload(socket);
    socket.once('uploaded', () => socket.end(Buffer.concat([frame(manifest), body])));
  });
}
test('video fixed manifest streams two coalesced payloads and transfers independent disposal ownership', async t => {
  const f = await fixture(t, fakeVideo(videoManifest()));
  const result = await f.client.decodeVideo(Readable.from([Buffer.from('123')]), videoIntent, AbortSignal.timeout(2000));
  assert.equal(result.kind, 'VIDEO'); assert.equal(result.video.contentType, 'video/mp4'); assert.equal(result.poster.role, 'poster');
  assert.deepEqual(await readFile(result.video.file.path), Buffer.from([1, 2, 3]));
  assert.deepEqual(await readFile(result.poster.file.path), Buffer.from([4, 5]));
  await result.video.file.dispose(); await result.poster.file.dispose();
  assert.equal(f.spool.stats().reservedBytes, 0);
});

test('video rejects duplicate, extra, reordered, oversized and untrusted variants, versions and metadata', async t => {
  const cases = [];
  for (const mutate of [v => { v.version = 2; }, v => { v.path = '/forbidden'; }, v => { v.variants.push(v.variants[1]); },
    v => { v.variants[1] = v.variants[0]; }, v => { v.variants.reverse(); }, v => { v.kind = 'IMAGE'; },
    v => { v.variants[0].byteLength = 50 * 1024 * 1024 + 1; }, v => { v.variants[1].byteLength = 2 * 1024 * 1024 + 1; },
    v => { v.variants[0].durationMs = 60_001; }, v => { v.variants[0].width = 1922; }, v => { v.variants[0].height = 15; },
    v => { v.variants[0].binary = '/forbidden'; }, v => { v.variants[1].width = 641; }, v => { v.variants[1].role = 'image'; },
    v => { v.variants[0].contentType = 'video/quicktime'; }]) {
    const manifest = videoManifest(); mutate(manifest); cases.push(manifest);
  }
  for (const manifest of cases) {
    const f = await fixture(t, fakeVideo(manifest));
    await assert.rejects(f.client.decodeVideo(Readable.from([Buffer.from('123')]), videoIntent, AbortSignal.timeout(2000)));
    assert.equal(f.spool.stats().reservedBytes, 0);
  }
});

test('video truncation, overlong data, extra frames and delayed trailing bytes dispose ALL staged outputs', async t => {
  for (const body of [Buffer.from([1, 2]), Buffer.from([1, 2, 3, 4]), Buffer.from([1, 2, 3, 4, 5, 6]),
    Buffer.concat([Buffer.from([1, 2, 3, 4, 5]), frame(videoManifest())])]) {
    const f = await fixture(t, fakeVideo(videoManifest(), body));
    await assert.rejects(f.client.decodeVideo(Readable.from([Buffer.from('123')]), videoIntent, AbortSignal.timeout(2000)));
    assert.equal(f.spool.stats().reservedBytes, 0);
  }
  const f = await fixture(t, () => createServer({ allowHalfOpen: true }, socket => {
    socket.on('error', () => {});
    waitForUpload(socket); socket.once('uploaded', () => {
      socket.write(Buffer.concat([frame(videoManifest()), Buffer.from([1, 2, 3, 4, 5])]));
      setTimeout(() => socket.end(Buffer.from([6])), 50);
    });
  }));
  await assert.rejects(f.client.decodeVideo(Readable.from([Buffer.from('123')]), videoIntent, AbortSignal.timeout(2000)));
  assert.equal(f.spool.stats().reservedBytes, 0);
});

test('video abort during second payload or EOF wait disposes both variants and destroys source', async t => {
  for (const body of [Buffer.from([1, 2, 3, 4]), Buffer.from([1, 2, 3, 4, 5])]) {
    const f = await fixture(t, () => createServer({ allowHalfOpen: true }, socket => {
      socket.on('error', () => {});
    waitForUpload(socket); socket.once('uploaded', () => socket.write(Buffer.concat([frame(videoManifest()), body])));
    }));
    const controller = new globalThis.AbortController(); const source = Readable.from([Buffer.from('123')]);
    const pending = assert.rejects(f.client.decodeVideo(source, videoIntent, controller.signal));
    await until(() => f.spool.stats().reservedBytes === 5); controller.abort(); await pending;
    assert.equal(f.spool.stats().reservedBytes, 0); assert.equal(source.destroyed, true);
  }
});

test('duplicate JSON keys, legacy requests, repeated headers and untrusted request fields fail closed', async t => {
  const f = await fixture(t); const bytes = await png();
  const duplicate = Buffer.from('{"version":1,"version":1,"intent":{}}'); const length = Buffer.alloc(4); length.writeUInt32BE(duplicate.length);
  for (const header of [Buffer.concat([length, duplicate]), frame(intent(bytes)), frame({ version: 2, intent: intent(bytes) }),
    frame({ version: 1, intent: intent(bytes), binary: '/forbidden' }),
    Buffer.concat([frame({ version: 1, intent: intent(bytes) }), frame({ version: 1, intent: intent(bytes) })])]) {
    await assert.rejects(rawRequest(f.path, [header], bytes));
    await until(async () => (await readdir(f.dir)).every(name => name === 's'));
  }
});

test('maximum 50 MiB video plus 2 MiB poster stream sequentially within a single-receive 64 MiB spool', async t => {
  const manifest = videoManifest(); manifest.variants[0].byteLength = 50 * 1024 * 1024; manifest.variants[1].byteLength = 2 * 1024 * 1024;
  const f = await fixture(t, () => createServer({ allowHalfOpen: true }, socket => {
    socket.on('error', () => {}); waitForUpload(socket);
    socket.once('uploaded', () => {
      const block = Buffer.alloc(64 * 1024, 7);
      Readable.from((async function* () {
        yield frame(manifest);
        for (let bytes = 0; bytes < 52 * 1024 * 1024; bytes += block.length) yield block;
      })(), { objectMode: false, highWaterMark: block.length }).pipe(socket);
    });
  }));
  const spool = new MediaSpooler({ directory: f.dir, maxConcurrent: 1, capacityBytes: 64 * 1024 * 1024 });
  const client = new UnixImageDecoder(f.path, spool);
  const result = await client.decodeVideo(Readable.from([Buffer.from('123')]), videoIntent, AbortSignal.timeout(15000));
  try {
    assert.equal(result.video.file.bytes, 50 * 1024 * 1024); assert.equal(result.poster.file.bytes, 2 * 1024 * 1024);
    assert.deepEqual(spool.stats(), { activeUploads: 0, reservedBytes: 52 * 1024 * 1024 });
  } finally { await result.video.file.dispose(); await result.poster.file.dispose(); }
  assert.deepEqual(spool.stats(), { activeUploads: 0, reservedBytes: 0 });
});

test('spool idle failure interrupts a pending payload read and releases prior video without waiting for transport deadline', async t => {
  const f = await fixture(t, () => createServer({ allowHalfOpen: true }, socket => {
    socket.on('error', () => {}); waitForUpload(socket);
    socket.once('uploaded', () => socket.write(Buffer.concat([frame(videoManifest()), Buffer.from([1, 2, 3, 4])])));
  }));
  const spool = new MediaSpooler({ directory: f.dir, idleMs: 50 });
  const started = Date.now();
  await assert.rejects(new UnixImageDecoder(f.path, spool).decodeVideo(Readable.from([Buffer.from('123')]), videoIntent, AbortSignal.timeout(3000)));
  assert.ok(Date.now() - started < 1500); assert.deepEqual(spool.stats(), { activeUploads: 0, reservedBytes: 0 });
});
