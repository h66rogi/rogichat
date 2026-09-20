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
import { frame, readFrame } from '../../dist/common/media/media-decoder-protocol.js';
import { decoderServer } from '../../dist/isolated/media-decoder/media-decoder-server.js';
import { MediaSpooler } from '../../dist/common/media/media-spool.js';

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
    socket.end(body);
    const metadata = await response; const chunks = [];
    for await (const chunk of socket) chunks.push(chunk);
    return { metadata, bytes: Buffer.concat(chunks) };
  } finally { socket.destroy(); }
}

test('real PNG streams through Unix socket, half-close, isolated child and canonical WebP response without inherited secrets', async t => {
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
  const f = await fixture(t); const bytes = await png(); const header = frame(intent(bytes));
  const chunks = [...header].map(byte => Buffer.from([byte]));
  const result = await rawRequest(f.path, chunks, bytes);
  assert.equal(result.metadata.byteLength, result.bytes.length); assert.equal((await sharp(result.bytes).metadata()).format, 'webp');
  await until(async () => (await readdir(f.dir)).every(name => name === 's'));
  const combined = await rawRequest(f.path, [Buffer.concat([header, bytes])], Buffer.alloc(0));
  assert.equal(combined.metadata.width, 32); assert.equal(combined.metadata.byteLength, combined.bytes.length);
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
    const f = await fixture(t); await assert.rejects(rawRequest(f.path, [frame(header)], body));
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

function fake(metadata, body = Buffer.from('bad')) {
  return () => createServer({ allowHalfOpen: true }, socket => {
    socket.on('error', () => {}); socket.resume();
    socket.once('end', () => { socket.end(Buffer.concat([frame(metadata), body])); });
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
    socket.on('error', () => {}); socket.resume();
    socket.once('end', () => { void (async () => {
      const header = frame(metadata);
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
    socket.on('error', () => {}); socket.resume();
    socket.once('end', () => socket.write(Buffer.concat([frame({ contentType: 'image/webp', byteLength: 100, width: 32, height: 16 }), Buffer.from([1])])));
  }));
  const controller = new globalThis.AbortController();
  const pending = assert.rejects(f.client.decode(Readable.from([bytes]), intent(bytes), controller.signal));
  await until(() => f.spool.stats().activeUploads === 1); controller.abort(); await pending;
  assert.deepEqual(f.spool.stats(), { activeUploads: 0, reservedBytes: 0 });
  await assert.rejects(f.client.decode(Readable.from([bytes]), intent(bytes), AbortSignal.abort()));
  const unavailable = new UnixImageDecoder(join(f.dir, 'absent'), f.spool);
  await assert.rejects(unavailable.decode(Readable.from([bytes]), intent(bytes), AbortSignal.timeout(1000)));
});
