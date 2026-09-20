import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { DeletionReplayRepository } from '../../dist/modules/deletion/deletion-replay.repository.js';
import { DeletionReconciler } from '../../dist/modules/deletion/deletion-reconciler.js';
import { DeletionApplyService } from '../../dist/modules/deletion/deletion-apply.service.js';
import { DeletionRepository } from '../../dist/modules/deletion/deletion.repository.js';
import { ReplayFenceError } from '../../dist/modules/deletion/deletion-replay.types.js';
import { deletionIntentKey } from '../../dist/modules/deletion/deletion-ledger.js';
import { deletionFixture } from '../support/deletion-fixture.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const intent = () => ({ schemaVersion: 1, environment: 'qa', requestId: randomUUID(), actorUserId: randomUUID(),
  scope: 'MESSAGE', roomId: randomUUID(), targetId: randomUUID(), requestedAt: '2026-09-20T00:00:00.000Z' });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(t, count = 0) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api')), repository = new DeletionReplayRepository();
  const { ledger, store } = deletionFixture(), source = { sourceId: ledger.sourceId, environment: 'qa' };
  const records = Array.from({ length: count }, intent);
  for (const record of records) await ledger.ensureIntent(record);
  t.after(() => db.close());
  const discover = async () => {
    const claim = await db.transactions.write(tx => repository.claimDiscovery(tx, source));
    const page = await ledger.discover(claim.cursor);
    await db.transactions.write(tx => repository.registerPage(tx, claim, page));
    return claim;
  };
  const claim = () => db.transactions.write(tx => repository.claimEntry(tx, source));
  const entries = () => db.transactions.read(tx => tx.prisma.deletion_replay_entries.findMany({ where: { source_id: source.sourceId } }));
  const due = () => db.transactions.write(tx => tx.prisma.deletion_replay_entries.updateMany({ where: { source_id: source.sourceId }, data: { next_attempt_at: new Date(0) } }));
  // Domain row semantics are covered by messages/account integration tests; these
  // tests exercise the real journal, transaction fencing and checkpoint conflicts.
  const domain = { remove: async () => true };
  const apply = new DeletionApplyService(db.transactions, domain, new DeletionRepository(), {}, {});
  const replay = () => new DeletionReconciler(ledger, apply, db.transactions, repository);
  return { db, repository, ledger, store, source, records, discover, claim, entries, due, domain, apply, replay };
}

test('page registration and cursor are atomic; rollback/restart cannot lose obligations', async t => {
  const f = await fixture(t, 2), claim = await f.db.transactions.write(tx => f.repository.claimDiscovery(tx, f.source));
  const page = await f.ledger.discover(); page.cursor = 'synthetic-next-page';
  await assert.rejects(f.db.transactions.write(async tx => { await f.repository.registerPage(tx, claim, page); throw new Error('synthetic_rollback'); }));
  assert.equal((await f.entries()).length, 0);
  const before = await f.db.transactions.read(tx => tx.prisma.deletion_replay_sources.findUnique({ where: { source_id: f.source.sourceId } }));
  assert.equal(before.cursor, null);
  await f.db.transactions.write(tx => new DeletionReplayRepository().registerPage(tx, claim, page));
  assert.equal((await f.entries()).length, 2);
  const after = await f.db.transactions.read(tx => tx.prisma.deletion_replay_sources.findUnique({ where: { source_id: f.source.sourceId } }));
  assert.equal(after.cursor, page.cursor);
});

test('active claim rediscovery preserves phase, lease and failed evidence; metadata repair stays invalid', async t => {
  const f = await fixture(t, 1); await f.discover(); const claim = await f.claim();
  await f.discover();
  const [row] = await f.entries(); assert.equal(row.claim_token, claim.token); assert.equal(row.claim_epoch, claim.epoch); assert.equal(row.phase, 'APPLY');
  const key = deletionIntentKey('qa', randomUUID()); f.store.rows.set(key, Buffer.from('malformed'));
  const originalList = f.store.list.bind(f.store);
  f.store.list = async (...args) => { const page = await originalList(...args); return { ...page, sizes: page.keys.map(value => value === key ? 2048 : 400) }; };
  await f.discover();
  f.store.list = originalList; await f.discover();
  const invalid = (await f.entries()).find(value => value.key_sha256 === hash(key));
  assert.equal(invalid.state, 'INVALID'); assert.equal(invalid.classification, 'INVALID_SIZE'); assert.equal(invalid.object_key, null);
  assert.equal(invalid.evidence_conflict, true); assert.equal(invalid.last_failure_code, 'DISCOVERY_CONFLICT');
});

test('permanent malformed and checkpoint conflict do not starve independent valid receipts', async t => {
  const f = await fixture(t, 3), bad = f.records[0], conflict = f.records[1];
  f.store.rows.set(deletionIntentKey('qa', bad.requestId), Buffer.from('malformed'));
  await f.db.transactions.write(tx => tx.prisma.deletion_intents.create({ data: {
    request_id: conflict.requestId, environment: 'qa', actor_user_id: conflict.actorUserId, scope: 'MESSAGE',
    target_id: randomUUID(), room_id: conflict.roomId, requested_at: new Date(conflict.requestedAt), ledger_sha256: Buffer.alloc(32),
  } }));
  const first = await f.replay().tick(); assert.equal(first.failed, 2); assert.equal(first.applied, 1);
  const before = await f.entries(); assert.equal(before.find(row => row.key_sha256 === hash(deletionIntentKey('qa', bad.requestId))).state, 'INVALID');
  const failed = before.find(row => row.key_sha256 === hash(deletionIntentKey('qa', conflict.requestId)));
  assert.equal(failed.state, 'RETRY'); assert.ok(failed.receipt_sha256); assert.ok(failed.first_failure_at);
  const late = intent(); await f.ledger.ensureIntent(late); await f.due();
  const restarted = await f.replay().tick(); assert.ok(restarted.applied >= 1);
  assert.ok((await f.entries()).find(row => row.key_sha256 === hash(deletionIntentKey('qa', late.requestId))).processed_generation);
  assert.equal((await f.entries()).find(row => row.key_sha256 === failed.key_sha256).first_failure_at.getTime(), failed.first_failure_at.getTime());
});

test('single-attempt claim scheduling alternates new work and due failures across restarts', async t => {
  const f = await fixture(t, 2); await f.discover(); const first = await f.claim();
  await f.db.transactions.write(tx => f.repository.failEntry(tx, first, 'UNAVAILABLE')); await f.due();
  const retried = await f.claim(); assert.equal(retried.keySha256, first.keySha256);
  await f.db.transactions.write(tx => f.repository.failEntry(tx, retried, 'UNAVAILABLE')); await f.due();
  const next = await f.db.transactions.write(tx => new DeletionReplayRepository().claimEntry(tx, f.source));
  assert.notEqual(next.keySha256, first.keySha256);
  const more = intent(); await f.ledger.ensureIntent(more); await f.discover();
  const retryAgain = await f.claim(); assert.equal(retryAgain.keySha256, first.keySha256);
});

test('claim expiry and generation fencing reject stale pin/completion/failure after takeover', async t => {
  const f = await fixture(t, 1); await f.discover(); const old = await f.claim();
  await f.db.transactions.write(tx => tx.prisma.deletion_replay_entries.updateMany({ where: { source_id: f.source.sourceId }, data: { claim_until: new Date(0) } }));
  const current = await f.claim(); assert.ok(current.epoch > old.epoch);
  for (const operation of [tx => f.repository.pinReceipt(tx, old, 'a'.repeat(64)),
    tx => f.repository.finish(tx, old, 'a'.repeat(64), 'observed'), tx => f.repository.failEntry(tx, old, 'UNAVAILABLE')]) {
    await assert.rejects(f.db.transactions.write(operation), ReplayFenceError);
  }
  assert.equal((await f.entries())[0].claim_token, current.token);
});

test('final fence samples fresh DB time and rolls domain mutation back on expired completion', async t => {
  const f = await fixture(t, 1); await f.discover(); const claim = await f.claim();
  await assert.rejects(f.db.transactions.write(async tx => {
    await f.repository.fence(tx, claim);
    await tx.prisma.deletion_replay_entries.updateMany({ where: { source_id: f.source.sourceId }, data: { claim_until: new Date(0), receipt_sha256: 'b'.repeat(64) } });
    await f.repository.finish(tx, claim, 'b'.repeat(64), 'observed');
  }), ReplayFenceError);
  const [row] = await f.entries(); assert.equal(row.receipt_sha256, null); assert.equal(row.claim_token, claim.token);
});

test('independent pool skips an in-flight claimed row, and waits cannot admit an expired discovery lease', async t => {
  const f = await fixture(t, 1); await f.discover(); const claim = await f.claim();
  const other = new MysqlDatabase(readConfig('api')); t.after(() => other.close());
  const locked = deferred(), release = deferred();
  const held = f.db.transactions.write(async tx => { await f.repository.fence(tx, claim); locked.resolve(); await release.promise; });
  await locked.promise;
  try { assert.equal(await other.transactions.write(tx => f.repository.claimEntry(tx, f.source)), null); }
  finally { release.resolve(); await held; }
  const discovery = await f.db.transactions.write(tx => f.repository.claimDiscovery(tx, f.source));
  await f.db.transactions.write(tx => tx.prisma.deletion_replay_sources.update({ where: { source_id: f.source.sourceId }, data: { discovery_until: new Date(0) } }));
  const takeover = await other.transactions.write(tx => f.repository.claimDiscovery(tx, f.source));
  await assert.rejects(f.db.transactions.write(tx => f.repository.registerPage(tx, discovery, { items: [], cursor: null })), ReplayFenceError);
  assert.ok(takeover.epoch > discovery.epoch);
});

test('discovery failure history remains after recovery; source-bound backlog executes despite envelope failure', async t => {
  const f = await fixture(t, 1); await f.discover(); const list = f.store.list.bind(f.store);
  f.store.list = async () => ({ keys: ['production/escaped'], cursor: null });
  const tick = await f.replay().tick(); assert.equal(tick.discoveryFailed, true); assert.equal(tick.applied, 1);
  let source = await f.db.transactions.read(tx => tx.prisma.deletion_replay_sources.findUnique({ where: { source_id: f.source.sourceId } }));
  assert.equal(source.current_failure_code, 'INVENTORY_INVALID'); assert.ok(source.first_failure_at);
  f.store.list = list; await f.discover();
  source = await f.db.transactions.read(tx => tx.prisma.deletion_replay_sources.findUnique({ where: { source_id: f.source.sourceId } }));
  assert.equal(source.current_failure_code, null); assert.equal(source.last_failure_code, 'INVENTORY_INVALID'); assert.ok(source.first_failure_at);
});

test('lost actual page COMMIT acknowledgement is recovered from durable cursor rather than guessing', async t => {
  let armed = false;
  const connect = PrismaMariaDb.prototype.connect;
  t.mock.method(PrismaMariaDb.prototype, 'connect', async function () {
    const adapter = await connect.call(this), start = adapter.startTransaction.bind(adapter);
    adapter.startTransaction = async isolation => {
      const tx = await start(isolation), commit = tx.commit.bind(tx);
      tx.commit = async () => { await commit(); if (armed) { armed = false; throw new Error('synthetic_commit_ack_lost'); } };
      return tx;
    }; return adapter;
  });
  const f = await fixture(t, 1), claim = await f.db.transactions.write(tx => f.repository.claimDiscovery(tx, f.source));
  const page = await f.ledger.discover(); page.cursor = 'synthetic-next';
  await assert.rejects(f.db.transactions.write(async tx => { await f.repository.registerPage(tx, claim, page); armed = true; }), /commit_outcome_unknown/);
  const restarted = await f.db.transactions.write(tx => new DeletionReplayRepository().claimDiscovery(tx, f.source));
  assert.equal(restarted.cursor, 'synthetic-next'); assert.equal((await f.entries()).length, 1);
});

test('receipt digest pin survives apply rollback and changed bytes cannot replace the original evidence', async t => {
  const f = await fixture(t, 1); await f.discover(); const claim = await f.claim();
  const receipt = await f.ledger.readByKey(claim.key);
  await f.db.transactions.write(tx => f.repository.pinReceipt(tx, claim, receipt.sha256));
  f.domain.remove = async () => { throw new Error('synthetic_apply_failure'); };
  await assert.rejects(f.apply.replay(receipt, claim, f.repository, new globalThis.AbortController().signal));
  assert.equal((await f.entries())[0].receipt_sha256, receipt.sha256);
  await assert.rejects(f.db.transactions.write(tx => f.repository.pinReceipt(tx, claim, 'a'.repeat(64))), /receipt_conflict/);
  assert.equal(await f.db.transactions.read(tx => tx.prisma.deletion_intents.count({ where: { request_id: receipt.intent.requestId } })), 0);
});
