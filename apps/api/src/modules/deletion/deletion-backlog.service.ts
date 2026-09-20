import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { DATABASE } from '../../infrastructure/database/database.tokens.js';
import type { Database } from '../../infrastructure/database/database.js';
import { DeletionBacklogRepository } from './deletion-backlog.repository.js';

type Aggregate = { _count: { _all: number }; _min: { requested_at: Date | null }; _max: { requested_at: Date | null } };
type Level = 'below_warning' | 'warning' | 'urgent' | 'breach';
const levels: Level[] = ['below_warning', 'warning', 'urgent', 'breach'];
function count(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_deletion_backlog');
  return value;
}
function age(value: Aggregate, now: number) {
  const total = count(value._count._all);
  const first = value._min.requested_at?.getTime(), last = value._max.requested_at?.getTime();
  if (total === 0) {
    if (first !== undefined || last !== undefined) throw new Error('invalid_deletion_backlog');
    return { count: 0, oldestAgeSeconds: null, level: 'below_warning' as Level };
  }
  if (first === undefined || last === undefined || !Number.isFinite(first) || !Number.isFinite(last) || first > last || last > now) throw new Error('invalid_deletion_backlog');
  const seconds = Math.floor((now - first) / 1000);
  const level: Level = seconds >= 86400 ? 'breach' : seconds >= 43200 ? 'urgent' : seconds >= 3600 ? 'warning' : 'below_warning';
  return { count: total, oldestAgeSeconds: seconds, level };
}

/** Operator-only scalar report; never a physical-purge or restore-release proof. */
@Injectable()
export class DeletionBacklogService {
  constructor(@Inject(DATABASE) private readonly database: Database,
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(DeletionBacklogRepository) private readonly repository: DeletionBacklogRepository) {}

  async inspect() {
    if (!(await this.database.check()).ready) throw new Error('deletion_backlog_unavailable');
    return this.transactions.read(async tx => {
      const snapshot = await this.repository.snapshot(tx);
      const now = snapshot.now.getTime();
      if (!Number.isFinite(now)) throw new Error('invalid_deletion_backlog');
      const messages = age(snapshot.messages, now), accounts = age(snapshot.accounts, now), unapplied = age(snapshot.unapplied, now);
      const errors = { failedPurgeJobs: count(snapshot.failedJobs), uncoveredAccounts: count(snapshot.uncoveredAccounts),
        replayErrors: count(snapshot.replayErrors), discoveryErrors: count(snapshot.discoveryErrors) };
      const level = levels[Math.max(...[messages, accounts, unapplied].map(item => levels.indexOf(item.level)))]!;
      return { schemaVersion: 1 as const, observedAt: snapshot.now.toISOString(), coverage: 'database-only' as const,
        completionVerified: false as const, level, requiresAttention: level !== 'below_warning' || Object.values(errors).some(value => value > 0),
        messages, accounts, unapplied, errors, replayRetryWithFailureHistory: count(snapshot.replayRetryWithFailureHistory) };
    });
  }
}
