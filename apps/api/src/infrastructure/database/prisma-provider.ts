import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { checkServerIdentity } from 'node:tls';
import mariadb from 'mariadb';
import type { Pool, PoolConnection } from 'mariadb';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../../generated/prisma/client.js';
import type { Config } from '../config/config.js';

export interface TransactionState {
  discovery?: boolean;
  writable: boolean;
  closed: boolean;
  commitStarted: boolean;
  rollbackConfirmed: boolean;
  abort?: () => void;
}

export function poolOptions(config: Config) {
  const db = config.database;
  return {
    host: db.host, port: db.port, user: db.user, password: db.password, database: db.name,
    connectionLimit: db.poolSize, acquireTimeout: 1200, connectTimeout: 1000,
    initializationTimeout: 1000, socketTimeout: 3000, timezone: '+00:00',
    multipleStatements: false, resetAfterUse: true, prepareCacheLength: 0,
    allowPublicKeyRetrieval: !db.tls && ['local', 'test'].includes(config.environment) && ['localhost', '127.0.0.1', '::1'].includes(db.host),
    ...(db.tls ? { ssl: {
      rejectUnauthorized: true, servername: db.host,
      checkServerIdentity: (_hostname: string, certificate: Parameters<typeof checkServerIdentity>[1]) => checkServerIdentity(db.host, certificate),
      ...(db.caFile ? { ca: readFileSync(db.caFile, 'utf8') } : {}),
    } } : {}),
  };
}

// socketTimeout only bounds idle sockets; this also bounds a busy statement.
async function statement<T>(operation: () => Promise<T>, state?: TransactionState): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      if (state) { state.closed = true; state.abort?.(); }
      reject(new Error('database_statement_timeout'));
    }, 3000);
  });
  try { return await Promise.race([operation(), deadline]); }
  finally { clearTimeout(timer!); }
}

// Install ownership before official capability discovery touches this sole pool.
function ownedPool(options: ReturnType<typeof poolOptions>, context: AsyncLocalStorage<TransactionState>): Pool {
  const pool = mariadb.createPool(options);
  const acquire = pool.getConnection.bind(pool);
  pool.getConnection = async () => {
    const state = context.getStore();
    if (!state) throw new Error('transaction_required');
    const connection = await acquire();
    // Public destroy is patched and integrity-tested for this pinned driver.
    let owned = true;
    const abort = () => { if (owned) { owned = false; connection.destroy(); } };
    const release = connection.release.bind(connection);
    connection.release = async () => {
      // Disarm before handing the connection back, even if rollback/release
      // fails: a later caller timer must never destroy another checkout.
      owned = false;
      if (state?.abort === abort) delete state.abort;
      await release();
    };
    try {
      if (state) state.abort = abort;
      const check = () => { if (state?.closed) throw new Error('transaction_finished'); };
      check();
      if (state?.discovery) return connection;
      await statement(() => connection.query("SET SESSION time_zone = '+00:00'"), state); check();
      await statement(() => connection.query('SET SESSION innodb_lock_wait_timeout = 2'), state); check();
      await statement(() => connection.query(state?.writable === false ? 'SET TRANSACTION READ ONLY' : 'SET TRANSACTION READ WRITE'), state); check();
      return connection;
    } catch (error) {
      // Never return a connection with unconsumed next-transaction settings.
      abort();
      throw error;
    }
  };

  const pooled = async <T>(method: 'query' | 'execute', sql: Parameters<Pool['query']>[0], values?: unknown): Promise<T> => {
    const state = context.getStore();
    // Only official capability discovery may use the pool directly. Domain
    // Client operations must use the interactive transaction connection.
    if (!state?.discovery || method !== 'query' || typeof sql !== 'object' || sql.sql !== 'SELECT VERSION()' || values !== undefined) throw new Error('transaction_required');
    return (async () => {
      let connection: PoolConnection | undefined;
      try {
        return await statement(async () => {
          connection = await pool.getConnection();
          if (state.closed) throw new Error('transaction_finished');
          return connection[method]<T>(sql, values);
        }, state);
      } finally {
        // Discovery is one startup query: discard its connection even after
        // success. No release-time reset/rollback can escape the deadline, and
        // no bootstrap state can reach a later transaction checkout.
        state.abort?.();
        if (connection) await connection.release();
      }
    })();
  };
  pool.query = <T>(sql: Parameters<Pool['query']>[0], values?: unknown) => pooled<T>('query', sql, values);
  pool.execute = <T>(sql: Parameters<Pool['execute']>[0], values?: unknown) => pooled<T>('execute', sql, values);
  return pool;
}

// The official adapter disposes the sole guarded pool and owns encoding. This
// checkout hook configures the NEXT transaction before its normal BEGIN; it
// never restarts a transaction or executes a domain statement.
export class TransactionAdapter extends PrismaMariaDb {
  private readonly pool: Pool;
  constructor(options: ReturnType<typeof poolOptions>, private readonly context: AsyncLocalStorage<TransactionState>) {
    const pool = ownedPool(options, context);
    const end = pool.end.bind(pool);
    let closing: Promise<void> | undefined;
    pool.end = () => closing ??= end();
    super(pool, { disposeExternalPool: true });
    this.pool = pool;
  }
  close(): Promise<void> { return this.pool.end(); }
  override async connect() {
    // Prisma shares this promise across callers; discovery must not inherit
    // the first caller's shorter readiness transaction state.
    const discovery: TransactionState = { discovery: true, writable: false, closed: false, commitStarted: false, rollbackConfirmed: false };
    const adapter = await this.context.run(discovery, async () => {
      try { return await super.connect(); }
      finally { discovery.closed = true; discovery.abort?.(); delete discovery.abort; }
    });
    const start = adapter.startTransaction.bind(adapter);
    adapter.startTransaction = async isolation => {
      const state = this.context.getStore();
      const transaction = await statement(() => start(isolation), state);
      const commit = transaction.commit.bind(transaction);
      const rollback = transaction.rollback.bind(transaction);
      const query = transaction.queryRaw.bind(transaction);
      const execute = transaction.executeRaw.bind(transaction);
      // Guard at actual driver submission, including cached delegates and lazy
      // PrismaPromises created while the public handle was still active.
      transaction.queryRaw = queryInput => {
        if (state?.closed) return Promise.reject(new Error('transaction_finished'));
        return statement(() => query(queryInput), state);
      };
      transaction.executeRaw = queryInput => {
        if (state?.closed) return Promise.reject(new Error('transaction_finished'));
        return statement(() => execute(queryInput), state);
      };
      transaction.commit = async () => {
        if (state?.closed) { await transaction.rollback(); throw new Error('transaction_finished'); }
        if (state) state.commitStarted = true;
        try { await statement(commit, state); } finally { if (state) delete state.abort; }
      };
      transaction.rollback = async () => {
        try { await statement(rollback, state); if (state) state.rollbackConfirmed = true; }
        finally { if (state) delete state.abort; }
      };
      if (state?.closed) { await transaction.rollback(); throw new Error('transaction_finished'); }
      return transaction;
    };
    return adapter;
  }
}

export function createPrisma(config: Config) {
  const context = new AsyncLocalStorage<TransactionState>();
  const adapter = new TransactionAdapter(poolOptions(config), context);
  const client = new PrismaClient({ adapter, transactionOptions: { maxWait: 1200, timeout: 8000, isolationLevel: 'RepeatableRead' } });
  const close = async () => { try { await client.$disconnect(); } finally { await adapter.close(); } };
  return { client, context, close };
}
