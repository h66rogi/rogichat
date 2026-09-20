import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';

@Injectable()
export class DeletionBacklogRepository {
  async snapshot(tx: Transaction) {
    const pending = { state: { in: ['BLOCKED', 'PURGING'] as ('BLOCKED' | 'PURGING')[] } };
    // Scalar aggregates only: no bodies, identities, keys, UUIDs or per-user rows.
    // The existing read-only transaction gives every query one consistent view.
    const messages = await tx.prisma.deletion_requests.aggregate({ where: pending,
      _count: { _all: true }, _min: { requested_at: true }, _max: { requested_at: true } });
    const accounts = await tx.prisma.account_deletion_obligations.aggregate({ where: pending,
      _count: { _all: true }, _min: { requested_at: true }, _max: { requested_at: true } });
    const unapplied = await tx.prisma.deletion_intents.aggregate({ where: { blocked_at: null },
      _count: { _all: true }, _min: { requested_at: true }, _max: { requested_at: true } });
    const failedJobs = await tx.prisma.jobs.count({ where: { purpose: 'PURGE', state: 'FAILED' } });
    const uncoveredAccounts = await tx.prisma.account_deletion_obligations.count({ where: { ...pending, guard_coverage: false } });
    const replayErrors = await tx.prisma.deletion_replay_entries.count({ where: { OR: [
      { state: 'INVALID' }, { evidence_conflict: true },
    ] } });
    // RETRY includes normal next-generation re-observation. Historical failure
    // metadata alone cannot classify a currently failing attempt.
    const replayRetryWithFailureHistory = await tx.prisma.deletion_replay_entries.count({ where: {
      state: 'RETRY', last_failure_code: { not: null },
    } });
    const discoveryErrors = await tx.prisma.deletion_replay_sources.count({ where: { current_failure_code: { not: null } } });
    const now = await tx.now(); // After snapshot establishment, not a pre-snapshot wall clock.
    return { now, messages, accounts, unapplied, failedJobs, uncoveredAccounts, replayErrors, discoveryErrors, replayRetryWithFailureHistory };
  }
}
