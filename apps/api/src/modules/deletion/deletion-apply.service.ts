import { AccountDeletionRepository } from './account-deletion.repository.js';
import { IdentityGuardService } from '../auth/identity-guard.service.js';
import { DeletionRepository } from './deletion.repository.js';
import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { DeletionReplayRepository } from './deletion-replay.repository.js';
import type { ReplayClaim } from './deletion-replay.types.js';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { MessagesCoreService } from '../messages/messages-core.service.js';
import { checkedDeletionIntent, encodeDeletionIntent, deletionIntentKey } from './deletion-ledger.js';
import type { DeletionReceipt } from './deletion-ledger.js';
import { createHash } from 'node:crypto';

/** Internal receipt-only port. Never exported through an HTTP controller. */
@Injectable()
export class DeletionApplyService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(MessagesCoreService) private readonly messages: MessagesCoreService,
    @Inject(DeletionRepository) private readonly repository: DeletionRepository,
    @Inject(AccountDeletionRepository) private readonly accounts: AccountDeletionRepository,
    @Inject(IdentityGuardService) private readonly guards: IdentityGuardService) {}
  apply(receipt: DeletionReceipt) {
    const intent = checkedDeletionIntent(receipt.intent, receipt.intent.environment);
    if (createHash('sha256').update(encodeDeletionIntent(intent)).digest('hex') !== receipt.sha256) throw new Error('invalid_deletion_receipt');
    return this.transactions.write(tx => this.applyInTransaction(tx, { intent, sha256: receipt.sha256 }));
  }
  /** Operator restore seam: caller owns one transaction with custody checks before
   * and after this call. Never acquires a second connection or performs I/O. */
  restoreApply(tx: Transaction, receipt: DeletionReceipt) {
    if (!tx.writable) throw new Error('transaction_not_writable');
    const intent = checkedDeletionIntent(receipt.intent, receipt.intent.environment);
    if (createHash('sha256').update(encodeDeletionIntent(intent)).digest('hex') !== receipt.sha256) throw new Error('invalid_deletion_receipt');
    return this.applyInTransaction(tx, { intent, sha256: receipt.sha256 });
  }
  restoreScrubBindings(tx: Transaction, receipt: DeletionReceipt) {
    if (!tx.writable) throw new Error('transaction_not_writable');
    const intent = checkedDeletionIntent(receipt.intent, receipt.intent.environment);
    if (intent.scope !== 'ACCOUNT' || createHash('sha256').update(encodeDeletionIntent(intent)).digest('hex') !== receipt.sha256) throw new Error('invalid_deletion_receipt');
    return this.accounts.scrubBindings(tx, intent.targetId);
  }
  private async applyInTransaction(tx: Transaction, receipt: DeletionReceipt) {
    const intent = receipt.intent;
    const checkpoint = await this.repository.checkpoint(tx, receipt);
    if (intent.scope === 'ACCOUNT') await this.guards.block(tx, intent);
    const applied = intent.scope === 'ACCOUNT' ? await this.accounts.block(tx, intent) : await this.messages.remove(tx, intent);
    // A MESSAGE root may have been physically purged. Retain the original
    // verified block checkpoint; absence neither undoes it nor proves purge.
    const blocked = applied || (intent.scope === 'MESSAGE' && checkpoint.blocked_at !== null &&
      !await this.repository.messageExists(tx, intent.roomId!, intent.targetId));
    // Null is an unresolved obligation, not evidence of purge or restore safety.
    await this.repository.markBlocked(tx, intent.requestId, blocked ? checkpoint.blocked_at ?? await tx.now() : null);
    return { requestId: intent.requestId, status: blocked ? 'blocked' as const : 'pending' as const };
  }
  /** Worker-internal fenced transaction. No domain transaction spans external ledger I/O. */
  replay(receipt: DeletionReceipt, claim: ReplayClaim, replay: DeletionReplayRepository, signal: AbortSignal) {
    const intent = checkedDeletionIntent(receipt.intent, claim.environment);
    if (deletionIntentKey(claim.environment, intent.requestId) !== claim.key ||
        createHash('sha256').update(encodeDeletionIntent(intent)).digest('hex') !== receipt.sha256) throw new Error('invalid_deletion_receipt');
    return this.transactions.write(async tx => {
      signal.throwIfAborted();
      await replay.fence(tx, claim, receipt.sha256);
      signal.throwIfAborted();
      let status: 'observed' | 'pending' | 'scrub' | 'reapply';
      if (claim.phase === 'SCRUB') {
        if (intent.scope !== 'ACCOUNT') throw new Error('invalid_deletion_replay_phase');
        // Do not lock account/guard before login rows: callbacks lock in the opposite order.
        const progress = await this.accounts.scrubBindings(tx, intent.targetId);
        status = progress.status === 'reapply' ? 'reapply' : progress.status === 'remaining' ? 'pending' : 'observed';
      } else {
        const applied = await this.applyInTransaction(tx, { intent, sha256: receipt.sha256 });
        status = applied.status === 'pending' ? 'pending' : intent.scope === 'ACCOUNT' ? 'scrub' : 'observed';
      }
      // Fresh DB time after all domain waits; expired completion rolls back the entire mutation.
      await replay.finish(tx, claim, receipt.sha256, status);
      return status;
    });
  }
  async scrubBindings(receipt: DeletionReceipt) {
    if (receipt.intent.scope === 'ACCOUNT') return this.transactions.write(tx => this.accounts.scrubBindings(tx, receipt.intent.targetId));
  }
}
