import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { DeletionLedger, encodeDeletionIntent, deletionIntentKey } from '../../dist/modules/deletion/deletion-ledger.js';
import { DeletionReconciler } from '../../dist/modules/deletion/deletion-reconciler.js';

const intent = () => ({ schemaVersion: 1, environment: 'qa', requestId: randomUUID(), actorUserId: randomUUID(),
  scope: 'MESSAGE', targetId: randomUUID(), roomId: randomUUID(), requestedAt: '2026-09-20T00:00:00.000Z' });
const hash = key => createHash('sha256').update(key).digest('hex');
// Test-only journal port. Actual transactional locks/leases are tested against disposable MySQL.
function fixture(records = [intent()]) {
  const rows = new Map(records.map(value => [deletionIntentKey('qa', value.requestId), encodeDeletionIntent(value)]));
  const store = { sourceId: randomBytes(32).toString('hex'), close() {}, putIfAbsent() {},
    read: async key => rows.get(key) ?? null,
    list: async (cursor, limit) => {
      const keys = [...rows.keys()].sort().filter(key => cursor === null || key > cursor);
      return { keys: keys.slice(0, limit), cursor: keys.length > limit ? keys[limit - 1] : null };
    } };
  const state = { cursor: null, entries: new Map(), calls: [], sourceFailure: null };
  const repository = {
    claimDiscovery: async (_tx, source) => ({ ...source, cursor: state.cursor }),
    registerPage: async (_tx, claim, page) => {
      for (const item of page.items) if (!state.entries.has(item.keySha256)) state.entries.set(item.keySha256,
        { ...item, sourceId: claim.sourceId, phase: 'APPLY', state: item.classification === 'VALID' ? 'READY' : 'INVALID' });
      state.cursor = page.cursor; state.sourceFailure = null;
      return { invalid: page.items.filter(item => item.classification !== 'VALID').length };
    },
    failDiscovery: async (_tx, _claim, code) => { state.sourceFailure = code; },
    claimEntry: async (_tx, source) => {
      const entry = [...state.entries.values()].find(row => row.state === 'READY' && row.sourceId === source.sourceId);
      if (!entry) return null;
      entry.state = 'CLAIMED';
      return { ...entry, ...source };
    },
    pinReceipt: async (_tx, claim, digest) => { state.entries.get(claim.keySha256).digest = digest; },
    failEntry: async (_tx, claim, code) => { Object.assign(state.entries.get(claim.keySha256), { state: 'FAILED', code }); },
  };
  const transactions = { write: operation => operation({}) };
  const apply = { replay: async (receipt, claim) => {
    state.calls.push(receipt.intent.requestId); state.entries.get(claim.keySha256).state = 'OBSERVED'; return 'observed';
  } };
  const ledger = new DeletionLedger(store, 'qa');
  const restart = () => new DeletionReconciler(ledger, apply, transactions, repository);
  return { rows, store, state, repository, transactions, apply, ledger, restart };
}

test('persistent malformed first receipt is retained while later receipts execute, including after restart', async () => {
  const records = [intent(), intent(), intent()], f = fixture(records);
  const first = [...f.rows.keys()].sort()[0]; f.rows.set(first, Buffer.from('malformed'));
  const result = await f.restart().tick();
  assert.equal(result.failed, 1); assert.equal(result.applied, 2); assert.equal(result.inventoryPassEnded, true);
  assert.equal(f.state.entries.get(hash(first)).code, 'INVALID_RECEIPT');
  assert.equal(f.state.calls.length, 2);
  const late = intent(); f.rows.set(deletionIntentKey('qa', late.requestId), encodeDeletionIntent(late));
  await f.restart().tick();
  assert.ok(f.state.calls.includes(late.requestId)); assert.equal(f.state.entries.get(hash(first)).state, 'FAILED');
});

test('bounded invalid item evidence never calls read or apply; invalid envelope stops discovery', async () => {
  const f = fixture(), good = [...f.rows.keys()][0];
  f.store.list = async () => ({ keys: ['qa/not-a-receipt', good], sizes: [0, 400], cursor: null });
  const result = await f.restart().tick();
  assert.equal(result.applied, 1);
  const invalid = f.state.entries.get(hash('qa/not-a-receipt'));
  assert.equal(invalid.state, 'INVALID'); assert.equal(invalid.key, null);
  for (const keys of [['production/escaped'], ['qa/' + 'x'.repeat(1024)], ['qa/\ud800'], [null], [good, good]]) {
    f.store.list = async () => ({ keys, cursor: null });
    assert.equal((await f.restart().tick()).discoveryFailed, true);
  }
});

test('discovery journal failure leaves cursor unchanged and does not starve previously registered execution', async () => {
  const f = fixture(), first = await f.ledger.discover();
  await f.repository.registerPage({}, { sourceId: f.store.sourceId }, first);
  f.repository.registerPage = async () => { throw new Error('synthetic_journal_unavailable'); };
  f.repository.failDiscovery = async () => { throw new Error('synthetic_journal_unavailable'); };
  const result = await f.restart().tick();
  assert.equal(result.discoveryFailed, true); assert.equal(result.applied, 1); assert.equal(f.state.cursor, null);
});

test('execution receives its own budget after discovery exceeds discovery admission time', async t => {
  const f = fixture(), page = await f.ledger.discover();
  await f.repository.registerPage({}, { sourceId: f.store.sourceId }, page);
  const original = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', ms => original(ms === 10000 ? 5 : ms));
  f.store.list = async () => { await new Promise(resolve => setTimeout(resolve, 15)); throw new Error('synthetic_listing_failure'); };
  const result = await f.restart().tick();
  assert.equal(result.discoveryFailed, true); assert.equal(result.applied, 1);
});

test('slow read exceeding execution deadline never admits apply and retains failed work', async t => {
  const f = fixture(), original = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', ms => original(ms === 20000 ? 5 : ms));
  const read = f.store.read;
  f.store.read = async key => { await new Promise(resolve => setTimeout(resolve, 15)); return read(key); };
  const result = await f.restart().tick();
  assert.equal(result.failed, 1); assert.equal(f.state.calls.length, 0);
  assert.equal([...f.state.entries.values()][0].state, 'FAILED');
});

test('shutdown during in-flight apply drains it, rejects overlap and admits no later entry', async () => {
  const f = fixture([intent(), intent()]), abort = new globalThis.AbortController();
  let release, entered; const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  f.apply.replay = async () => { entered(); await gate; return 'pending'; };
  const replay = f.restart(), pending = replay.tick(abort.signal);
  await started; assert.equal(await replay.tick(), undefined); abort.abort(); release();
  const result = await pending;
  assert.equal(result.attempted, 1); assert.equal(result.pending, 1);
  await assert.rejects(replay.tick(abort.signal));
});

test('source binding is mandatory and a changed source cannot execute old registered entries', async () => {
  const f = fixture(), page = await f.ledger.discover();
  await f.repository.registerPage({}, { sourceId: f.store.sourceId }, page);
  delete f.store.sourceId; await assert.rejects(f.restart().tick(), { code: 'INVALID_LEDGER_INTENT' });
  f.store.sourceId = randomBytes(32).toString('hex'); f.store.list = async () => ({ keys: [], cursor: null });
  const result = await f.restart().tick(); assert.equal(result.applied, 0); assert.equal(result.inventoryPassEnded, true);
});

test('four attempts bound each tick while restart discovers the next full page independently', async () => {
  const f = fixture(Array.from({ length: 51 }, intent));
  const first = await f.restart().tick();
  assert.equal(first.discovered, 50); assert.equal(first.attempted, 4); assert.equal(first.inventoryPassEnded, false);
  const second = await f.restart().tick();
  assert.equal(second.discovered, 1); assert.equal(second.attempted, 4); assert.equal(second.inventoryPassEnded, true);
  assert.equal(f.state.entries.size, 51);
});
