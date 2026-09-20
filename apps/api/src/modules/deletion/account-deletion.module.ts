import { IdentityGuardModule } from '../auth/identity-guard.module.js';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DeletionModule } from './deletion.module.js';
import type { DeletionOptions } from './deletion.module.js';
import { AccountDeletionController } from './account-deletion.controller.js';
import { AccountDeletionService } from './account-deletion.service.js';
import { AccountDeletionRepository } from './account-deletion.repository.js';

@Module({})
export class AccountDeletionModule {
  static register(infrastructure: DynamicModule, authentication: DynamicModule, options?: DeletionOptions): DynamicModule {
    return { module: AccountDeletionModule, imports: [IdentityGuardModule, infrastructure, authentication, DeletionModule.register(infrastructure, options)],
      controllers: [AccountDeletionController], providers: [AccountDeletionService, AccountDeletionRepository] };
  }
}
