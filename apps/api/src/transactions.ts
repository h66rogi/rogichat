import { randomInt } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2';

// The handle cannot escape its callback or start nested/pool queries accidentally.
export class Transaction {
  private active = true;
  constructor(private readonly connection: PoolConnection, readonly writable: boolean) {}
  finish(): void { this.active = false; }
  async rows<T extends RowDataPacket>(sql: string, values: readonly unknown[] = []): Promise<T[]> {
    if (!this.active) throw new Error('transaction_finished');
    const [rows] = await this.connection.promise().query<T[]>({ sql, timeout: 3000 }, [...values]);
    return rows;
  }
  async execute(sql: string, values: readonly unknown[] = []): Promise<ResultSetHeader> {
    if (!this.active || !this.writable) throw new Error('transaction_not_writable');
    const [result] = await this.connection.promise().query<ResultSetHeader>({ sql, timeout: 3000 }, [...values]);
    return result;
  }
}

export class Transactions {
  constructor(private readonly pool: Pool) {}
  read<T>(operation: (tx: Transaction) => Promise<T>): Promise<T> { return this.run(false, operation); }
  // Retry only rolled-back lock failures. No external I/O in callbacks; no retry of unknown COMMIT outcomes.
  async write<T>(operation: (tx: Transaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.run(true, operation); }
      catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
        if (attempt >= 2 || (code !== 'ER_LOCK_DEADLOCK' && code !== 'ER_LOCK_WAIT_TIMEOUT')) throw error;
        await delay(randomInt(5, 20) * (attempt + 1));
      }
    }
  }
  private async run<T>(writable: boolean, operation: (tx: Transaction) => Promise<T>): Promise<T> {
    const connection = await this.acquire();
    const tx = new Transaction(connection, writable);
    let committing = false;
    let broken = false;
    // Covers callback stalls as well as database requests. No late commit after the deadline.
    let expire: () => void = () => {};
    const timeout = new Promise<never>((_, reject) => { expire = () => reject(new Error('transaction_timeout')); });
    const deadline = setTimeout(() => { broken = true; tx.finish(); connection.destroy(); expire(); }, 8000);
    try {
      return await Promise.race([(async () => {
        // Use the revocable handle even for setup so late continuation cannot issue another query.
        await tx.rows('SET SESSION time_zone = "+00:00"');
        await tx.rows('SET SESSION innodb_lock_wait_timeout = 2');
        await tx.rows('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await tx.rows(writable ? 'START TRANSACTION READ WRITE' : 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
        if (broken) throw new Error('transaction_timeout');
        const result = await operation(tx);
        if (broken) throw new Error('transaction_timeout');
        committing = true;
        await connection.promise().commit();
        return result;
      })(), timeout]);
    } catch (error) {
      try { if (!broken) await Promise.race([connection.promise().rollback(), timeout]); }
      catch { broken = true; }
      // A transport failure at commit is an unknown outcome, never a transparent retry.
      if (committing) { broken = true; throw new Error('commit_outcome_unknown', { cause: error }); }
      throw error;
    } finally {
      tx.finish(); clearTimeout(deadline);
      if (broken) connection.destroy(); else connection.release();
    }
  }
  private acquire(): Promise<PoolConnection> {
    return new Promise((resolve, reject) => {
      let expired = false;
      const timer = setTimeout(() => { expired = true; reject(new Error('database_unavailable')); }, 1200);
      this.pool.getConnection((error, connection) => {
        clearTimeout(timer);
        if (expired) connection?.destroy();
        else if (error) reject(error);
        else resolve(connection);
      });
    });
  }
}
