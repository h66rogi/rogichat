import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { JobsCoreService } from '../jobs/jobs-core.service.js';
import { leaseValues, purgeDedupe } from '../jobs/jobs.policy.js';
import type { JobLease, PurgeContinuation } from '../jobs/jobs.policy.js';
import { JobFailure } from '../jobs/jobs.service.js';
import type { WorkerResult } from '../jobs/worker-loop.js';
import { AccountCleanupService } from './account-cleanup.service.js';
import { DeletionLedger, deletionIntentKey } from './deletion-ledger.js';
import type { DeletionReceipt } from './deletion-ledger.js';
import { MessagePurgeService } from './message-purge.service.js';
import { PurgeWorkerRepository } from './purge-worker.repository.js';

@Injectable()
export class PurgeWorkerService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(DeletionLedger) private readonly ledger: DeletionLedger,
    @Inject(JobsCoreService) private readonly jobs: JobsCoreService,
    @Inject(PurgeWorkerRepository) private readonly repository: PurgeWorkerRepository,
    @Inject(MessagePurgeService) private readonly messages: MessagePurgeService,
    @Inject(AccountCleanupService) private readonly accounts: AccountCleanupService) {}

  async recover(): Promise<{ examined: number; unavailable: number }> {
    const page = await this.transactions.write(tx => this.repository.discover(tx, this.ledger.sourceId, this.ledger.environment));
    let unavailable = 0;
    for (const requestId of page) {
      try {
        await this.transactions.write(async tx => {
          const intent = await this.repository.intent(tx, requestId, this.ledger.environment);
          if (!intent) { unavailable++; return; }
          await this.jobs.enqueue(tx, { purpose: 'PURGE', resourceId: requestId, ...(intent.room_id ? { roomId: intent.room_id } : {}), dedupeKey: purgeDedupe(requestId) });
          await this.repository.recover(tx, requestId, intent.room_id);
        });
      } catch { unavailable++; } // Cursor already advances; revisit on the next durable pass.
    }
    return { examined: page.length, unavailable };
  }

  async process(lease: JobLease): Promise<WorkerResult> {
    leaseValues(lease);
    if (lease.purpose !== 'PURGE' || !lease.resourceId) throw new JobFailure('INVALID_RESOURCE', true);
    let receipt: DeletionReceipt;
    try {
      // No transaction spans this bounded external read. The domain step checks
      // its current checkpoint against this exact immutable receipt again.
      receipt = await this.ledger.readByKey(deletionIntentKey(this.ledger.environment, lease.resourceId));
    } catch {
      await this.transactions.write(tx => this.jobs.continuePurge(tx, lease, 'evidence_unavailable'));
      return 'deferred';
    }
    if (receipt.intent.requestId !== lease.resourceId || receipt.intent.roomId !== lease.roomId) throw new JobFailure('INVALID_RESOURCE', true);
    let outcome: Exclude<PurgeContinuation, 'evidence_unavailable'> = 'deferred';
    try {
      if (receipt.intent.scope === 'MESSAGE') {
        await this.messages.step(this.transactions, this.ledger.environment, lease, 100, { receipt, finish: async (tx, result) => {
          outcome = result.status === 'rows_purged' ? 'subset_drained' : result.status;
          await this.jobs.continuePurge(tx, lease, outcome);
        } });
      } else {
        await this.accounts.step(lease.resourceId, 100, async (tx, result) => {
          outcome = result.hasMore ? 'progress' : 'subset_drained';
          await this.jobs.continuePurge(tx, lease, outcome);
        });
      }
    } catch (error) {
      // Only confirmed rollback of an expected admission precondition can become
      // deferred. Unknown COMMIT never re-executes the domain command here.
      if (this.transactions.rollbackConfirmed(error) && error instanceof Error &&
          ['account_cleanup_not_admitted', 'account_cleanup_not_blocked', 'account_cleanup_obligation_unavailable'].includes(error.message)) {
        await this.transactions.write(tx => this.jobs.continuePurge(tx, lease, 'deferred'));
        return 'deferred';
      }
      throw error;
    }
    return outcome;
  }
}
