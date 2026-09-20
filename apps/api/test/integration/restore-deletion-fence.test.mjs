import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createConnection } from 'mysql2/promise';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { RestoreGateRepository } from '../../dist/modules/restore-gate/restore-gate.repository.js';
import { DeletionApplyService } from '../../dist/modules/deletion/deletion-apply.service.js';
import { DeletionRepository } from '../../dist/modules/deletion/deletion.repository.js';
import { AccountDeletionRepository } from '../../dist/modules/deletion/account-deletion.repository.js';
import { IdentityGuardService } from '../../dist/modules/auth/identity-guard.service.js';
import { IdentityGuardRepository } from '../../dist/modules/auth/identity-guard.repository.js';
import { createUser } from '../support/domain-fixture.mjs';
import { deletionFixture } from '../support/deletion-fixture.mjs';
import { setTimeout as delay } from 'node:timers/promises';

async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const config = readConfig('api'), db = new MysqlDatabase(config), admin = await createConnection(process.env.TEST_ADMIN_URL);
  t.after(async () => { await admin.rollback(); await admin.end(); await db.close(); });
  const user = await db.transactions.write(tx => createUser(tx, 'Synthetic restore fence'));
  const { ledger } = deletionFixture();
  const receipt = await ledger.ensureIntent({ schemaVersion: 3, environment: 'qa', requestId: randomUUID(), actorUserId: user,
    targetId: user, scope: 'ACCOUNT', roomId: null, requestedAt: new Date().toISOString(), subjectGuards: [] });
  const name = `restore:${randomBytes(24).toString('hex')}`;
  const [[lease]] = await admin.query('SELECT GET_LOCK(?,0) AS acquired, CONNECTION_ID() AS owner, @@server_uuid AS serverUuid', [name]);
  assert.equal(lease.acquired, 1);
  let entered;
  const blocking = new Promise(resolve => { entered = resolve; });
  const accounts = new AccountDeletionRepository(), block = accounts.block.bind(accounts);
  accounts.block = async (...args) => { entered(); return block(...args); };
  const fence = new RestoreGateRepository(), apply = new DeletionApplyService(db.transactions, {}, new DeletionRepository(), accounts, new IdentityGuardService(new IdentityGuardRepository()));
  const held = () => ({ mysqlLeaseName: name, mysqlLeaseOwner: lease.owner, mysqlServerUuid: lease.serverUuid, expiresAt: Math.floor(Date.now() / 1000) + 5 });
  const guarded = operation => { const proof = held(); return db.transactions.write(async tx => {
    await fence.fence(tx, config.database.name, proof); const result = await operation(tx);
    await fence.fence(tx, config.database.name, proof); return result;
  }); };
  const release = () => admin.query('SELECT RELEASE_LOCK(?)', [name]);
  return { db, admin, user, receipt, apply, guarded, release, blocking };
}

test('restore apply rolls back domain and receipt when custody is lost during actual row-lock wait', async t => {
  const f = await fixture(t);
  await f.admin.beginTransaction(); await f.admin.query('SELECT id FROM users WHERE id=? FOR UPDATE', [f.user]);
  let settled = false;
  const pending = f.guarded(tx => f.apply.restoreApply(tx, f.receipt)).then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
  let result;
  try {
    await Promise.race([f.blocking, delay(1500).then(() => { throw new Error('domain_not_entered'); })]);
    await delay(100); assert.equal(settled, false); // Actual account lock remains held by admin.
    await f.release(); await f.admin.commit(); result = await pending;
  } finally { await f.admin.rollback(); await pending; }
  assert.match(result.error?.message ?? '', /restore_gate_rejected/);
  const state = await f.db.transactions.read(async tx => ({
    user: await tx.prisma.users.findUnique({ where: { id: f.user }, select: { status: true } }),
    receipt: await tx.prisma.deletion_intents.count({ where: { request_id: f.receipt.intent.requestId } }),
    obligation: await tx.prisma.account_deletion_obligations.count({ where: { user_id: f.user } }),
  }));
  assert.equal(state.user.status, 'ACTIVE'); assert.equal(state.receipt, 0); assert.equal(state.obligation, 0);
});

test('restore binding scrub does not commit another page after custody release', async t => {
  const f = await fixture(t);
  assert.equal((await f.guarded(tx => f.apply.restoreApply(tx, f.receipt))).status, 'blocked');
  await f.db.transactions.write(tx => tx.prisma.auth_sessions.createMany({ data: Array.from({ length: 101 }, () => ({
    id: randomUUID(), user_id: f.user, token_digest: randomBytes(32), csrf_digest: randomBytes(32), audience: 'rogi-test',
    expires_at: new Date(Date.now() + 60000),
  })) }));
  assert.equal((await f.guarded(tx => f.apply.restoreScrubBindings(tx, f.receipt))).status, 'remaining');
  const remaining = () => f.db.transactions.read(tx => tx.prisma.auth_sessions.count({ where: { user_id: f.user, revoked_at: null } }));
  assert.equal(await remaining(), 1);
  await f.release(); await assert.rejects(f.guarded(tx => f.apply.restoreScrubBindings(tx, f.receipt)), /restore_gate_rejected/);
  assert.equal(await remaining(), 1);
});

test('a carried prior restore checkpoint permits a fresh target name and retains old nonce history', async t => {
  const f = await fixture(t), repository = new RestoreGateRepository();
  const authorization = { authorizationEpoch: randomUUID(), authorizationKeySha256: 'a'.repeat(64), storageScopeSha256: 'b'.repeat(64), storageFenceId: 'c'.repeat(64) };
  const prior = { environment: 'qa', sourceCommit: 'd'.repeat(40), schemaSha256: 'e'.repeat(64), restoreRunId: randomUUID(),
    snapshotSha256: 'f'.repeat(64), targetId: `rogichat_test_${randomBytes(8).toString('hex')}`, ledgerSourceId: '0'.repeat(64) };
  // Simulate a checkpoint carried by a snapshot; no nonce history is removed.
  const proof = { sha256: '1'.repeat(64), issuer: '2'.repeat(64) }, digest = '3'.repeat(64), nonce = randomBytes(16).toString('hex');
  await f.db.transactions.write(async tx => {
    await repository.begin(tx, prior, proof, authorization);
    await repository.observed(tx, prior.restoreRunId, digest);
    await repository.consume(tx, prior.restoreRunId, digest, nonce, '4'.repeat(64));
  });
  await assert.rejects(f.db.transactions.write(tx => repository.begin(tx, { ...prior, restoreRunId: randomUUID() }, proof, authorization)), /restore_gate_rejected/);
  const next = { ...prior, restoreRunId: randomUUID(), targetId: readConfig('api').database.name };
  assert.equal((await f.db.transactions.write(tx => repository.begin(tx, next, proof, authorization))).phase, 'NEW');
  const carried = await f.db.transactions.read(tx => tx.prisma.restore_gate_checkpoints.findUnique({ where: { run_id: prior.restoreRunId }, select: { phase: true, release_nonce: true } }));
  assert.deepEqual(carried, { phase: 'RELEASE_AUTHORIZED', release_nonce: nonce });
});
