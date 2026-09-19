import { readFileSync } from 'node:fs';
import { createPool } from 'mysql2';
import type { Pool, PoolConnection, RowDataPacket, PoolOptions } from 'mysql2';
import type { Config } from './config.js';

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
    ...(db.tls ? { ssl: { rejectUnauthorized: true, verifyIdentity: true, ...(db.caFile ? { ca: readFileSync(db.caFile, 'utf8') } : {}) } } : {}),
  };
}

export class MysqlDatabase implements Database {
  private readonly pool: Pool;
  private inFlight: Promise<Readiness> | undefined;
  private closed = false;

  constructor(config: Config) {
    this.pool = createPool(poolOptions(config));
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
        // M01 deliberately has no application schema. Any table means an unknown/mismatched schema.
        // M02 must replace this gate with the reviewed migration compatibility manifest.
        active.query<RowDataPacket[]>({ sql: 'SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() LIMIT 1', timeout: 1000 }, (error, rows) => {
          if (error) reject(error);
          else resolve(rows);
        });
      });
      return tables.length === 0 ? { ready: true, reason: 'ready' } : { ready: false, reason: 'schema_mismatch' };
    } catch {
      connection?.destroy();
      connection = undefined;
      return { ready: false, reason: 'database_unavailable' };
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
