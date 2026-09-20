import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DeletionBacklogRepository } from './deletion-backlog.repository.js';
import { DeletionBacklogService } from './deletion-backlog.service.js';

@Module({})
export class DeletionBacklogModule {
  static register(infrastructure: DynamicModule): DynamicModule {
    return { module: DeletionBacklogModule, imports: [infrastructure],
      providers: [DeletionBacklogRepository, DeletionBacklogService], exports: [DeletionBacklogService] };
  }
}
