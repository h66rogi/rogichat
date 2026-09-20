import { Inject, Injectable, Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { JobsCoreModule } from '../jobs/jobs-core.module.js';
import { JobsCoreService } from '../jobs/jobs-core.service.js';
import type { JobLease } from '../jobs/jobs.policy.js';
import { JobFailure } from '../jobs/jobs.service.js';
import { PushEnqueueModule, PushEnqueueService } from './push-enqueue.service.js';
import { NotificationFanoutRepository } from './notification-fanout.repository.js';

const FANOUT_AUDIENCE = Symbol('FANOUT_AUDIENCE');
class FanoutLeaseLost extends Error {}

@Injectable()
export class NotificationFanoutService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(NotificationFanoutRepository) private readonly repository: NotificationFanoutRepository,
    @Inject(PushEnqueueService) private readonly enqueue: PushEnqueueService,
    @Inject(JobsCoreService) private readonly jobs: JobsCoreService,
    @Inject(FANOUT_AUDIENCE) private readonly audience: string) {}

  async consume(lease: JobLease): Promise<'completed' | 'lease_lost'> {
    if (lease.purpose !== 'PUSH' || lease.roomId !== null || !lease.resourceId) throw new JobFailure('INVALID_RESOURCE', true);
    let after: string | undefined;
    try {
      for (;;) {
        const page = await this.transactions.read(tx => this.repository.candidates(tx, lease.resourceId!, this.audience, after));
        if (!page.length) break;
        for (const subscription of page) {
          await this.transactions.write(async tx => {
            await this.enqueue.enqueue(tx, { messageId: lease.resourceId!, subscriptionId: subscription.id });
            if (!await this.repository.fence(tx, lease)) throw new FanoutLeaseLost();
          });
        }
        after = page.at(-1)!.id;
      }
      return await this.transactions.write(async tx => {
        if (!await this.repository.fence(tx, lease)) return false;
        return this.jobs.complete(tx, lease);
      }) ? 'completed' : 'lease_lost';
    } catch (error) {
      if (error instanceof FanoutLeaseLost) return 'lease_lost';
      throw error;
    }
  }
}

@Module({})
export class NotificationFanoutModule {
  static register(infrastructure: DynamicModule, audience: string): DynamicModule {
    return { module: NotificationFanoutModule, imports: [infrastructure, JobsCoreModule, PushEnqueueModule],
      providers: [NotificationFanoutRepository, NotificationFanoutService, { provide: FANOUT_AUDIENCE, useValue: audience }],
      exports: [NotificationFanoutService] };
  }
}
