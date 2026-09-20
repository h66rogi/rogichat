import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MediaWorkerService } from '../../dist/modules/media/media-worker.service.js';
import { MediaWorkerRepository, acknowledgedWrite } from '../../dist/modules/media/media-worker.repository.js';

function fixture(rows = [{ id: 'input', object_key: 'input-key', state: 'ALLOCATED', byte_length: null, sha256: null }]) {
  let db = { asset: { id: 'asset', state: 'DELETING', reserved_bytes: 100n }, rows: globalThis.structuredClone(rows), budget: 100n, pending: [], completed: [], cursor: 0, provenance: [] };
  const objects = new Set(rows.map(row => row.object_key)), hooks = {};
  const calls = { removes: 0, refunds: 0 };
  let inTransaction = false;
  const transactions = { async write(fn) {
    const before = globalThis.structuredClone(db); inTransaction = true;
    try { return await fn({}); } catch (error) { db = before; throw error; } finally { inTransaction = false; }
  } };
  const repository = {
    async reference() { return [{ owner_user_id: 'owner' }]; },
    async lockOwner() { return [{ status: 'ACTIVE', linked: 'VERIFIED' }]; },
    async lockAsset() { return [db.asset]; },
    async block() { db.asset.state = 'DELETING'; },
    async uploading() { return []; }, async recentAttempts() { return []; },
    async objects() { return globalThis.structuredClone(db.rows); },
    async currentObjects() { return globalThis.structuredClone(db.rows); },
    async cleanupPage() {
      const page = globalThis.structuredClone(db.rows.slice(db.cursor, db.cursor + 100));
      db.provenance.push(...page.map(row => row.id)); return page;
    },
    async finishPage(_tx, _assetId, page) {
      for (const planned of page) {
        const row = db.rows.find(row => row.id === planned.id);
        if (!row || row.object_key !== planned.object_key) throw new Error('media_cleanup_provenance_conflict');
        if (acknowledgedWrite(row) && acknowledgedWrite(planned)) row.state = 'DELETED';
      }
      db.cursor = page.length ? db.cursor + page.length : 0;
      return db.rows.every(row => row.state === 'DELETED' && acknowledgedWrite(row) && db.provenance.includes(row.id));
    },
    async fence() { return hooks.stale ? [] : [{ id: 'job' }]; },
    async releaseBudget(_tx, bytes) { calls.refunds++; db.budget -= bytes; return { affectedRows: 1 }; },
    async deleteAsset() { db.asset.state = 'DELETED'; db.asset.reserved_bytes = 0n; },
    async renew() { return { affectedRows: 1 }; },
  };
  const jobs = {
    async continueMedia() { if (hooks.stale) throw new Error('media_cleanup_lease_lost'); db.pending = ['stable-asset-job']; },
    async complete(_tx, lease) {
      if (hooks.stale || db.completed.includes(lease.id)) return false;
      db.completed.push(lease.id); return true;
    },
  };
  const store = { async remove(key) {
    assert.equal(inTransaction, false); calls.removes++; objects.delete(key);
    // Resolving remove models a successful DELETE + HEAD404 at this instant.
    await hooks.afterAbsence?.(key);
  } };
  let generation = 0;
  const run = () => {
    const worker = new MediaWorkerService(transactions, store, {}, 'test', repository, jobs, {}, { async invalidateRevokedSticker() { return false; } });
    return worker.processMedia({ id: `job-${++generation}`, purpose: 'MEDIA', resourceId: 'asset', generation: 1n, leaseOwner: 'owner', leaseToken: 'token' });
  };
  return { run, hooks, calls, objects, repository, state: () => db };
}
const proven = variant => ({ id: variant, object_key: `${variant}-key`, state: variant === 'input' ? 'STORED' : 'READY', byte_length: '1', sha256: 'a'.repeat(64) });

for (const variant of ['input', 'image', 'video', 'poster', 'publication-image']) {
  test(`${variant}: provider PUT after DELETE/404 retains key, reservation and restart reconciliation`, async () => {
    const row = { id: variant, object_key: `${variant}-key`, state: 'ALLOCATED', byte_length: null, sha256: null };
    const f = fixture([row]);
    assert.equal(await f.run(), 'progress');
    assert.equal(f.objects.size, 0);
    // Client aborted/crashed or lost its lease; provider completion is independent.
    f.objects.add(row.object_key);
    assert.equal(f.state().asset.state, 'DELETING'); assert.deepEqual(f.state().rows, [row]);
    assert.equal(f.state().budget, 100n); assert.equal(f.calls.refunds, 0);
    assert.equal(f.state().pending.length, 1);
    // A new worker has no old process memory. It finds the retained key again.
    assert.equal(await f.run(), 'deferred'); // cursor wraps without losing the unresolved key
    assert.equal(await f.run(), 'progress'); assert.equal(f.objects.size, 0);
    assert.equal(f.state().pending.length, 1); assert.equal(f.state().budget, 100n);
    assert.equal(f.state().asset.reserved_bytes, 100n);
    assert.deepEqual(f.state().rows, [row]);
  });
}

test('elapsed/repeated reconciliation and misleading metadata never settle ALLOCATED', async () => {
  const row = { ...proven('image'), state: 'ALLOCATED' }, f = fixture([row]);
  for (let index = 0; index < 3; index++) await f.run();
  assert.equal(f.state().asset.state, 'DELETING'); assert.equal(f.calls.refunds, 0);
  assert.equal(acknowledgedWrite(row), false);
});

for (const change of ['state', 'key', 'membership', 'proof']) test(`current locked ${change} drift prevents completion after external I/O`, async () => {
  const f = fixture([proven('input')]);
  f.hooks.afterAbsence = () => {
    if (change === 'state') f.state().rows[0].state = 'ALLOCATED';
    if (change === 'key') f.state().rows[0].object_key = 'replacement-key';
    if (change === 'membership') f.state().rows.push(proven('image'));
    if (change === 'proof') f.state().rows[0].sha256 = null;
  };
  if (change === 'key') await assert.rejects(f.run(), /provenance_conflict/);
  else await f.run();
  assert.equal(f.state().asset.state, 'DELETING'); assert.equal(f.state().budget, 100n);
  assert.equal(f.calls.refunds, 0); assert.equal(f.state().completed.length, 0);
});

test('stale final job fence rolls back reconciliation continuation and preserves obligation', async () => {
  const f = fixture(); f.hooks.afterAbsence = () => { f.hooks.stale = true; };
  assert.equal(await f.run(), 'lease_lost');
  assert.equal(f.state().pending.length, 0); assert.equal(f.state().completed.length, 0);
  assert.equal(f.state().asset.state, 'DELETING'); assert.equal(f.state().budget, 100n);
  f.hooks.stale = false; delete f.hooks.afterAbsence;
  assert.equal(await f.run(), 'progress'); assert.equal(f.state().pending.length, 1);
});

test('legacy DELETED without successful-write evidence is recovered, never trusted as termination', async () => {
  const row = { id: 'legacy', object_key: 'legacy-key', state: 'DELETED', byte_length: null, sha256: null };
  const f = fixture([row]); f.state().asset.state = 'DELETED';
  // Historical quota was already refunded; no fabricated replacement accounting.
  f.state().asset.reserved_bytes = 0n; f.state().budget = 0n;
  await f.run(); assert.equal(f.calls.removes, 1);
  assert.equal(f.state().asset.state, 'DELETING'); assert.deepEqual(f.state().rows, [row]);
  assert.equal(f.state().pending.length, 1); assert.equal(f.calls.refunds, 0);
});

test('acknowledged originals/variants clean normally and quota is released once', async () => {
  const f = fixture(['input', 'image', 'video', 'poster'].map(proven));
  await f.run(); assert.equal(f.state().asset.state, 'DELETED');
  assert.equal(f.state().budget, 0n); assert.equal(f.calls.refunds, 1);
  assert.ok(f.state().rows.every(row => row.state === 'DELETED' && acknowledgedWrite(row)));
  await f.run(); assert.equal(f.calls.refunds, 1); assert.equal(f.calls.removes, 4);
});

test('bounded pages over 500 objects and absence failure retain keys and reservation without completion', async () => {
  const large = fixture(Array.from({ length: 501 }, (_, i) => proven(`row-${i}`)));
  await large.run(); assert.equal(large.calls.removes, 100); assert.equal(large.calls.refunds, 0);
  for (let i = 0; i < 5; i++) await large.run();
  assert.equal(large.calls.removes, 501); assert.equal(large.calls.refunds, 1);
  assert.equal(large.state().asset.state, 'DELETED');
  assert.equal(large.state().pending.length, 1);
  const f = fixture(); f.hooks.afterAbsence = () => { throw new Error('absence-unverified'); };
  await assert.rejects(f.run(), /absence-unverified/);
  assert.equal(f.state().budget, 100n); assert.equal(f.state().pending.length, 0);
  assert.equal(f.state().completed.length, 0);
});

test('cleanup inventory uses bounded current locking reads including legacy deleted rows', async () => {
  const repository = new MediaWorkerRepository(), queries = [];
  const tx = { async rows(sql, values) { queries.push({ sql, values }); return []; } };
  await repository.objects(tx, 'asset'); await repository.currentObjects(tx, 'asset');
  for (const { sql, values } of queries) {
    assert.match(sql, /ORDER BY o.id LIMIT 501 FOR UPDATE$/);
    assert.match(sql, /object_key,o.state,o.byte_length,o.sha256/); assert.doesNotMatch(sql, /state<>/);
    assert.equal(values.length, 1); assert.equal(values[0], 'asset');
  }
  await repository.recoverable(tx);
  assert.match(queries.at(-1).sql, /a.state='DELETED' AND EXISTS/);
  assert.match(queries.at(-1).sql, /LIMIT 20 FOR UPDATE SKIP LOCKED/);
});

test('real R2 adapter keeps conditional single-attempt PUT on every variant', async t => {
  const { R2MediaStore, mediaKey } = await import('../../dist/modules/media/adapters/media-store.js');
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { randomUUID, randomBytes } = await import('node:crypto');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const directory = await mkdtemp(join(tmpdir(), 'media-write-contract-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'input'); await writeFile(path, 'fixture');
  const store = new R2MediaStore({ accountId: randomBytes(16).toString('hex'), bucket: 'fixture-private',
    accessKeyId: randomBytes(16).toString('hex'), secretAccessKey: randomBytes(32).toString('hex'), prefix: 'test' });
  t.after(() => store.close());
  assert.equal(await store.client.config.maxAttempts(), 1);
  let calls = 0;
  store.client.config.requestHandler = { async handle(request) {
    calls++; assert.equal(request.method, 'PUT'); assert.equal(request.headers['if-none-match'], '*');
    assert.equal(request.headers['content-length'], '7');
    for await (const chunk of request.body) assert.ok(chunk.length);
    return { response: { statusCode: 503, headers: {}, body: new Uint8Array() } };
  }, destroy() {} };
  for (const variant of ['input', 'image', 'video', 'poster']) {
    await assert.rejects(store.put(mediaKey('test', randomUUID(), randomUUID(), variant), path, 7, 'application/octet-stream', new globalThis.AbortController().signal));
  }
  assert.equal(calls, 4, 'no implicit SDK retry may add an unregistered request');
});

test('late writer acknowledgement after DELETE needs a later ordered DELETE before refund', async () => {
  const f = fixture();
  f.hooks.afterAbsence = () => { Object.assign(f.state().rows[0], { state: 'READY', byte_length: '1', sha256: 'a'.repeat(64) }); };
  await f.run(); assert.equal(f.state().asset.state, 'DELETING'); assert.equal(f.calls.refunds, 0);
  delete f.hooks.afterAbsence;
  await f.run(); // bounded cursor wrap
  assert.equal(f.calls.refunds, 0);
  await f.run(); assert.equal(f.state().asset.state, 'DELETED'); assert.equal(f.calls.refunds, 1);
});
