import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { Jobs } from './jobs.service.js';
import { JobsCoreService } from './jobs-core.service.js';
import { JobsRepository } from './jobs.repository.js';
import type { JobConsumer } from './jobs.policy.js';
@Module({})
export class JobsModule {
  static register(infrastructure: DynamicModule, consumer: JobConsumer): DynamicModule {
    return { module: JobsModule, imports: [infrastructure], providers: [JobsCoreService, JobsRepository,
      { provide: Jobs, inject: [Transactions, JobsRepository, JobsCoreService], useFactory: (transactions: Transactions, repository: JobsRepository, core: JobsCoreService) => new Jobs(transactions, consumer, repository, core) }], exports: [Jobs] };
  }
}
