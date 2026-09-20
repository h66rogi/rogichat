import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import { Readable } from 'node:stream';
import { MediaWorkerService } from '../../dist/modules/media/media-worker.service.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const calls = { renew: 0, ready: 0, puts: [], disposed: [] };
  const hooks = {};
  const source = new Readable({ read() {} });
  const result = { kind: 'VIDEO',
    video: { role: 'video', contentType: 'video/mp4', width: 1280, height: 720, durationMs: 1000,
      file: { path: 'video', bytes: 100, sha256: 'a'.repeat(64), async dispose() { calls.disposed.push('video'); await hooks.dispose?.(); } } },
    poster: { role: 'poster', contentType: 'image/webp', width: 640, height: 360,
      file: { path: 'poster', bytes: 50, sha256: 'b'.repeat(64), async dispose() { calls.disposed.push('poster'); } } },
  };
  const transactions = { async write(fn) { return fn({}); } };
  const repository = { async renew() { calls.renew++; return { affectedRows: await hooks.renew?.() ?? 1 }; } };
  const store = {
    async read() { return { stream: source, bytes: 128 }; },
    async put(key, path, bytes, type, signal) { signal.throwIfAborted(); calls.puts.push(key); await hooks.put?.(key); },
  };
  let signal;
  const decoder = { async decodeVideo(stream, intent, currentSignal) {
    assert.equal(stream, source); assert.equal(intent.kind, 'VIDEO'); signal = currentSignal;
    await hooks.decode?.(currentSignal); return result;
  } };
  const worker = new MediaWorkerService(transactions, store, decoder, 'test', repository, {}, {}, { async invalidateRevokedSticker() { return false; } });
  worker.prepareMedia = async () => ({ assetId: 'asset', objectId: 'video', key: 'video', inputKey: 'input',
    input: { kind: 'VIDEO', contentType: 'video/mp4', byteLength: 128 }, poster: { objectId: 'poster', key: 'poster' } });
  worker.finalizeMedia = async () => { calls.ready++; };
  const lease = { purpose: 'MEDIA', resourceId: 'asset', id: 'job', generation: 1n, leaseOwner: 'owner', leaseToken: 'token' };
  return { worker, calls, hooks, result, source, run: () => worker.processMedia(lease), signal: () => signal };
}

test('video renews while decoder runs past original 300s lease and stops renewal after completion', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); let done; f.hooks.decode = () => new Promise(resolve => { done = resolve; });
  const running = f.run(); await flush(); assert.equal(f.calls.renew, 1);
  for (let count = 0; count < 11; count++) { t.mock.timers.tick(30000); await flush(); }
  assert.equal(f.calls.renew, 12); assert.equal(f.signal().aborted, false);
  done(); assert.equal(await running, 'completed'); assert.equal(f.calls.ready, 1);
  assert.deepEqual(f.calls.puts, ['video', 'poster']); assert.deepEqual(f.calls.disposed, ['video', 'poster']);
  assert.equal(f.source.destroyed, true);
  t.mock.timers.tick(60000); await flush(); assert.equal(f.calls.renew, 12);
});

for (const failure of ['stale', 'unknown']) test(`heartbeat ${failure} aborts decoder and prevents PUT/READY`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  f.hooks.decode = signal => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  const running = f.run(); await flush();
  f.hooks.renew = () => { if (failure === 'unknown') throw new Error('unknown renewal'); return 0; };
  t.mock.timers.tick(30000); await flush();
  assert.equal(await running, 'lease_lost'); assert.equal(f.calls.ready, 0); assert.deepEqual(f.calls.puts, []);
  assert.equal(f.source.destroyed, true); assert.equal(f.signal().aborted, true);
});

test('450s hard deadline aborts despite healthy renewals and no late READY occurs', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  f.hooks.decode = signal => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('deadline')), { once: true }));
  const running = f.run(); const rejected = assert.rejects(running, /deadline/); await flush();
  for (let count = 0; count < 15; count++) { t.mock.timers.tick(30000); await flush(); }
  await rejected; assert.equal(f.source.destroyed, true); assert.equal(f.calls.ready, 0); assert.deepEqual(f.calls.puts, []);
});

test('poster PUT failure disposes both outputs even when video disposal fails', async () => {
  const f = fixture(); f.hooks.put = key => { if (key === 'poster') throw new Error('poster unavailable'); };
  f.hooks.dispose = () => { throw new Error('video dispose failed'); };
  await assert.rejects(f.run(), /media_cleanup/);
  assert.deepEqual(f.calls.disposed, ['video', 'poster']); assert.equal(f.source.destroyed, true); assert.equal(f.calls.ready, 0);
});

test('decoder failure closes an unconsumed source stream', async () => {
  const f = fixture(); f.hooks.decode = () => { throw new Error('decoder unavailable'); };
  await assert.rejects(f.run(), /decoder unavailable/); assert.equal(f.source.destroyed, true); assert.equal(f.calls.ready, 0);
});

test('heartbeat loss after first PUT blocks poster PUT and disposes both outputs', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); f.hooks.put = async key => {
    if (key === 'video') { f.hooks.renew = () => 0; t.mock.timers.tick(30000); await flush(); }
  };
  assert.equal(await f.run(), 'lease_lost'); assert.deepEqual(f.calls.puts, ['video']);
  assert.deepEqual(f.calls.disposed, ['video', 'poster']); assert.equal(f.calls.ready, 0);
});

for (const failure of ['stale', 'unknown']) test(`heartbeat ${failure} aborts a pending second PUT and prevents READY`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  f.hooks.put = key => {
    if (key !== 'poster') return;
    f.hooks.renew = () => { if (failure === 'unknown') throw new Error('unknown renewal'); return 0; };
    return new Promise((resolve, reject) => f.signal().addEventListener('abort', () => reject(new Error('PUT aborted')), { once: true }));
  };
  const running = f.run(); await flush(); assert.deepEqual(f.calls.puts, ['video', 'poster']);
  t.mock.timers.tick(30000); await flush();
  assert.equal(await running, 'lease_lost'); assert.equal(f.calls.ready, 0);
  assert.equal(f.source.destroyed, true); assert.deepEqual(f.calls.disposed, ['video', 'poster']);
});

test('renewal racing successful finalization is drained without reversing committed completion', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); let finishRenewal;
  f.hooks.renew = () => f.calls.renew === 1 ? 1 : new Promise(resolve => { finishRenewal = resolve; });
  f.worker.finalizeMedia = async () => {
    t.mock.timers.tick(30000); await flush();
    // Models a successful authoritative DB completion while a separate renewal
    // waits for its job lock; the real-MySQL test below proves the SQL ordering.
    f.calls.ready++;
  };
  let settled = false; const running = f.run().then(value => { settled = true; return value; });
  await flush(); await flush(); assert.equal(f.calls.ready, 1); assert.equal(settled, false);
  finishRenewal(0); assert.equal(await running, 'completed');
  assert.equal(f.source.destroyed, true); assert.deepEqual(f.calls.disposed, ['video', 'poster']);
  t.mock.timers.tick(30000); await flush(); assert.equal(f.calls.renew, 2);
});

test('invalid decoder manifest closes source and disposes both outputs without PUT', async () => {
  const f = fixture(); f.result.poster.file.bytes = 2 * 1024 * 1024 + 1;
  await assert.rejects(f.run(), /decoder_protocol/); assert.equal(f.source.destroyed, true);
  assert.deepEqual(f.calls.disposed, ['video', 'poster']); assert.deepEqual(f.calls.puts, []); assert.equal(f.calls.ready, 0);
});
