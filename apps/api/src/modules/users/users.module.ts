import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { UsersCoreModule } from './users-core.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({})
export class UsersModule {
  static register(infrastructure: DynamicModule, authentication: DynamicModule): DynamicModule {
    return { module: UsersModule, imports: [infrastructure, authentication, UsersCoreModule],
      controllers: [UsersController], providers: [UsersService] };
  }
}
