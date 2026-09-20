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
    @Inject(DeletionRepository) private readonly repository: DeletionRepository) {}
  apply(receipt: DeletionReceipt) {
    const intent = checkedDeletionIntent(receipt.intent, receipt.intent.environment);
    if (createHash('sha256').update(encodeDeletionIntent(intent)).digest('hex') !== receipt.sha256 || intent.scope !== 'MESSAGE') throw new Error('invalid_deletion_receipt');
    return this.transactions.write(async tx => {
      const checkpoint = await this.repository.checkpoint(tx, receipt);
      const blocked = await this.messages.remove(tx, intent);
      // Null is an unresolved obligation, not evidence of purge or restore safety.
      await this.repository.markBlocked(tx, intent.requestId, blocked ? checkpoint.blocked_at ?? await tx.now() : null);
      return { requestId: intent.requestId, status: blocked ? 'blocked' as const : 'pending' as const };
    });
  }
}
