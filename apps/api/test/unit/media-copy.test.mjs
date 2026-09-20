import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { MediaCopyService } from '../../dist/modules/media/media-copy.service.js';
import { MediaSpooler } from '../../dist/common/media/media-spool.js';

function fixture() {
  const bytes = Buffer.from('synthetic bounded copy');
  const attempt = { objectId: randomUUID(), object_key: 'private-fixture', key: 'independent-fixture', byte_length: String(bytes.length), sha256: createHash('sha256').update(bytes).digest('hex') };
  let inTransaction = false, finalized = 0, puts = 0;
  const transactions = { async write(operation) { inTransaction = true; try { return await operation({}); } finally { inTransaction = false; } } };
  const core = { async preparePhoto() { assert.equal(inTransaction, true); return [attempt]; }, async finalizePhoto() { assert.equal(inTransaction, true); finalized++; }, isStaleLease() { return false; } };
  const store = { async read() { assert.equal(inTransaction, false); return { stream: Readable.from([bytes], { objectMode: false }), bytes: bytes.length }; }, async put(key, _path, length, type) { assert.equal(inTransaction, false); assert.equal(key, attempt.key); assert.equal(length, bytes.length); assert.equal(type, 'image/webp'); puts++; } };
  const spool = new MediaSpooler();
  const worker = new MediaCopyService(transactions, store, 'test', spool, core);
  return { bytes, attempt, transactions, core, store, spool, worker, state: () => ({ finalized, puts }) };
}
test('copy I/O follows committed preparation and precedes finalization; temporary files are released', async () => {
  const f = fixture(); assert.equal(await f.worker.processPublication({}), 'completed');
  assert.deepEqual(f.state(), { finalized: 1, puts: 1 }); assert.equal(f.spool.stats().reservedBytes, 0);
});
test('length and digest mismatch never reach PUT or READY', async () => {
  for (const kind of ['length', 'digest']) {
    const f = fixture();
    if (kind === 'length') f.attempt.byte_length = String(f.bytes.length + 1);
    else f.attempt.sha256 = '0'.repeat(64);
    await assert.rejects(f.worker.processPublication({}), { code: 'INVALID_RESOURCE' });
    assert.deepEqual(f.state(), { finalized: 0, puts: 0 }); assert.equal(f.spool.stats().reservedBytes, 0);
  }
});
test('failed and uncertain PUT never finalize but dispose local scratch', async () => {
  const f = fixture(); f.store.put = async () => { throw new Error('synthetic uncertain PUT'); };
  await assert.rejects(f.worker.processPublication({}), /synthetic uncertain PUT/);
  assert.equal(f.state().finalized, 0); assert.equal(f.spool.stats().reservedBytes, 0);
});
test('TEXT uses the existing handler and completed publication does no storage I/O', async () => {
  const f = fixture(); f.core.preparePhoto = async () => 'text';
  f.core.publishText = async transactions => { assert.equal(transactions, f.transactions); return 'completed'; };
  assert.equal(await f.worker.processPublication({}), 'completed');
  f.core.preparePhoto = async () => 'completed';
  assert.equal(await f.worker.processPublication({}), 'completed');
  assert.deepEqual(f.state(), { finalized: 0, puts: 0 });
});
