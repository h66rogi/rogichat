import type { Config } from '../config/config.js';
import { Transactions } from './transactions.js';
import { migrationManifest } from './schema-manifest.js';
import { createPrisma } from './prisma-provider.js';
export { poolOptions } from './prisma-provider.js';

export type Readiness = { ready: true; reason: 'ready' } | { ready: false; reason: 'database_unavailable' | 'schema_mismatch' };
export interface Database { check(): Promise<Readiness>; close(): Promise<void>; }

export class PrismaDatabase implements Database {
  private readonly runtime;
  private inFlight: Promise<Readiness> | undefined;
  private closed = false;
  readonly transactions: Transactions;
  constructor(config: Config) {
    this.runtime = createPrisma(config);
    this.transactions = new Transactions(this.runtime.client, this.runtime.context);
  }
  check(): Promise<Readiness> {
    if (this.closed) return Promise.resolve({ ready: false, reason: 'database_unavailable' });
    this.inFlight ??= this.probe().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }
  private async probe(): Promise<Readiness> {
    try {
      // Includes cold Prisma capability discovery and the subsequent checkout,
      // each of which otherwise spends its own acquire budget before readiness.
      const rows = await this.transactions.read(tx => tx.prisma.$queryRaw<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
        SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations
        WHERE rolled_back_at IS NULL ORDER BY migration_name LIMIT 100`, 2000);
      const matches = rows.length === migrationManifest.length && rows.every((row, index) => {
        const expected = migrationManifest[index];
        return expected && row.migration_name === expected.name && row.checksum === expected.checksum && row.finished_at !== null && row.rolled_back_at === null;
      });
      return matches ? { ready: true, reason: 'ready' } : { ready: false, reason: 'schema_mismatch' };
    } catch (error) {
      const missing = error && typeof error === 'object' && 'meta' in error &&
        (error.meta as { driverAdapterError?: { cause?: { kind?: string } } } | undefined)?.driverAdapterError?.cause?.kind === 'TableDoesNotExist';
      return { ready: false, reason: missing ? 'schema_mismatch' : 'database_unavailable' };
    }
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.runtime.close();
  }
}
// Same Prisma provider, retained during the coordinated Nest/test import move.
export { PrismaDatabase as MysqlDatabase };
