import { Inject, Injectable, Module } from '@nestjs/common';
import type { DynamicModule, OnApplicationShutdown } from '@nestjs/common';
import { DeletionLedger } from './deletion-ledger.js';
import { R2DeletionLedgerStore } from './adapters/r2-deletion-ledger.js';
import type { DeletionLedgerConfig } from './adapters/r2-deletion-ledger.js';

@Injectable()
class LedgerLifecycle implements OnApplicationShutdown {
  constructor(@Inject(R2DeletionLedgerStore) private readonly store: R2DeletionLedgerStore) {}
  onApplicationShutdown(): void { this.store.close(); }
}
/** Activated only by validated private configuration; shared real API/worker adapter. */
@Module({})
export class DeletionLedgerModule {
  static register(config: DeletionLedgerConfig): DynamicModule {
    return { module: DeletionLedgerModule, providers: [
      { provide: R2DeletionLedgerStore, useFactory: () => new R2DeletionLedgerStore(config) },
      { provide: DeletionLedger, inject: [R2DeletionLedgerStore], useFactory: (store: R2DeletionLedgerStore) => new DeletionLedger(store, config.environment) },
      LedgerLifecycle,
    ], exports: [DeletionLedger] };
  }
}
