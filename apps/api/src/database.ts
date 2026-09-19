import { readFileSync } from 'node:fs';
import { createPool } from 'mysql2';
import type { Pool, PoolConnection, RowDataPacket, PoolOptions } from 'mysql2';
import type { Config } from './config.js';
import { Transactions } from './transactions.js';
import { migrationManifest } from './schema-manifest.js';

export type Readiness = { ready: true; reason: 'ready' } | { ready: false; reason: 'database_unavailable' | 'schema_mismatch' };
export interface Database {
  check(): Promise<Readiness>;
  close(): Promise<void>;
}

export function poolOptions(config: Config): PoolOptions {
  const db = config.database;
  return {
    host: db.host, port: db.port, user: db.user, password: db.password, database: db.name,
    connectionLimit: db.poolSize, waitForConnections: false, connectTimeout: 1000,
    timezone: 'Z', charset: 'utf8mb4', multipleStatements: false, enableKeepAlive: true,
    supportBigNumbers: true, bigNumberStrings: true,
    ...(db.tls ? { ssl: { rejectUnauthorized: true, verifyIdentity: true, ...(db.caFile ? { ca: readFileSync(db.caFile, 'utf8') } : {}) } } : {}),
  };
}

export class MysqlDatabase implements Database {
  private readonly pool: Pool;
  private inFlight: Promise<Readiness> | undefined;
  private closed = false;
  readonly transactions: Transactions;

  constructor(config: Config) {
    this.pool = createPool(poolOptions(config));
    this.transactions = new Transactions(this.pool);
  }

  check(): Promise<Readiness> {
    if (this.closed) return Promise.resolve({ ready: false, reason: 'database_unavailable' });
    // Coalesce simultaneous probes, but never cache a previous positive result.
    this.inFlight ??= this.probe().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private acquire(): Promise<PoolConnection> {
    return new Promise((resolve, reject) => {
      let expired = false;
      const timer = setTimeout(() => { expired = true; reject(new Error('database_unavailable')); }, 1200);
      this.pool.getConnection((error, connection) => {
        clearTimeout(timer);
        if (expired || this.closed) {
          connection?.destroy();
          if (!expired) reject(new Error('database_unavailable'));
        } else if (error) reject(error);
        else resolve(connection);
      });
    });
  }

  private async probe(): Promise<Readiness> {
    let connection: PoolConnection | undefined;
    try {
      connection = await this.acquire();
      const active = connection;
      const tables = await new Promise<RowDataPacket[]>((resolve, reject) => {
        active.query<RowDataPacket[]>({ sql: 'SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations WHERE rolled_back_at IS NULL ORDER BY migration_name LIMIT 100', timeout: 1000 }, (error, rows) => {
          if (error) reject(error);
          else resolve(rows);
        });
      });
      const matches = tables.length === migrationManifest.length && tables.every((row, i) => {
        const expected = migrationManifest[i];
        return expected && row.migration_name === expected.name && row.checksum === expected.checksum && row.finished_at !== null && row.rolled_back_at === null;
      });
      return matches ? { ready: true, reason: 'ready' } : { ready: false, reason: 'schema_mismatch' };
    } catch (error) {
      connection?.destroy();
      connection = undefined;
      return { ready: false, reason: error && typeof error === 'object' && 'code' in error && error.code === 'ER_NO_SUCH_TABLE' ? 'schema_mismatch' : 'database_unavailable' };
    } finally {
      connection?.release();
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await new Promise<void>((resolve, reject) => { this.pool.end((error) => { if (error) reject(error); else resolve(); }); });
  }
}
