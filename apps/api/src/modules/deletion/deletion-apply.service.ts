import { AccountDeletionRepository } from './account-deletion.repository.js';
import { IdentityGuardService } from '../auth/identity-guard.service.js';
import { DeletionRepository } from './deletion.repository.js';
import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { MessagesCoreService } from '../messages/messages-core.service.js';
import { checkedDeletionIntent, encodeDeletionIntent } from './deletion-ledger.js';
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
    return this.transactions.write(async tx => {
      const checkpoint = await this.repository.checkpoint(tx, receipt);
      if (intent.scope === 'ACCOUNT') await this.guards.block(tx, intent);
      const blocked = intent.scope === 'ACCOUNT' ? await this.accounts.block(tx, intent) : await this.messages.remove(tx, intent);
      // Null is an unresolved obligation, not evidence of purge or restore safety.
      await this.repository.markBlocked(tx, intent.requestId, blocked ? checkpoint.blocked_at ?? await tx.now() : null);
      return { requestId: intent.requestId, status: blocked ? 'blocked' as const : 'pending' as const };
    });
  }
  async scrubBindings(receipt: DeletionReceipt) {
    if (receipt.intent.scope === 'ACCOUNT') await this.transactions.write(tx => this.accounts.scrubBindings(tx, receipt.intent.targetId));
  }
}
