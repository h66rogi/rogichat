import { AppleLifecycleModule } from '../auth/apple/apple-lifecycle.module.js';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ReadStateCoreModule } from '../read-state/read-state-core.module.js';
import { DeletionLedger } from './deletion-ledger.js';
import { DeletionLedgerModule } from './deletion-ledger.module.js';
import type { DeletionOptions } from './deletion.module.js';
import { AccountCleanupService } from './account-cleanup.service.js';
import { AccountCleanupRepository } from './account-cleanup.repository.js';

@Module({})
export class AccountCleanupModule {
  static register(infrastructure: DynamicModule, options: DeletionOptions): DynamicModule {
    return { module: AccountCleanupModule, imports: [infrastructure, ReadStateCoreModule, NotificationsModule, AppleLifecycleModule.register(infrastructure),
      ...('config' in options ? [DeletionLedgerModule.register(options.config)] : [])],
    providers: [AccountCleanupRepository, AccountCleanupService,
      ...('ledger' in options ? [{ provide: DeletionLedger, useValue: options.ledger }] : [])],
    exports: [AccountCleanupService] };
  }
}
