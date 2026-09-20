import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { Database } from './database.js';
import type { LifecycleState } from './common/lifecycle/lifecycle-state.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';

@Module({})
export class WorkerModule {
  static register(database: Database, lifecycle: LifecycleState): DynamicModule {
    return { module: WorkerModule, imports: [DatabaseModule.register({ database, lifecycle, externallyOwned: true })] };
  }
}
