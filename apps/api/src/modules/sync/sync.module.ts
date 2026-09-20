import { MembershipScopeModule } from '../membership-scope/membership-scope.module.js';
import { MembershipScopeService } from '../membership-scope/membership-scope.service.js';
import { UsersCoreModule } from '../users/users-core.module.js';
import { UsersCoreService } from '../users/users-core.service.js';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { AccessModule } from '../access/access.module.js';
import { AccessService } from '../access/access.service.js';
import { MessagesCoreModule } from '../messages/messages-core.module.js';
import { MessagesQueryService } from '../messages/messages-query.service.js';
import { SyncRepository } from './sync.repository.js';
import { SyncCoreService } from './sync-core.service.js';
import { SyncService } from './sync.service.js';
import { SyncController } from './sync.controller.js';

@Module({})
export class SyncModule {
  static register(infrastructure: DynamicModule, authentication: DynamicModule): DynamicModule {
    return { module: SyncModule, imports: [infrastructure, authentication, MembershipScopeModule.register(authentication), AccessModule, MessagesCoreModule, UsersCoreModule],
      controllers: [SyncController], providers: [SyncRepository, SyncService,
        { provide: SyncCoreService, inject: [AUTH_CONFIG, SyncRepository, AccessService, MessagesQueryService, UsersCoreService, MembershipScopeService],
          useFactory: (config: AuthConfig, repository: SyncRepository, access: AccessService, messages: MessagesQueryService, users: UsersCoreService, scopes: MembershipScopeService) => new SyncCoreService(config.key, config.audience, repository, access, messages, users, scopes) }] };
  }
}
