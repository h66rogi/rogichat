import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { DATABASE } from '../../infrastructure/database/database.tokens.js';
import type { Database } from '../../infrastructure/database/database.js';
import { migrationManifest } from '../../infrastructure/database/schema-manifest.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { authorizationKeyFingerprint } from '../../infrastructure/config/authorization-epoch.js';
import { RestoreMediaService } from '../media/restore-media.service.js';
import { AppleLifecycleService } from '../auth/apple/apple-lifecycle.service.js';
import type { AppleRestorePhase } from '../auth/apple/apple-restore.js';
import { DeletionLedger } from '../deletion/deletion-ledger.js';
import { DeletionApplyService } from '../deletion/deletion-apply.service.js';
import { RestoreGateRepository } from './restore-gate.repository.js';
import { RestoreIsolationClient } from './restore-isolation.client.js';
import { RestoreProofVerifier, canonical, checkedScope, restoreRejected, sha256 } from './restore-proof.js';
import type { RestoreScope, VerifiedProof, BoundaryPayload } from './restore-proof.js';
export const RESTORE_SETTINGS = Symbol('RESTORE_SETTINGS');
export interface RestoreSettings {
  scope: RestoreScope;
  auth: AuthConfig;
  verifier: RestoreProofVerifier;
  isolation: RestoreIsolationClient;
}
export const restoreSchemaSha256 = (): string => sha256(canonical(migrationManifest));

@Injectable()
export class RestoreGateService {
  private readonly authorization: { authorizationEpoch: string; authorizationKeySha256: string };
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(DATABASE) private readonly database: Database,
    @Inject(RestoreGateRepository) private readonly repository: RestoreGateRepository,
    @Inject(DeletionLedger) private readonly ledger: DeletionLedger,
    @Inject(DeletionApplyService) private readonly deletion: DeletionApplyService,
    @Inject(AppleLifecycleService) private readonly apple: AppleLifecycleService,
    @Inject(RestoreMediaService) private readonly media: RestoreMediaService,
    @Inject(RESTORE_SETTINGS) private readonly settings: RestoreSettings) {
    checkedScope(settings.scope);
    if (!settings.auth.authorizationEpoch || settings.scope.schemaSha256 !== restoreSchemaSha256()) restoreRejected();
    this.authorization = { authorizationEpoch: settings.auth.authorizationEpoch!, authorizationKeySha256: authorizationKeyFingerprint(settings.auth) };
  }
  private clock() { return this.transactions.read(async tx => Math.floor((await tx.now()).getTime() / 1000)); }
  private async boundary(envelope: unknown) {
    if (!(await this.database.check()).ready || this.ledger.environment !== this.settings.scope.environment || this.ledger.sourceId !== this.settings.scope.ledgerSourceId) restoreRejected();
    return this.settings.verifier.boundary(envelope, this.settings.scope, await this.clock());
  }
  private async held(boundary: VerifiedProof<BoundaryPayload>) {
    if (await this.clock() >= boundary.payload.expiresAt) restoreRejected();
    const held = await this.settings.isolation.assertHeld(this.settings.scope, boundary);
    if (held.authorizationEpoch !== this.authorization.authorizationEpoch || held.authorizationKeySha256 !== this.authorization.authorizationKeySha256) restoreRejected();
    return held;
  }
  private binding(held: Awaited<ReturnType<RestoreIsolationClient['assertHeld']>>) {
    return { ...this.authorization, storageScopeSha256: held.storageScopeSha256, storageFenceId: held.storageFenceId };
  }
  private sameCustody(before: Awaited<ReturnType<RestoreIsolationClient['assertHeld']>>, after: Awaited<ReturnType<RestoreIsolationClient['assertHeld']>>) {
    if (canonical(this.binding(before)) !== canonical(this.binding(after)) || before.mysqlLeaseName !== after.mysqlLeaseName ||
        before.mysqlLeaseOwner !== after.mysqlLeaseOwner || before.mysqlServerUuid !== after.mysqlServerUuid) restoreRejected();
  }
  private async mediaObservation(boundary: VerifiedProof<BoundaryPayload>) {
    const before = await this.held(boundary);
    const media = await this.media.reconcile(AbortSignal.timeout(300000));
    const held = await this.held(boundary);
    this.sameCustody(before, held);
    if (media.storageScopeSha256 !== held.storageScopeSha256) restoreRejected();
    return { media, held };
  }
  private async receipts(boundary: VerifiedProof<BoundaryPayload>) {
    const keys = new Set<string>(), cursors = new Set<string>(); let cursor: string | null = null;
    do {
      const page = await this.ledger.discover(cursor, 100);
      for (const item of page.items) {
        if (item.classification !== 'VALID' || !item.key || keys.has(item.key)) restoreRejected();
        keys.add(item.key!);
      }
      cursor = page.cursor;
      if (keys.size > 10000 || (cursor && cursors.has(cursor))) restoreRejected();
      if (cursor) cursors.add(cursor);
    } while (cursor);
    if (canonical([...keys].sort()) !== canonical(boundary.payload.inventory.map(item => item.key))) restoreRejected();
    const receipts = [];
    for (const item of boundary.payload.inventory) {
      const receipt = await this.ledger.readByKey(item.key);
      if (receipt.sha256 !== item.sha256) restoreRejected();
      receipts.push(receipt);
    }
    return receipts;
  }
  private async restoreMutation<T>(boundary: VerifiedProof<BoundaryPayload>, operation: (tx: Transaction) => Promise<T>) {
    const held = await this.held(boundary);
    return this.transactions.write(async tx => {
      await this.repository.fence(tx, this.settings.scope.targetId, held);
      const row = await this.repository.lock(tx, this.settings.scope, boundary, this.binding(held));
      if (!['QUARANTINED', 'OBSERVED'].includes(row.phase)) restoreRejected();
      const result = await operation(tx);
      await this.repository.fence(tx, this.settings.scope.targetId, held);
      return result;
    });
  }
  async prepare(envelope: unknown) {
    const boundary = await this.boundary(envelope);
    const receipts = await this.receipts(boundary); // Verify complete independent inventory before mutating.
    let held = await this.held(boundary);
    await this.transactions.write(async tx => {
      await this.repository.fence(tx, this.settings.scope.targetId, held);
      const row = await this.repository.begin(tx, this.settings.scope, boundary, this.binding(held));
      if (row.phase === 'RELEASE_AUTHORIZED') restoreRejected();
      if (row.phase === 'NEW') await this.repository.quarantine(tx, row.run_id);
      await this.repository.fence(tx, this.settings.scope.targetId, held);
    });
    for (let page = 0; ; page++) {
      if (page > 1000) restoreRejected();
      held = await this.held(boundary);
      const done = await this.transactions.write(async tx => {
        await this.repository.fence(tx, this.settings.scope.targetId, held);
        const row = await this.repository.lock(tx, this.settings.scope, boundary, this.binding(held));
        if (row.phase === 'RELEASE_AUTHORIZED') restoreRejected();
        if (row.provider_phase === 'complete') return true;
        if (!['identities', 'transactions', 'credentials'].includes(row.provider_phase)) return restoreRejected();
        const result = await this.apple.quarantineRestored(tx, { phase: row.provider_phase as AppleRestorePhase, afterId: row.provider_after_id, limit: 100 });
        const next = result.hasMore ? row.provider_phase : row.provider_phase === 'identities' ? 'transactions' : row.provider_phase === 'transactions' ? 'credentials' : 'complete';
        await tx.prisma.restore_gate_checkpoints.update({ where: { run_id: row.run_id }, data: { provider_phase: next, provider_after_id: result.hasMore ? result.lastId : null }, select: { run_id: true } });
        await this.repository.fence(tx, this.settings.scope.targetId, held);
        return next === 'complete';
      });
      if (done) break;
    }
    for (const receipt of receipts) {
      await this.held(boundary);
      if ((await this.restoreMutation(boundary, tx => this.deletion.restoreApply(tx, receipt))).status !== 'blocked') restoreRejected();
      for (let page = 0; receipt.intent.scope === 'ACCOUNT'; page++) {
        if (page > 1000) restoreRejected();
        const result = await this.restoreMutation(boundary, tx => this.deletion.restoreScrubBindings(tx, receipt));
        if (result?.status === 'observed') break;
        if (result?.status === 'reapply' && (await this.restoreMutation(boundary, tx => this.deletion.restoreApply(tx, receipt))).status !== 'blocked') restoreRejected();
      }
      await this.held(boundary);
    }
    return this.observe(envelope);
  }
  async observe(envelope: unknown) {
    const boundary = await this.boundary(envelope);
    await this.receipts(boundary);
    const { media, held } = await this.mediaObservation(boundary);
    const report = await this.transactions.write(async tx => {
      await this.repository.fence(tx, this.settings.scope.targetId, held);
      await this.repository.serialize(tx, this.settings.scope.restoreRunId);
      const mediaBound = await this.media.bind(tx, media);
      const row = await this.repository.lock(tx, this.settings.scope, boundary, this.binding(held));
      if (!['QUARANTINED', 'OBSERVED', 'RELEASE_AUTHORIZED'].includes(row.phase) || row.provider_phase !== 'complete') restoreRejected();
      const state = await this.repository.observation(tx), apple = await this.apple.restoredQuarantineReadiness(tx);
      const observation = { version: 1, scope: this.settings.scope, boundarySha256: boundary.sha256, ...this.binding(held),
        ...state, apple, media, mediaBound, epoch: row.epoch };
      const observationSha256 = sha256(canonical(observation));
      const ready = media.status === 'verified' && mediaBound && state.receiptManifestSha256 === sha256(canonical(boundary.payload.inventory)) && Object.values(state.violations).every(value => value === 0) && apple.quarantined;
      if (ready && row.phase !== 'RELEASE_AUTHORIZED') await this.repository.observed(tx, row.run_id, observationSha256);
      await this.repository.fence(tx, this.settings.scope.targetId, held);
      return { ...observation, observationSha256, ready, servingAuthorized: false, releaseReceiptSha256: row.release_sha256 };
    });
    this.sameCustody(held, await this.held(boundary));
    return report;
  }
  async consume(envelope: unknown, releaseEnvelope: unknown) {
    const boundary = await this.boundary(envelope), release = this.settings.verifier.release(releaseEnvelope, this.settings.scope, await this.clock());
    if (release.payload.boundarySha256 !== boundary.sha256) restoreRejected();
    await this.receipts(boundary);
    const { media, held } = await this.mediaObservation(boundary);
    await this.transactions.write(async tx => {
      await this.repository.fence(tx, this.settings.scope.targetId, held);
      await this.repository.serialize(tx, this.settings.scope.restoreRunId);
      const mediaBound = await this.media.bind(tx, media);
      const row = await this.repository.lock(tx, this.settings.scope, boundary, this.binding(held));
      if (row.phase !== 'OBSERVED' || row.provider_phase !== 'complete') restoreRejected();
      const state = await this.repository.observation(tx), apple = await this.apple.restoredQuarantineReadiness(tx);
      const observation = { version: 1, scope: this.settings.scope, boundarySha256: boundary.sha256, ...this.binding(held),
        ...state, apple, media, mediaBound, epoch: row.epoch };
      const digest = sha256(canonical(observation));
      if (media.status !== 'verified' || !mediaBound || state.receiptManifestSha256 !== sha256(canonical(boundary.payload.inventory)) || Object.values(state.violations).some(value => value !== 0) || !apple.quarantined ||
          digest !== row.observation_sha256 || digest !== release.payload.observationSha256 ||
          (await tx.now()).getTime() >= release.payload.expiresAt * 1000) restoreRejected();
      await this.repository.consume(tx, row.run_id, digest, release.payload.nonce, release.sha256);
      await this.repository.fence(tx, this.settings.scope.targetId, held);
    });
    this.sameCustody(held, await this.held(boundary)); // Lost custody after COMMIT is failure; never an activation instruction.
    return { phase: 'RELEASE_AUTHORIZED', receiptSha256: release.sha256, servingAuthorized: false };
  }
}
