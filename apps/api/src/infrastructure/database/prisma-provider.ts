import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { checkServerIdentity } from 'node:tls';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../../generated/prisma/client.js';
import type { Config } from '../config/config.js';

export interface TransactionState {
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

// The pinned official adapter owns the sole pool and query encoding. This
// checkout hook configures the NEXT transaction before its normal BEGIN; it
// never restarts a transaction or executes a domain statement.
export class TransactionAdapter extends PrismaMariaDb {
  constructor(options: ReturnType<typeof poolOptions>, private readonly context: AsyncLocalStorage<TransactionState>) { super(options); }
  override async connect() {
    const adapter = await super.connect();
    const pool = adapter.underlyingDriver();
    const acquire = pool.getConnection.bind(pool);
    pool.getConnection = async () => {
      const state = this.context.getStore();
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
  return { client, context };
}
