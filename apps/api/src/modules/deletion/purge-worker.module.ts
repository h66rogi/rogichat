import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { JobsCoreModule } from '../jobs/jobs-core.module.js';
import { AccountCleanupModule } from './account-cleanup.module.js';
import { DeletionLedger } from './deletion-ledger.js';
import { DeletionLedgerModule } from './deletion-ledger.module.js';
import type { DeletionOptions } from './deletion.module.js';
import { MessagePurgeModule } from './message-purge.module.js';
import { PurgeWorkerRepository } from './purge-worker.repository.js';
import { PurgeWorkerService } from './purge-worker.service.js';

@Module({})
export class PurgeWorkerModule {
  static register(infrastructure: DynamicModule, options: DeletionOptions): DynamicModule {
    return { module: PurgeWorkerModule, imports: [infrastructure, JobsCoreModule, MessagePurgeModule,
      AccountCleanupModule.register(infrastructure, options), ...('config' in options ? [DeletionLedgerModule.register(options.config)] : [])],
    providers: [PurgeWorkerRepository, PurgeWorkerService, ...('ledger' in options ? [{ provide: DeletionLedger, useValue: options.ledger }] : [])],
    exports: [PurgeWorkerService] };
  }
}
