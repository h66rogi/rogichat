import { DeletionModule } from './modules/deletion/deletion.module.js';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { Database } from './infrastructure/database/database.js';
import { DATABASE } from './infrastructure/database/database.tokens.js';
import { Transactions } from './infrastructure/database/transactions.js';
import { LifecycleState } from './common/lifecycle/lifecycle-state.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import type { RuntimeSettings } from './infrastructure/config/runtime-settings.js';
import { SafeLogger } from './infrastructure/observability/logging.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { Jobs } from './modules/jobs/jobs.service.js';
import { WorkerLoop } from './modules/jobs/worker-loop.js';
import { WorkerRuntimeService } from './modules/jobs/worker-runtime.service.js';
import { PublicationsCoreModule } from './modules/publications/publications-core.module.js';
import { PublicationsCoreService } from './modules/publications/publications-core.service.js';
import { MediaWorkerModule } from './modules/media/media-worker.module.js';
import { MediaCopyService } from './modules/media/media-copy.service.js';
import { MediaWorkerService } from './modules/media/media-worker.service.js';
import { PushModule, PushTransportModule } from './modules/notifications/push-module.js';
import { PushDeliveryService } from './modules/notifications/push-delivery.service.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { NotificationFanoutModule, NotificationFanoutService } from './modules/notifications/notification-fanout.service.js';

@Module({})
export class WorkerModule {
  static register(database: Database, lifecycle: LifecycleState): DynamicModule {
    return { module: WorkerModule, imports: [DatabaseModule.register({ database, lifecycle, externallyOwned: true })] };
  }
  static production(settings: RuntimeSettings): DynamicModule {
    const infrastructure = DatabaseModule.register({ config: settings.config });
    const push = settings.push ?? { audience: `rogi-${settings.config.environment}`, vapid: null };
    const transport = PushTransportModule.register(push);
    return { module: WorkerModule, imports: [infrastructure, JobsModule.register(infrastructure, 'worker'), PublicationsCoreModule, DeletionModule.register(infrastructure, settings.deletion, true),
      PushModule.register(infrastructure, NotificationsModule, transport), NotificationFanoutModule.register(infrastructure, push.audience),
      ...(settings.media ? [MediaWorkerModule.register(infrastructure, settings.media)] : [])], providers: [
      { provide: SafeLogger, useFactory: () => new SafeLogger('worker') }, WorkerRuntimeService,
      { provide: WorkerLoop, inject: [Jobs, LifecycleState, Transactions, PublicationsCoreService, DATABASE, PushDeliveryService, NotificationFanoutService, ...(settings.media ? [MediaWorkerService, MediaCopyService] : [])],
        useFactory: (jobs: Jobs, lifecycle: LifecycleState, transactions: Transactions, publications: PublicationsCoreService, database: Database, delivery: PushDeliveryService, fanout: NotificationFanoutService, media?: MediaWorkerService, copies?: MediaCopyService) => new WorkerLoop(jobs, lifecycle,
          { PUBLICATION: lease => copies ? copies.processPublication(lease) : publications.publishText(transactions, lease), PUSH: lease => lease.roomId === null ? fanout.consume(lease) : delivery.consume(lease), ...(media ? { MEDIA: media.processMedia.bind(media) } : {}) },
          { ready: async () => (await database.check()).ready, leaseMs: settings.media ? 300000 : 30000 }) },
    ] };
  }
}
