import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AdminRepository } from './admin.repository.js';
import { AdminService } from './admin.service.js';
import { AdminController } from './admin.controller.js';
@Module({})
export class AdminModule {
  static register(infrastructure: DynamicModule, authentication: DynamicModule): DynamicModule {
    return { module: AdminModule, imports: [infrastructure, authentication, AccessModule], controllers: [AdminController], providers: [AdminRepository, AdminService] };
  }
}
