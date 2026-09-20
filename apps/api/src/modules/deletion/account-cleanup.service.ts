import { AccountContentService } from './account-content.service.js';
import { AccountMediaService } from '../media/account-media.service.js';
import type { DeletionReceipt } from './deletion-ledger.js';
import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { NotificationsCoreService } from '../notifications/notifications-core.service.js';
import { ReadStateCoreService } from '../read-state/read-state-core.service.js';
import { AccountCleanupRepository } from './account-cleanup.repository.js';
import { DeletionLedger, deletionIntentKey } from './deletion-ledger.js';

export type AccountCleanupPhase = 'private-fields' | 'read-state' | 'membership' | 'reactions' | 'grants' | 'periods' | 'push' | 'sessions' | 'profile-changes' | 'content' | 'media' | 'subset-drained';
export interface AccountCleanupResult { phase: AccountCleanupPhase; changed: number; hasMore: boolean }

/** Internal bounded ACCOUNT step composed by the durable PURGE worker. */
@Injectable()
export class AccountCleanupService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(DeletionLedger) private readonly ledger: DeletionLedger,
    @Inject(AccountCleanupRepository) private readonly repository: AccountCleanupRepository,
    @Inject(ReadStateCoreService) private readonly readState: ReadStateCoreService,
    @Inject(NotificationsCoreService) private readonly notifications: NotificationsCoreService,
    @Inject(AccountContentService) private readonly content: AccountContentService,
    @Inject(AccountMediaService) private readonly media: AccountMediaService) {}

  async step(requestId: string, limit = 100, finish?: (tx: Transaction, result: AccountCleanupResult) => Promise<void>): Promise<AccountCleanupResult> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('invalid_account_cleanup_limit');
    // Re-read the immutable external evidence before any database transaction.
    // A DB job, fabricated receipt or caller-supplied user ID alone is not authority.
    const receipt = await this.ledger.readByKey(deletionIntentKey(this.ledger.environment, requestId));
    if (receipt.intent.scope !== 'ACCOUNT') throw new Error('account_cleanup_scope');
    return this.transactions.write<AccountCleanupResult>(async tx => {
      await this.repository.authorize(tx, receipt);
      const result = await this.page(tx, receipt, limit);
      // Runtime continuation is fenced after domain locks, in this SAME transaction.
      // A rejected/expired queue fence rolls back every private-field mutation.
      if (finish) await finish(tx, result);
      return result;
    });
  }
  private async page(tx: Transaction, receipt: DeletionReceipt, limit: number): Promise<AccountCleanupResult> {
    const userId = receipt.intent.targetId;
    const privateFields = await this.repository.privateFields(tx, userId);
    if (privateFields) return { phase: 'private-fields', changed: privateFields, hasMore: true };
    const read = await this.readState.purgeAccount(tx, userId, limit);
    if (read.deleted || read.hasMore) return { phase: 'read-state', changed: read.deleted, hasMore: true };
    const member = await this.repository.memberPage(tx, userId, limit);
    if (member) return { ...member, hasMore: true };
    const push = await this.notifications.purgeAccount(tx, userId, limit);
    if (push.deleted || !push.done) return { phase: 'push', changed: push.deleted, hasMore: true };
    const sessions = await this.repository.sessions(tx, userId, limit);
    if (sessions) return { phase: 'sessions', changed: sessions, hasMore: true };
    const profileChanges = await this.repository.profileChanges(tx, userId, limit);
    if (profileChanges) return { phase: 'profile-changes', changed: profileChanges, hasMore: true };
    const content = await this.content.page(tx, receipt, limit);
    if (content) return content;
    if (await this.media.page(tx, receipt)) return { phase: 'media', changed: 1, hasMore: true };
    // No persistent phase flag: after restart, re-check the first remaining
    // page in every phase. Storage/provider/backup closure remains independent.
    return { phase: 'subset-drained', changed: 0, hasMore: false };
  }
}
