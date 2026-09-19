import { randomInt, randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2';
import type { Transaction, Transactions } from './transactions.js';
import { uuid } from './repositories.js';

export const JOB_PURPOSES = Object.freeze(['REALTIME_HINT', 'MEDIA', 'PUBLICATION', 'PURGE', 'PUSH', 'LEDGER_EXPORT'] as const);
export type JobPurpose = typeof JOB_PURPOSES[number];
export type JobConsumer = 'api' | 'worker';
export const JOB_ERROR_CODES = Object.freeze(['TEMPORARY_UNAVAILABLE', 'DEPENDENCY_TIMEOUT', 'RATE_LIMITED', 'SOURCE_UNAVAILABLE', 'INVALID_RESOURCE', 'ATTEMPTS_EXHAUSTED', 'PERMANENT_FAILURE', 'LEASE_EXPIRED'] as const);
export type JobErrorCode = typeof JOB_ERROR_CODES[number];
const MAX_DELAY_MS = 86_400_000;
const MAX_LEASE_MS = 300_000;
const consumerPurposes: Readonly<Record<JobConsumer, readonly JobPurpose[]>> = Object.freeze({
  api: Object.freeze(['REALTIME_HINT'] as const),
  worker: Object.freeze(['PURGE', 'MEDIA', 'PUBLICATION', 'PUSH', 'LEDGER_EXPORT'] as const),
});

export interface EnqueueJob {
  id?: string; purpose: JobPurpose; roomId?: string; resourceId?: string;
  dedupeKey?: Buffer; maxAttempts?: number; delayMs?: number;
}
export interface JobLease {
  readonly id: string; readonly purpose: JobPurpose; readonly roomId: string | null; readonly resourceId: string | null;
  readonly generation: bigint; readonly leaseOwner: string; readonly leaseToken: string;
  readonly attempts: number; readonly maxAttempts: number;
}
export interface ClaimOptions { purposes?: readonly JobPurpose[]; limit?: number; leaseMs?: number }
export interface RetryOptions { delayMs?: number; terminal?: boolean }
interface JobRow extends RowDataPacket {
  id: string; purpose: JobPurpose; room_id: string | null; resource_id: string | null;
  generation: string; attempts: number; max_attempts: number;
}

function integer(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('invalid_job_policy');
  return value;
}
function purpose(value: JobPurpose): JobPurpose {
  if (!JOB_PURPOSES.includes(value)) throw new Error('invalid_job_purpose');
  return value;
}
function errorCode(value: JobErrorCode): JobErrorCode {
  if (!JOB_ERROR_CODES.includes(value)) throw new Error('invalid_job_error_code');
  return value;
}
function leaseValues(lease: JobLease): unknown[] {
  if (typeof lease.generation !== 'bigint' || lease.generation < 1n || lease.generation > 18_446_744_073_709_551_615n) throw new Error('invalid_job_lease');
  return [uuid(lease.id), purpose(lease.purpose), lease.generation.toString(), uuid(lease.leaseOwner), uuid(lease.leaseToken)];
}
const fence = 'id=? AND purpose=? AND generation=? AND lease_owner=? AND lease_token=? AND state="RUNNING" AND lease_until>UTC_TIMESTAMP(3)';

// Internal transaction primitive, not an HTTP DTO. Caller validates the resource's room scope
// and authorization in this same transaction before enqueueing. No arbitrary payload exists.
export async function enqueueJob(tx: Transaction, input: EnqueueJob): Promise<string> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['id', 'purpose', 'roomId', 'resourceId', 'dedupeKey', 'maxAttempts', 'delayMs'].includes(key))) throw new Error('invalid_job_input');
  const id = uuid(input.id ?? randomUUID());
  const jobPurpose = purpose(input.purpose);
  const roomId = input.roomId === undefined ? null : uuid(input.roomId);
  const resourceId = input.resourceId === undefined ? null : uuid(input.resourceId);
  const maxAttempts = integer(input.maxAttempts ?? 5, 1, 25);
  const delayMs = integer(input.delayMs ?? 0, 0, MAX_DELAY_MS);
  if (input.dedupeKey !== undefined && (!Buffer.isBuffer(input.dedupeKey) || input.dedupeKey.length !== 32)) throw new Error('invalid_job_dedupe');
  await tx.execute(`INSERT INTO jobs (id,purpose,room_id,resource_id,max_attempts,dedupe_key,available_at)
    VALUES (?,?,?,?,?,?,TIMESTAMPADD(MICROSECOND,?,UTC_TIMESTAMP(3)))${input.dedupeKey ? ' ON DUPLICATE KEY UPDATE id=id' : ''}`,
  [id, jobPurpose, roomId, resourceId, maxAttempts, input.dedupeKey ?? null, delayMs * 1000]);
  if (!input.dedupeKey) return id;
  const [existing] = await tx.rows<JobRow>('SELECT id,room_id,resource_id FROM jobs WHERE purpose=? AND dedupe_key=? FOR UPDATE', [jobPurpose, input.dedupeKey]);
  if (!existing || existing.room_id !== roomId || existing.resource_id !== resourceId) throw new Error('job_dedupe_conflict');
  // Never revive or reschedule a completed/failed job through duplicate enqueue.
  return existing.id;
}

// For atomic domain finalization: acquire domain locks in their global order FIRST, then
// execute this fence in that same transaction. On false, throw and roll back all domain writes.
// Never hold a job lock while doing external I/O or acquiring earlier domain locks.
export async function completeJob(tx: Transaction, lease: JobLease): Promise<boolean> {
  const result = await tx.execute(`UPDATE jobs SET state="COMPLETED",lease_owner=NULL,lease_token=NULL,lease_until=NULL,last_error_code=NULL WHERE ${fence}`, leaseValues(lease));
  return result.affectedRows === 1;
}

export function retryDelayMs(attempt: number, jitter = randomInt(0, 1001) / 1000): number {
  integer(attempt, 1, 25);
  if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) throw new Error('invalid_job_jitter');
  return Math.min(900_000, Math.floor(Math.min(900_000, 1000 * 2 ** (attempt - 1)) * (0.5 + jitter)));
}

export class Jobs {
  readonly ownerId: string;
  constructor(private readonly transactions: Transactions, readonly consumer: JobConsumer, ownerId = randomUUID()) {
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
      const rows = await tx.rows<JobRow>(`SELECT id,purpose,room_id,resource_id,generation,attempts,max_attempts FROM jobs
        WHERE purpose IN (${purposes.map(() => '?').join(',')}) AND
          ((state="PENDING" AND available_at<=UTC_TIMESTAMP(3)) OR (state="RUNNING" AND lease_until<=UTC_TIMESTAMP(3)))
        ORDER BY CASE WHEN purpose="PURGE" THEN 0 ELSE 1 END,available_at,id LIMIT ? FOR UPDATE SKIP LOCKED`, [...purposes, limit]);
      const leases: JobLease[] = [];
      for (const row of rows) {
        const generation = BigInt(row.generation) + 1n;
        if (row.attempts >= row.max_attempts) {
          await tx.execute('UPDATE jobs SET state="FAILED",generation=?,lease_owner=NULL,lease_token=NULL,lease_until=NULL,last_error_code="ATTEMPTS_EXHAUSTED" WHERE id=?', [generation.toString(), row.id]);
          continue;
        }
        const token = randomUUID();
        await tx.execute('UPDATE jobs SET state="RUNNING",generation=?,lease_owner=?,lease_token=?,lease_until=TIMESTAMPADD(MICROSECOND,?,UTC_TIMESTAMP(3)),attempts=attempts+1 WHERE id=?',
          [generation.toString(), this.ownerId, token, leaseMs * 1000, row.id]);
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
    return this.transactions.write(tx => completeJob(tx, lease));
  }
  renew(lease: JobLease, leaseMs = 30_000): Promise<boolean> {
    this.own(lease);
    integer(leaseMs, 1000, MAX_LEASE_MS);
    return this.transactions.write(async tx => {
      const result = await tx.execute(`UPDATE jobs SET lease_until=TIMESTAMPADD(MICROSECOND,?,UTC_TIMESTAMP(3)) WHERE ${fence}`, [leaseMs * 1000, ...leaseValues(lease)]);
      return result.affectedRows === 1;
    });
  }
  retry(lease: JobLease, code: JobErrorCode, options: RetryOptions = {}): Promise<boolean> {
    this.own(lease); errorCode(code);
    if (options.terminal !== undefined && typeof options.terminal !== 'boolean') throw new Error('invalid_job_policy');
    const delayMs = integer(options.delayMs ?? retryDelayMs(lease.attempts), 0, MAX_DELAY_MS);
    return this.transactions.write(async tx => {
      // Attempts/max_attempts are read by SQL, not trusted from a caller's lease object.
      const result = await tx.execute(`UPDATE jobs SET state=IF(? OR attempts>=max_attempts,"FAILED","PENDING"),
        available_at=TIMESTAMPADD(MICROSECOND,?,UTC_TIMESTAMP(3)),last_error_code=?,lease_owner=NULL,lease_token=NULL,lease_until=NULL WHERE ${fence}`,
      [options.terminal ?? false, delayMs * 1000, code, ...leaseValues(lease)]);
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
