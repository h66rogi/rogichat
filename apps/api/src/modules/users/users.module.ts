import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { UsersCoreModule } from './users-core.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import { ProviderAvatarService } from './provider-avatar.service.js';
import { ProviderAvatarController } from './provider-avatar.controller.js';

@Module({})
export class UsersModule {
  static register(infrastructure: DynamicModule, authentication: DynamicModule): DynamicModule {
    return { module: UsersModule, imports: [infrastructure, authentication, UsersCoreModule],
      controllers: [UsersController, ProviderAvatarController], providers: [UsersService, ProviderAvatarService] };
  }
}
