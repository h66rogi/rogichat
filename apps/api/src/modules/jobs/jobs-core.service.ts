import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { uuid } from '../../common/validation/identifier.js';
import { integer, purpose, leaseValues, MAX_DELAY_MS } from './jobs.policy.js';
import type { EnqueueJob, JobLease, PurgeContinuation } from './jobs.policy.js';
import { JobsRepository } from './jobs.repository.js';
@Injectable()
export class JobsCoreService {
  constructor(@Inject(JobsRepository) private readonly repository: JobsRepository) {}
  // Internal transaction primitive, not an HTTP DTO. Caller validates the resource's room scope
  // and authorization in this same transaction before enqueueing. No arbitrary payload exists.
  async enqueue(tx: Transaction, input: EnqueueJob): Promise<string> {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['id', 'purpose', 'roomId', 'resourceId', 'dedupeKey', 'maxAttempts', 'delayMs'].includes(key))) throw new Error('invalid_job_input');
    const id = uuid(input.id ?? randomUUID());
    const jobPurpose = purpose(input.purpose);
    const roomId = input.roomId === undefined ? null : uuid(input.roomId);
    // MESSAGE deletion intents use UUIDv5; this does not grant deletion authority.
    const resourceId = input.resourceId === undefined ? null :
      jobPurpose === 'PURGE' && /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.resourceId) ? input.resourceId : uuid(input.resourceId);
    const maxAttempts = integer(input.maxAttempts ?? 5, 1, 25);
    const delayMs = integer(input.delayMs ?? 0, 0, MAX_DELAY_MS);
    if (input.dedupeKey !== undefined && (!Buffer.isBuffer(input.dedupeKey) || input.dedupeKey.length !== 32)) throw new Error('invalid_job_dedupe');
    await this.repository.insert(tx, Boolean(input.dedupeKey), [id, jobPurpose, roomId, resourceId, maxAttempts, input.dedupeKey ?? null, delayMs * 1000]);
    if (!input.dedupeKey) return id;
    const [existing] = await this.repository.dedupe(tx, [jobPurpose, input.dedupeKey]);
    if (!existing || existing.room_id !== roomId || existing.resource_id !== resourceId) throw new Error('job_dedupe_conflict');
    // Never revive or reschedule a completed/failed job through duplicate enqueue.
    return existing.id;
  }

  // For atomic domain finalization: acquire domain locks in their global order FIRST, then
  // execute this fence in that same transaction. On false, throw and roll back all domain writes.
  // Never hold a job lock while doing external I/O or acquiring earlier domain locks.
  async complete(tx: Transaction, lease: JobLease): Promise<boolean> {
    const result = await this.repository.complete(tx, leaseValues(lease));
    return result.affectedRows === 1;
  }
  async continueMedia(tx: Transaction, lease: JobLease, progress: boolean): Promise<void> {
    leaseValues(lease);
    if (lease.purpose !== 'MEDIA' || !lease.resourceId || !await this.repository.continueMedia(tx, lease, progress)) throw new Error('media_cleanup_lease_lost');
  }
  async recoverMedia(tx: Transaction, assetId: string): Promise<void> {
    await this.repository.recoverMedia(tx, assetId);
  }
  /** Domain locks first; this must be the last mutation in the domain transaction. */
  async continuePurge(tx: Transaction, lease: JobLease, outcome: PurgeContinuation): Promise<void> {
    leaseValues(lease);
    if (lease.purpose !== 'PURGE' || !lease.resourceId || !['progress', 'deferred', 'subset_drained', 'evidence_unavailable'].includes(outcome)) throw new Error('invalid_purge_continuation');
    if (!await this.repository.continuePurge(tx, lease, outcome)) throw new Error('purge_lease_lost');
  }
}
