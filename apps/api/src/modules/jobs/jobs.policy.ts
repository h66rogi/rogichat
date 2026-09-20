import { randomInt } from 'node:crypto';
import { uuid } from '../../common/validation/identifier.js';
export const JOB_PURPOSES = Object.freeze(['REALTIME_HINT', 'MEDIA', 'PUBLICATION', 'PURGE', 'PUSH', 'LEDGER_EXPORT'] as const);
export type JobPurpose = typeof JOB_PURPOSES[number];
export type JobConsumer = 'api' | 'worker';
export const JOB_ERROR_CODES = Object.freeze(['TEMPORARY_UNAVAILABLE', 'DEPENDENCY_TIMEOUT', 'RATE_LIMITED', 'SOURCE_UNAVAILABLE', 'INVALID_RESOURCE', 'ATTEMPTS_EXHAUSTED', 'PERMANENT_FAILURE', 'LEASE_EXPIRED'] as const);
export type JobErrorCode = typeof JOB_ERROR_CODES[number];
export const MAX_DELAY_MS = 86_400_000;
export const MAX_LEASE_MS = 300_000;
export const consumerPurposes: Readonly<Record<JobConsumer, readonly JobPurpose[]>> = Object.freeze({
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

export function integer(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('invalid_job_policy');
  return value;
}
export function purpose(value: JobPurpose): JobPurpose {
  if (!JOB_PURPOSES.includes(value)) throw new Error('invalid_job_purpose');
  return value;
}
export function errorCode(value: JobErrorCode): JobErrorCode {
  if (!JOB_ERROR_CODES.includes(value)) throw new Error('invalid_job_error_code');
  return value;
}
export function leaseValues(lease: JobLease): unknown[] {
  if (typeof lease.generation !== 'bigint' || lease.generation < 1n || lease.generation > 18_446_744_073_709_551_615n) throw new Error('invalid_job_lease');
  return [uuid(lease.id), purpose(lease.purpose), lease.generation.toString(), uuid(lease.leaseOwner), uuid(lease.leaseToken)];
}


export function retryDelayMs(attempt: number, jitter = randomInt(0, 1001) / 1000): number {
  integer(attempt, 1, 25);
  if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) throw new Error('invalid_job_jitter');
  return Math.min(900_000, Math.floor(Math.min(900_000, 1000 * 2 ** (attempt - 1)) * (0.5 + jitter)));
}
