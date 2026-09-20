import { AppleRestoreRepository } from './apple-restore.repository.js';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { AuthConfig } from '../../../infrastructure/config/auth-config.js';
import { Transactions } from '../../../infrastructure/database/transactions.js';
import { IdentityGuardModule } from '../identity-guard.module.js';
import { IdentityGuardService } from '../identity-guard.service.js';
import { AppleLifecycleRepository } from './apple-lifecycle.repository.js';
import { AppleLifecycleService } from './apple-lifecycle.service.js';
import { AppleProvider } from './apple-provider.js';
import { AppleRepository } from './apple.repository.js';

@Module({})
export class AppleLifecycleModule {
  static register(infrastructure: DynamicModule, config?: AuthConfig, providerOverride?: AppleProvider): DynamicModule {
    return { module: AppleLifecycleModule, imports: [infrastructure, IdentityGuardModule], providers: [AppleRepository, AppleLifecycleRepository, AppleRestoreRepository,
      { provide: AppleProvider, useFactory: () => providerOverride ?? new AppleProvider(config?.apple) },
      { provide: AppleLifecycleService, inject: [Transactions, AppleLifecycleRepository, AppleRepository, AppleProvider, IdentityGuardService, AppleRestoreRepository],
        useFactory: (transactions: Transactions, repository: AppleLifecycleRepository, identities: AppleRepository, provider: AppleProvider, guards: IdentityGuardService, restore: AppleRestoreRepository) => new AppleLifecycleService(transactions, repository, identities, provider, guards, restore, config) },
    ], exports: [AppleLifecycleService, AppleProvider] };
  }
}
