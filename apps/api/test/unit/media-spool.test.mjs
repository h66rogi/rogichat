import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import filesystem, { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable, PassThrough } from 'node:stream';
import { setTimeout as pause } from 'node:timers/promises';
import { MediaSpooler } from '../../dist/common/media/media-spool.js';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'rogichat-spool-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, spool: new MediaSpooler({ directory, ...options }) };
}
const input = (...chunks) => Readable.from(chunks.map(chunk => Buffer.from(chunk)), { objectMode: false });
const request = extra => ({ id: randomUUID(), maxBytes: 100, ...extra });

test('streams byte-exact content into private unique files and retains scratch reservation until idempotent dispose', async t => {
  const { directory, spool } = await fixture(t, { capacityBytes: 100 });
  const body = Buffer.from('안녕😀');
  const file = await spool.receive(input(body.subarray(0, 3), body.subarray(3)), request({ expectedBytes: body.length }));
  assert.equal(file.bytes, body.length); assert.deepEqual(await readFile(file.path), body);
  assert.equal(file.sha256, createHash('sha256').update(body).digest('hex'));
  assert.equal((await stat(file.path)).mode & 0o777, 0o600);
  assert.equal((await stat(dirname(file.path))).mode & 0o777, 0o700);
  assert.deepEqual(spool.stats(), { activeUploads: 0, reservedBytes: body.length });
  assert.ok(Object.isFrozen(file));
  await Promise.all([file.dispose(), file.dispose()]); await file.dispose();
  assert.deepEqual(await readdir(directory), []); assert.deepEqual(spool.stats(), { activeUploads: 0, reservedBytes: 0 });
});

test('actual overflow, short/long declared length, empty and source failure remove files and reservations', async t => {
  const { directory, spool } = await fixture(t);
  for (const [stream, options, code] of [
    [input('12345', '678901'), request({ maxBytes: 10 }), 'TOO_LARGE'],
    [input('12345'), request({ expectedBytes: 4 }), 'LENGTH_MISMATCH'],
    [input('123'), request({ expectedBytes: 4 }), 'LENGTH_MISMATCH'],
    [input(), request(), 'EMPTY_UPLOAD'],
    [Readable.from((async function* () { yield Buffer.from('a'); throw new Error('secret-source-error'); })(), { objectMode: false }), request(), 'IO_FAILED'],
  ]) {
    await assert.rejects(spool.receive(stream, options), { code });
    assert.deepEqual(await readdir(directory), []); assert.deepEqual(spool.stats(), { activeUploads: 0, reservedBytes: 0 });
  }
});

test('unknown-length uploads reserve the whole cap; stored files consume quota after upload slots release', async t => {
  const { directory, spool } = await fixture(t, { capacityBytes: 10 });
  const first = await spool.receive(input('a'), request({ maxBytes: 6 }));
  assert.equal(spool.stats().reservedBytes, 6);
  await assert.rejects(spool.receive(input('b'), request({ maxBytes: 5 })), { code: 'CAPACITY_EXCEEDED' });
  assert.equal((await readdir(directory)).length, 1);
  await first.dispose();
  const second = await spool.receive(input('b'), request({ maxBytes: 10 })); await second.dispose();
  assert.equal(spool.stats().reservedBytes, 0);
});

test('two process-wide concurrent streams bound admission even across spooler instances', async t => {
  const first = await fixture(t); const second = await fixture(t);
  const a = new PassThrough(), b = new PassThrough();
  const one = first.spool.receive(a, request()); const two = second.spool.receive(b, request());
  await assert.rejects(first.spool.receive(input('no'), request()), { code: 'CONCURRENCY_EXCEEDED' });
  assert.equal(first.spool.stats().activeUploads + second.spool.stats().activeUploads, 2);
  a.end('a'); b.end('b');
  const files = await Promise.all([one, two]); await Promise.all(files.map(file => file.dispose()));
  assert.equal(first.spool.stats().reservedBytes + second.spool.stats().reservedBytes, 0);
});

test('process-wide scratch cap cannot be multiplied with multiple spooler instances', async t => {
  const { directory } = await fixture(t); const files = [];
  t.after(() => Promise.all(files.map(file => file.dispose())));
  for (let index = 0; index < 5; index++) files.push(await new MediaSpooler({ directory }).receive(input('a'), request({ maxBytes: 50 * 1024 * 1024 })));
  await assert.rejects(new MediaSpooler({ directory }).receive(input('b'), request({ maxBytes: 50 * 1024 * 1024 })), { code: 'CAPACITY_EXCEEDED' });
  await Promise.all(files.map(file => file.dispose()));
});

test('overflow destroys a still-open producer without masking the byte-limit failure', async t => {
  const { directory, spool } = await fixture(t); const source = new PassThrough();
  const pending = spool.receive(source, request({ maxBytes: 4 }));
  source.write('12345');
  await assert.rejects(pending, { code: 'TOO_LARGE' });
  assert.equal(source.destroyed, true); assert.deepEqual(await readdir(directory), []);
  assert.equal(spool.stats().reservedBytes, 0);
});

test('abort, idle and total deadlines tear down slow streams with sanitized failures', async t => {
  const { directory, spool } = await fixture(t, { idleMs: 25, totalMs: 90 });
  const abort = new globalThis.AbortController(); const source = new PassThrough();
  const pending = spool.receive(source, request({ signal: abort.signal }));
  abort.abort(new Error('sensitive-abort-reason'));
  await assert.rejects(pending, { code: 'ABORTED', message: 'ABORTED' });
  assert.equal(source.destroyed, true);
  await assert.rejects(spool.receive(new PassThrough(), request()), { code: 'IDLE_TIMEOUT' });
  const trickle = new PassThrough();
  const timer = setInterval(() => trickle.write('a'), 5);
  try { await assert.rejects(spool.receive(trickle, request()), { code: 'TOTAL_TIMEOUT' }); }
  finally { clearInterval(timer); }
  assert.deepEqual(await readdir(directory), []); assert.deepEqual(spool.stats(), { activeUploads: 0, reservedBytes: 0 });
});

test('rejects paths, decoded/object streams, invalid bounds and pre-aborted requests before creating files', async t => {
  const { directory, spool } = await fixture(t);
  for (const options of [request({ id: '../escape' }), request({ id: '/tmp/file' }), request({ maxBytes: 0 }),
    request({ maxBytes: 50 * 1024 * 1024 + 1 }), request({ expectedBytes: 101 }), request({ expectedBytes: -1 }), request({ expectedBytes: 0 })]) {
    await assert.rejects(spool.receive(input('a'), options), { code: 'INVALID_INPUT' });
  }
  await assert.rejects(spool.receive(Readable.from([{ evil: true }]), request()), { code: 'INVALID_INPUT' });
  await assert.rejects(spool.receive(input('a').setEncoding('utf8'), request()), { code: 'INVALID_INPUT' });
  await assert.rejects(spool.receive(input('a'), request({ signal: AbortSignal.abort() })), { code: 'ABORTED' });
  for (const options of [{ directory: 'relative' }, { maxConcurrent: 3 }, { capacityBytes: 256 * 1024 * 1024 + 1 }, { idleMs: 30001 }, { totalMs: 300001 }]) assert.throws(() => new MediaSpooler(options), { code: 'INVALID_INPUT' });
  assert.deepEqual(await readdir(directory), []); assert.equal(spool.stats().reservedBytes, 0);
});

test('backpressure bounds producer progress and chunked uploads complete without buffering whole input', async t => {
  const { spool } = await fixture(t); let produced = 0;
  const source = new Readable({ highWaterMark: 1024, read() {
    while (produced < 1024) { produced++; if (!this.push(Buffer.alloc(1024))) return; }
    this.push(null);
  } });
  const pending = spool.receive(source, request({ maxBytes: 1024 * 1024 }));
  await pause(0);
  assert.ok(produced < 1024, 'producer must not prebuffer the whole file before destination is ready');
  const file = await pending; assert.equal(file.bytes, 1024 * 1024); await file.dispose();
});

test('scratch setup failures release upload and byte leases without leaking filesystem paths', async t => {
  const { directory } = await fixture(t);
  const spool = new MediaSpooler({ directory: join(directory, 'missing-private-directory') });
  await assert.rejects(spool.receive(input('a'), request()), { code: 'IO_FAILED', message: 'IO_FAILED' });
  assert.deepEqual(spool.stats(), { activeUploads: 0, reservedBytes: 0 });
});

test('cleanup failure retains scratch reservation and successful retry releases it only once', async t => {
  const { directory, spool } = await fixture(t, { capacityBytes: 10 });
  const file = await spool.receive(input('a'), request({ maxBytes: 10 }));
  const failure = t.mock.method(filesystem, 'rm', async () => { throw new Error('sensitive-filesystem-path'); });
  syncBuiltinESMExports();
  try {
    await assert.rejects(file.dispose(), { code: 'CLEANUP_FAILED', message: 'CLEANUP_FAILED' });
    assert.equal(spool.stats().reservedBytes, 10);
    await assert.rejects(spool.receive(input('b'), request({ maxBytes: 1 })), { code: 'CAPACITY_EXCEEDED' });
  } finally { failure.mock.restore(); syncBuiltinESMExports(); }
  await Promise.all([file.dispose(), file.dispose()]);
  assert.deepEqual(await readdir(directory), []); assert.equal(spool.stats().reservedBytes, 0);
});
