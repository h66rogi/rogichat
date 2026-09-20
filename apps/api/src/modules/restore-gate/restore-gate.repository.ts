import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { canonical, restoreRejected, sha256 } from './restore-proof.js';
import { deletionIntentKey } from '../deletion/deletion-ledger.js';
import type { LedgerEnvironment } from '../deletion/deletion-ledger.js';
import type { RestoreScope, VerifiedProof, BoundaryPayload } from './restore-proof.js';

export interface RestoreAuthorizationBinding {
  authorizationEpoch: string;
  authorizationKeySha256: string;
  storageScopeSha256: string;
  storageFenceId: string;
  mysqlServerUuid: string;
}
const targetIdentity = (databaseName: string, mysqlServerUuid: string) =>
  sha256('rogichat:restore-target:v1:' + canonical({ version: 1, databaseName, mysqlServerUuid }));
@Injectable()
export class RestoreGateRepository {
  async begin(tx: Transaction, scope: RestoreScope, boundary: VerifiedProof<BoundaryPayload>, authorization: RestoreAuthorizationBinding) {
    await tx.prisma.restore_gate_checkpoints.createMany({ data: [{
      run_id: scope.restoreRunId, target_id: targetIdentity(scope.targetId, authorization.mysqlServerUuid), context_sha256: sha256(canonical({ scope, ...authorization })),
      boundary_sha256: boundary.sha256, boundary_issuer: boundary.issuer, epoch: authorization.authorizationEpoch,
    }], skipDuplicates: true });
    return this.lock(tx, scope, boundary, authorization);
  }
  serialize(tx: Transaction, runId: string) {
    // Locking read does not establish an InnoDB consistent snapshot. Final media
    // bind follows this lock, before the first ordinary Prisma read.
    return tx.rows('SELECT run_id FROM restore_gate_checkpoints WHERE run_id=? FOR UPDATE', [runId]);
  }
  async lock(tx: Transaction, scope: RestoreScope, boundary: VerifiedProof<BoundaryPayload>, authorization: RestoreAuthorizationBinding) {
    // One exact current-row lock serializes restore stages and release receipt CAS.
    // Domain/API serving remains externally fenced throughout these operations.
    await this.serialize(tx, scope.restoreRunId);
    const row = await tx.prisma.restore_gate_checkpoints.findUnique({ where: { run_id: scope.restoreRunId }, select: {
      run_id: true, target_id: true, context_sha256: true, boundary_sha256: true, boundary_issuer: true,
      epoch: true, phase: true, provider_phase: true, provider_after_id: true, observation_sha256: true, release_nonce: true, release_sha256: true,
    } });
    if (!row || row.target_id !== targetIdentity(scope.targetId, authorization.mysqlServerUuid) || row.context_sha256 !== sha256(canonical({ scope, ...authorization })) ||
        row.boundary_sha256 !== boundary.sha256 || row.boundary_issuer !== boundary.issuer) return restoreRejected();
    return row;
  }
  async fence(tx: Transaction, targetId: string, held: { mysqlLeaseName: string; mysqlLeaseOwner: number; mysqlServerUuid: string; expiresAt: number }) {
    // Current server-level custody read inside the same domain/CAS transaction.
    const [row] = await tx.rows<{ owner: string | number | null; serverUuid: string; databaseName: string }>('SELECT IS_USED_LOCK(?) AS owner, @@server_uuid AS serverUuid, DATABASE() AS databaseName', [held.mysqlLeaseName]);
    if (!row || row.databaseName !== targetId || Number(row.owner) !== held.mysqlLeaseOwner || row.serverUuid !== held.mysqlServerUuid ||
        (await tx.now()).getTime() >= held.expiresAt * 1000) restoreRejected();
  }
  async quarantine(tx: Transaction, runId: string) {
    const now = await tx.now();
    await tx.prisma.auth_sessions.updateMany({ data: { revoked_at: now } });
    await tx.prisma.login_transactions.updateMany({ data: { status: 'FAILED', expires_at: now,
      launch_payload: null, identity_payload: null, completion_digest: null, completion_expires: null,
      launch_digest: null, launch_expires: null, session_id: null, user_id: null } });
    await tx.prisma.apple_auth_transactions.updateMany({ data: { status: 'FAILED', expires_at: now,
      proof: null, completion_digest: null, completion_expires: null, session_id: null, user_id: null } });
    // Preserve provider token revocation obligations. No guessed provider status transition.
    await tx.prisma.push_subscriptions.updateMany({ data: { revoked_at: now, generation: { increment: 1n } } });
    await tx.prisma.rooms.updateMany({ data: { owner_member_id: null, content_epoch: { increment: 1n }, policy_version: { increment: 1 } } });
    await tx.prisma.room_members.updateMany({ data: { role: 'FAN', status: 'BANNED', active_period_id: null, acl_epoch: { increment: 1n } } });
    await tx.prisma.membership_periods.updateMany({ where: { left_at: null }, data: { left_at: now } });
    await tx.prisma.stream_grants.updateMany({ data: { can_read: false, can_send: false, revoked_at: now } });
    await tx.prisma.users.updateMany({ data: { membership_generation: { increment: 1n } } });
    await tx.prisma.admin_capabilities.updateMany({ data: { manage_rooms: false, manage_users: false, manage_stickers: false } });
    await tx.prisma.creator_accounts.updateMany({ data: { enabled: false } });
    await tx.prisma.user_profiles.updateMany({ data: { birthday_visible_to_streamers: false, revision: { increment: 1n } } });
    await tx.prisma.restore_gate_checkpoints.update({ where: { run_id: runId }, data: { phase: 'QUARANTINED', quarantined_at: now }, select: { run_id: true } });
  }
  async observation(tx: Transaction) {
    const violations = {
      sessions: await tx.prisma.auth_sessions.count({ where: { revoked_at: null } }),
      loginTransactions: await tx.prisma.login_transactions.count({ where: { status: { not: 'FAILED' } } }),
      appleTransactions: await tx.prisma.apple_auth_transactions.count({ where: { status: { not: 'FAILED' } } }),
      pushBindings: await tx.prisma.push_subscriptions.count({ where: { revoked_at: null } }),
      members: await tx.prisma.room_members.count({ where: { OR: [{ status: { not: 'BANNED' } }, { active_period_id: { not: null } }, { role: { not: 'FAN' } }] } }),
      periods: await tx.prisma.membership_periods.count({ where: { left_at: null } }),
      owners: await tx.prisma.rooms.count({ where: { owner_member_id: { not: null } } }),
      grants: await tx.prisma.stream_grants.count({ where: { OR: [{ can_read: true }, { can_send: true }, { revoked_at: null }] } }),
      admins: await tx.prisma.admin_capabilities.count({ where: { OR: [{ manage_rooms: true }, { manage_users: true }, { manage_stickers: true }] } }),
      creators: await tx.prisma.creator_accounts.count({ where: { enabled: true } }),
      birthdays: await tx.prisma.user_profiles.count({ where: { birthday_visible_to_streamers: true } }),
      unappliedDeletion: await tx.prisma.deletion_intents.count({ where: { blocked_at: null } }),
      uncoveredAccounts: await tx.prisma.account_deletion_obligations.count({ where: { guard_coverage: false } }),
    };
    // Hash actual generation identities, not max/count aggregates that can miss drift.
    // Bounds reject oversized targets rather than silently omitting safety state.
    const take = 10001;
    const generations = {
      users: await tx.prisma.users.findMany({ take, orderBy: { id: 'asc' }, select: { id: true, status: true, membership_generation: true } }),
      rooms: await tx.prisma.rooms.findMany({ take, orderBy: { id: 'asc' }, select: { id: true, content_epoch: true, policy_version: true } }),
      members: await tx.prisma.room_members.findMany({ take, orderBy: { id: 'asc' }, select: { id: true, acl_epoch: true } }),
      profiles: await tx.prisma.user_profiles.findMany({ take, orderBy: { user_id: 'asc' }, select: { user_id: true, revision: true } }),
      sessions: await tx.prisma.auth_sessions.findMany({ take, orderBy: { id: 'asc' }, select: { id: true, revoked_at: true } }),
      receipts: await tx.prisma.deletion_intents.findMany({ take, orderBy: { request_id: 'asc' }, select: { request_id: true, environment: true, ledger_sha256: true, blocked_at: true } }),
    };
    if (Object.values(generations).some(rows => rows.length >= take)) return restoreRejected();
    const normalized: unknown = JSON.parse(JSON.stringify(generations, (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value instanceof Uint8Array ? Buffer.from(value).toString('hex') : value));
    const receiptManifest = generations.receipts.map(row => ({ key: deletionIntentKey(row.environment as LedgerEnvironment, row.request_id), sha256: Buffer.from(row.ledger_sha256).toString('hex') })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    return { violations, receiptManifestSha256: sha256(canonical(receiptManifest)), generationSha256: sha256(canonical(normalized)) };
  }
  async observed(tx: Transaction, runId: string, digest: string) {
    return tx.prisma.restore_gate_checkpoints.update({ where: { run_id: runId }, data: { phase: 'OBSERVED', observation_sha256: digest }, select: { run_id: true } });
  }
  async consume(tx: Transaction, runId: string, digest: string, nonce: string, proofSha: string) {
    const changed = await tx.prisma.restore_gate_checkpoints.updateMany({ where: { run_id: runId, phase: 'OBSERVED', observation_sha256: digest, release_nonce: null },
      data: { phase: 'RELEASE_AUTHORIZED', release_nonce: nonce, release_sha256: proofSha, consumed_at: await tx.now() } });
    if (changed.count !== 1) restoreRejected();
  }
}
