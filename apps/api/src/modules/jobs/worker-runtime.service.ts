import { ModerationRetentionService } from '../moderation/moderation-retention.service.js';
import { AppleLifecycleService } from '../auth/apple/apple-lifecycle.service.js';
import { PurgeWorkerService } from '../deletion/purge-worker.service.js';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DATABASE } from '../../infrastructure/database/database.tokens.js';
import type { Database } from '../../infrastructure/database/database.js';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { LifecycleState } from '../../common/lifecycle/lifecycle-state.js';
import { SafeLogger } from '../../infrastructure/observability/logging.js';
import { collectExpiredRates } from '../../infrastructure/rate-limit/rate-limit.repository.js';
import { MediaWorkerService } from '../media/media-worker.service.js';
import { PublicationsCoreService } from '../publications/publications-core.service.js';
import { WorkerLoop } from './worker-loop.js';
@Injectable()
export class WorkerRuntimeService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private pending: Promise<void> | undefined;
  private previous: string | undefined;
  constructor(@Inject(DATABASE) private readonly database: Database,
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(LifecycleState) private readonly lifecycle: LifecycleState,
    @Inject(SafeLogger) private readonly logger: SafeLogger,
    @Inject(WorkerLoop) private readonly jobs: WorkerLoop,
    @Inject(PublicationsCoreService) private readonly publications: PublicationsCoreService,
    @Optional() @Inject(MediaWorkerService) private readonly media?: MediaWorkerService,
    @Optional() @Inject(PurgeWorkerService) private readonly purge?: PurgeWorkerService,
    @Optional() @Inject(ModerationRetentionService) private readonly moderation?: ModerationRetentionService,
    @Optional() @Inject(AppleLifecycleService) private readonly apple?: AppleLifecycleService) {}
  onApplicationBootstrap(): void { this.tick(); this.jobs.start(); }
  private tick = (): void => { this.pending = this.probe(); };
  private async probe(): Promise<void> {
    const result = await this.database.check();
    if (result.reason !== this.previous) { this.logger.event('readiness_changed', { reason: result.reason }); this.previous = result.reason; }
    if (result.ready) await this.transactions.write(collectExpiredRates).catch(() => {});
    if (result.ready) await this.transactions.write(tx => this.publications.recoverPhotos(tx)).catch(() => {});
    if (result.ready && this.moderation) await this.transactions.write(tx => this.moderation!.expire(tx)).catch(() => { process.stderr.write('moderation_retention_unavailable\n'); });
    if (result.ready && this.media) await this.transactions.write(tx => this.media!.recoverMedia(tx)).catch(() => {});
    if (result.ready && this.purge) await this.purge.recover().then(counts => {
      if (counts.unavailable) process.stderr.write('purge_recovery_unavailable\n');
    }, () => { process.stderr.write('purge_recovery_unavailable\n'); });
    if (result.ready && this.apple) await this.apple.revokeStep().then(result => {
      if (result.unavailable) process.stderr.write('apple_revocation_unavailable\n');
    }, () => { process.stderr.write('apple_revocation_unavailable\n'); });
    if (!this.lifecycle.draining) this.timer = setTimeout(this.tick, 5000);
  }
  async onModuleDestroy(): Promise<void> {
    this.lifecycle.draining = true;
    clearTimeout(this.timer);
    await this.jobs.stop();
    await this.pending;
  }
}
