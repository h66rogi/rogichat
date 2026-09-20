import { randomUUID } from 'node:crypto';
import type { Transactions } from '../../infrastructure/database/transactions.js';
import { uuid } from '../../common/validation/identifier.js';
import { integer, errorCode, leaseValues, retryDelayMs, consumerPurposes, MAX_DELAY_MS, MAX_LEASE_MS } from './jobs.policy.js';
import type { JobConsumer, JobLease, ClaimOptions, RetryOptions, JobErrorCode } from './jobs.policy.js';
import type { JobsRepository } from './jobs.repository.js';
import type { JobsCoreService } from './jobs-core.service.js';
export class Jobs {
  readonly ownerId: string;
  constructor(private readonly transactions: Transactions, readonly consumer: JobConsumer, private readonly repository: JobsRepository, private readonly core: JobsCoreService, ownerId: string = randomUUID()) {
    if (consumer !== 'api' && consumer !== 'worker') throw new Error('invalid_job_consumer');
    this.ownerId = uuid(ownerId);
  }

  async claim(options: ClaimOptions = {}): Promise<JobLease[]> {
    const allowed = consumerPurposes[this.consumer];
    const purposes = options.purposes ?? allowed;
    if (!Array.isArray(purposes) || purposes.length === 0 || new Set(purposes).size !== purposes.length || purposes.some(value => !allowed.includes(value))) throw new Error('job_consumer_forbidden');
    const limit = integer(options.limit ?? (this.consumer === 'api' ? 20 : 10), 1, this.consumer === 'api' ? 20 : 10);
    const leaseMs = integer(options.leaseMs ?? 30_000, 1000, MAX_LEASE_MS);
    return this.transactions.write(async tx => {
      const rows = await this.repository.claim(tx, purposes, limit);
      const leases: JobLease[] = [];
      for (const row of rows) {
        const generation = BigInt(row.generation) + 1n;
        if (row.attempts >= row.max_attempts) {
          await this.repository.exhaust(tx, [generation.toString(), row.id]);
          continue;
        }
        const token = randomUUID();
        await this.repository.lease(tx, [generation.toString(), this.ownerId, token, leaseMs * 1000, row.id]);
        leases.push(Object.freeze({ id: row.id, purpose: row.purpose, roomId: row.room_id, resourceId: row.resource_id,
          generation, leaseOwner: this.ownerId, leaseToken: token, attempts: row.attempts + 1, maxAttempts: row.max_attempts }));
      }
      return leases;
    });
  }

  private own(lease: JobLease): void {
    leaseValues(lease);
    if (lease.leaseOwner !== this.ownerId || !consumerPurposes[this.consumer].includes(lease.purpose)) throw new Error('job_consumer_forbidden');
  }
  complete(lease: JobLease): Promise<boolean> {
    this.own(lease);
    return this.transactions.write(tx => this.core.complete(tx, lease));
  }
  renew(lease: JobLease, leaseMs = 30_000): Promise<boolean> {
    this.own(lease);
    integer(leaseMs, 1000, MAX_LEASE_MS);
    return this.transactions.write(async tx => {
      const result = await this.repository.renew(tx, [leaseMs * 1000, ...leaseValues(lease)]);
      return result.affectedRows === 1;
    });
  }
  retry(lease: JobLease, code: JobErrorCode, options: RetryOptions = {}): Promise<boolean> {
    this.own(lease); errorCode(code);
    if (options.terminal !== undefined && typeof options.terminal !== 'boolean') throw new Error('invalid_job_policy');
    const delayMs = integer(options.delayMs ?? retryDelayMs(lease.attempts), 0, MAX_DELAY_MS);
    return this.transactions.write(async tx => {
      // Attempts/max_attempts are read by SQL, not trusted from a caller's lease object.
      const result = await this.repository.retry(tx, [options.terminal ?? false, delayMs * 1000, code, ...leaseValues(lease)]);
      return result.affectedRows === 1;
    });
  }
}

export class JobFailure extends Error {
  constructor(readonly code: JobErrorCode, readonly terminal = false) { super(errorCode(code)); }
}

// Transport-only effects (such as lossy hints). Domain-changing handlers must instead use
// completeJob inside their own domain transaction. A failed COMMIT is not an effect retry here.
export async function runClaimedJob(queue: Jobs, lease: JobLease, effect: (lease: JobLease) => Promise<void>): Promise<'completed' | 'retry_scheduled' | 'failed' | 'lease_lost'> {
  leaseValues(lease);
  if (lease.leaseOwner !== queue.ownerId || !consumerPurposes[queue.consumer].includes(lease.purpose)) throw new Error('job_consumer_forbidden');
  try { await effect(lease); }
  catch (error) {
    const code = error instanceof JobFailure ? error.code : 'TEMPORARY_UNAVAILABLE';
    const terminal = error instanceof JobFailure && error.terminal;
    if (!await queue.retry(lease, code, { terminal })) return 'lease_lost';
    return terminal || lease.attempts >= lease.maxAttempts ? 'failed' : 'retry_scheduled';
  }
  return await queue.complete(lease) ? 'completed' : 'lease_lost';
}
