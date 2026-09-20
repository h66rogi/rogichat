import { randomInt } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { TransactionState } from './prisma-provider.js';

// Trusted exception SQL plus bound values; ordinary CRUD uses prisma. No Unsafe
// API, caller identifiers or second pool. See backend-orm-first.md inventory.
function bound(sql: string, values: readonly unknown[]): Prisma.Sql {
  return new Prisma.Sql(sql.split('?'), [...values]);
}
// MariaDB adapter widens unsigned INT to Int64 for raw results. Preserve the
// declared domain types of these bounded 32-bit columns; true BIGINT counters
// retain their exact decimal-string contract (never lossy Number conversion).
const rawUnsignedInts = new Set(['policy_version', 'used', 'width', 'height', 'duration_ms', 'photo_max_bytes', 'video_max_bytes', 'attempts', 'max_attempts']);
function rowValue(key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return rawUnsignedInts.has(key) ? Number(value) : value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value);
  return value;
}
export class Transaction {
  constructor(private readonly client: Prisma.TransactionClient, readonly writable: boolean, private readonly state: TransactionState) {}
  get prisma(): Prisma.TransactionClient {
    if (this.state.closed) throw new Error('transaction_finished');
    return this.client;
  }
  finish(): void { this.state.closed = true; }
  async rows<T extends object = Record<string, unknown>>(sql: string, values: readonly unknown[] = []): Promise<T[]> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(bound(sql, values));
    return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, rowValue(key, value)])) as T);
  }
  async execute(sql: string, values: readonly unknown[] = []): Promise<{ affectedRows: number }> {
    if (this.state.closed || !this.writable) throw new Error('transaction_not_writable');
    return { affectedRows: await this.client.$executeRaw(bound(sql, values)) };
  }
  async now(): Promise<Date> {
    const [row] = await this.prisma.$queryRaw<{ now: Date }[]>`SELECT UTC_TIMESTAMP(3) AS now`;
    if (!row) throw new Error('database_clock_unavailable');
    return row.now;
  }
}
function lockFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const entry = error as { code?: unknown; meta?: { code?: unknown; driverAdapterError?: { cause?: { code?: unknown; originalCode?: unknown; kind?: unknown } } } };
  const cause = entry.meta?.driverAdapterError?.cause;
  return (entry.code === 'P2010' && ['1205', '1213'].includes(String(entry.meta?.code))) || entry.code === 'P2034' || cause?.kind === 'TransactionWriteConflict' || cause?.code === 1205 || cause?.originalCode === '1205';
}
export class Transactions {
  constructor(private readonly client: PrismaClient, private readonly context: AsyncLocalStorage<TransactionState>) {}
  read<T>(operation: (tx: Transaction) => Promise<T>, deadlineMs = 8000): Promise<T> {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 8000) throw new Error('invalid_transaction_deadline');
    return this.run(false, operation, deadlineMs);
  }
  async write<T>(operation: (tx: Transaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.run(true, operation); }
      catch (error) {
        const retry = this.retryable.delete(error);
        if (attempt >= 2 || !retry) throw error;
        await delay(randomInt(5, 20) * (attempt + 1));
      }
    }
  }
  private readonly retryable = new Set<unknown>();
  private readonly rolledBack = new WeakSet<object>();
  rollbackConfirmed(error: unknown): boolean { return typeof error === 'object' && error !== null && this.rolledBack.has(error); }
  private async run<T>(writable: boolean, operation: (tx: Transaction) => Promise<T>, deadlineMs = 8000): Promise<T> {
    const state: TransactionState = { writable, closed: false, commitStarted: false, rollbackConfirmed: false };
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { state.closed = true; state.abort?.(); reject(new Error('transaction_timeout')); }, deadlineMs);
    });
    try {
      return await Promise.race([this.context.run(state, () => this.client.$transaction(async client => {
        if (state.closed) throw new Error('transaction_finished');
        const tx = new Transaction(client, writable, state);
        const result = await operation(tx);
        if (state.closed) throw new Error('transaction_finished');
        return result;
      })), deadline]);
    } catch (error) {
      if (state.commitStarted) throw new Error('commit_outcome_unknown', { cause: error });
      if (state.rollbackConfirmed && typeof error === 'object' && error !== null) this.rolledBack.add(error);
      if (writable && state.rollbackConfirmed && lockFailure(error)) this.retryable.add(error);
      throw error;
    } finally {
      state.closed = true;
      // Prisma maxWait can reject before adapter startup settles. Terminate
      // only a still-owned checkout; release disarms this handle first.
      state.abort?.();
      delete state.abort;
      clearTimeout(timer!);
    }
  }
}

export async function affected(result: Promise<{ count: number }>): Promise<{ affectedRows: number }> {
  return { affectedRows: (await result).count };
}
