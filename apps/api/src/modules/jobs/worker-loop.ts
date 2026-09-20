import { JobFailure } from './jobs.service.js';
import type { Jobs } from './jobs.service.js';
import { JOB_PURPOSES } from './jobs.policy.js';
import type { JobLease, JobPurpose } from './jobs.policy.js';
import type { LifecycleState } from '../../common/lifecycle/lifecycle-state.js';

export type WorkerResult = 'completed' | 'lease_lost';
export type WorkerHandler = (lease: JobLease) => Promise<WorkerResult>;
export interface WorkerOptions {
  // Must consult current DB/schema readiness, not a once-at-start cached success.
  ready: () => Promise<boolean>;
  pollMs?: number;
  maxPerTick?: number;
  leaseMs?: number;
}
export interface WorkerTick { claimed: number; completed: number; leaseLost: number; retried: number; failed: number }
const empty = (): WorkerTick => ({ claimed: 0, completed: 0, leaseLost: 0, retried: 0, failed: 0 });
function bounded(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('invalid_worker_policy');
  return value;
}

// Domain handlers own their transaction and MUST call completeJob in the same transaction as
// domain writes, rolling everything back if its fence returns false. This loop never marks a job
// completed merely because a function resolved. External I/O and domain idempotency remain handler duties.
export class WorkerLoop {
  private readonly handlers: Readonly<Partial<Record<JobPurpose, WorkerHandler>>>;
  private readonly purposes: readonly JobPurpose[];
  private readonly ready: () => Promise<boolean>;
  private readonly pollMs: number;
  private readonly maxPerTick: number;
  private readonly leaseMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<WorkerTick> | undefined;
  private stopping: Promise<void> | undefined;
  private started = false;
  private stopped = false;

  constructor(private readonly jobs: Jobs, private readonly lifecycle: LifecycleState,
    handlers: Partial<Record<JobPurpose, WorkerHandler>>, options: WorkerOptions) {
    if (!handlers || typeof handlers !== 'object' || Array.isArray(handlers) || Object.keys(handlers).some(key => key === 'REALTIME_HINT' || !JOB_PURPOSES.includes(key as JobPurpose) || typeof handlers[key as JobPurpose] !== 'function')) throw new Error('invalid_worker_handlers');
    if (!options || typeof options.ready !== 'function' || Object.keys(options).some(key => !['ready', 'pollMs', 'maxPerTick', 'leaseMs'].includes(key))) throw new Error('invalid_worker_policy');
    this.handlers = Object.freeze({ ...handlers });
    // The queue SQL also prioritizes PURGE. No purpose is installed by default.
    this.purposes = Object.freeze((['PURGE', 'MEDIA', 'PUBLICATION', 'PUSH', 'LEDGER_EXPORT'] as const).filter(purpose => Object.hasOwn(this.handlers, purpose)));
    this.ready = options.ready;
    this.pollMs = bounded(options.pollMs ?? 5000, 100, 60000);
    this.maxPerTick = bounded(options.maxPerTick ?? 10, 1, 10);
    this.leaseMs = bounded(options.leaseMs ?? 30000, 1000, 300000);
  }
  stats(): { running: boolean; stopped: boolean; installedPurposes: readonly JobPurpose[] } {
    return { running: this.pending !== undefined, stopped: this.stopped, installedPurposes: this.purposes };
  }
  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    const poll = () => {
      if (this.stopped || this.lifecycle.draining) return;
      this.timer = setTimeout(() => { void this.tick().catch(() => {}).finally(poll); }, this.pollMs);
      this.timer.unref();
    };
    poll();
  }
  tick(): Promise<WorkerTick> {
    if (this.stopped || this.lifecycle.draining || !this.purposes.length) return Promise.resolve(empty());
    this.pending ??= this.run().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async run(): Promise<WorkerTick> {
    const counts = empty();
    for (let index = 0; index < this.maxPerTick && !this.stopped && !this.lifecycle.draining; index++) {
      if (await this.ready() !== true || this.stopped || this.lifecycle.draining) break;
      // Claim one at a time: a slow handler must not consume nine other jobs' lease time in a local queue.
      const [lease] = await this.jobs.claim({ purposes: this.purposes, limit: 1, leaseMs: this.leaseMs });
      if (!lease) break;
      counts.claimed++;
      if (this.stopped || this.lifecycle.draining) {
        // Readiness/stop can change during claim. No new domain work starts after the stop boundary.
        if (await this.jobs.retry(lease, 'TEMPORARY_UNAVAILABLE', { delayMs: 0 })) counts.retried++;
        else counts.leaseLost++;
        break;
      }
      const handler = this.handlers[lease.purpose];
      if (!handler) throw new Error('worker_claim_purpose_mismatch');
      try {
        const result = await handler(lease);
        if (result === 'completed') counts.completed++;
        else if (result === 'lease_lost') counts.leaseLost++;
        else throw new JobFailure('PERMANENT_FAILURE', true);
      } catch (error) {
        const code = error instanceof JobFailure ? error.code : 'TEMPORARY_UNAVAILABLE';
        const terminal = error instanceof JobFailure && error.terminal;
        // The DB's state/owner/token/generation/expiry fence also resolves unknown commit outcomes:
        // a transaction that already committed its domain writes+completion cannot be retried here.
        if (!await this.jobs.retry(lease, code, { terminal })) counts.leaseLost++;
        else if (terminal || lease.attempts >= lease.maxAttempts) counts.failed++;
        else counts.retried++;
      }
    }
    return counts;
  }
  stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.stopping ??= (async () => { await this.pending?.catch(() => {}); })();
    return this.stopping;
  }
}
