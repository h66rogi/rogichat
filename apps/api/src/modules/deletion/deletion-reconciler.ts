import type { Transactions } from '../../infrastructure/database/transactions.js';
import { DeletionLedgerError } from './deletion-ledger.js';
import type { DeletionLedger } from './deletion-ledger.js';
import type { DeletionApplyService } from './deletion-apply.service.js';
import type { DeletionReplayRepository } from './deletion-replay.repository.js';
import { ReplayFenceError } from './deletion-replay.types.js';
import type { ReplayCounts, ReplayFailure } from './deletion-replay.types.js';

/** Durable discovery and independently scheduled receipt execution. No restore authority. */
export class DeletionReconciler {
  private running = false;
  constructor(private readonly ledger: DeletionLedger, private readonly apply: DeletionApplyService,
    private readonly transactions: Transactions, private readonly repository: DeletionReplayRepository) {}
  async tick(signal?: AbortSignal): Promise<ReplayCounts | undefined> {
    if (this.running) return;
    this.running = true;
    const discoverySignal = AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]);
    const result: ReplayCounts = { discovered: 0, invalid: 0, attempted: 0, applied: 0, pending: 0, failed: 0,
      inventoryPassEnded: false, discoveryFailed: false };
    try {
      signal?.throwIfAborted();
      // There is no environment-only fallback: changing storage cannot replay old-source work.
      const source = { sourceId: this.ledger.sourceId, environment: this.ledger.environment };

      let discovery;
      try {
        discovery = await this.transactions.write(tx => { discoverySignal.throwIfAborted(); return this.repository.claimDiscovery(tx, source); });
        if (discovery) {
          discoverySignal.throwIfAborted();
          const page = await this.ledger.discover(discovery.cursor, 50, discoverySignal);
          discoverySignal.throwIfAborted();
          const registration = await this.transactions.write(tx => { discoverySignal.throwIfAborted(); return this.repository.registerPage(tx, discovery!, page); });
          result.invalid = registration.invalid;
          result.discovered = page.items.length;
          result.inventoryPassEnded = page.cursor === null;
        }
      } catch (error) {
        result.discoveryFailed = true;
        if (discovery) {
          // Journal failure must not prevent independently registered work from being attempted.
          try { await this.transactions.write(tx => this.repository.failDiscovery(tx, discovery!,
            error instanceof DeletionLedgerError && error.code === 'INVALID_LEDGER_INTENT' ? 'INVENTORY_INVALID' : 'UNAVAILABLE')); }
          catch { /* Fixed per-tick result remains failed; never advance a local cursor. */ }
        }
      }
      // Reserved execution admission budget starts after discovery drains, even on journal failure.
      // In-flight DB work can extend wall duration; never detach it to start another tick.
      const bounded = AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]);
      for (let attempt = 0; attempt < 4 && !bounded.aborted; attempt++) {
        const claim = await this.transactions.write(tx => { bounded.throwIfAborted(); return this.repository.claimEntry(tx, source); });
        if (!claim) break;
        result.attempted++;
        try {
          bounded.throwIfAborted();
          const receipt = await this.ledger.readByKey(claim.key, bounded);
          bounded.throwIfAborted();
          await this.transactions.write(tx => { bounded.throwIfAborted(); return this.repository.pinReceipt(tx, claim, receipt.sha256); });
          bounded.throwIfAborted();
          const status = await this.apply.replay(receipt, claim, this.repository, bounded);
          if (status === 'observed') result.applied++; else result.pending++;
        } catch (error) {
          result.failed++;
          if (error instanceof ReplayFenceError) continue;
          const code: ReplayFailure = error instanceof DeletionLedgerError
            ? error.code === 'LEDGER_CONFLICT' ? 'RECEIPT_CONFLICT'
              : error.code === 'INVALID_LEDGER_INTENT' ? 'INVALID_RECEIPT' : 'UNAVAILABLE'
            : error instanceof Error && error.message === 'deletion_replay_receipt_conflict' ? 'RECEIPT_CONFLICT'
              : claim.phase === 'SCRUB' ? 'SCRUB_FAILED' : 'APPLY_FAILED';
          try { await this.transactions.write(tx => this.repository.failEntry(tx, claim, code)); }
          catch { /* Unacknowledged work remains claimed until expiry; no success inference. */ }
        }
      }
      return result;
    } finally { this.running = false; }
  }
}
