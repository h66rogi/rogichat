import { Transactions } from '../../infrastructure/database/transactions.js';
import { DeletionReplayRepository } from './deletion-replay.repository.js';
import { IdentityGuardModule } from '../auth/identity-guard.module.js';
import { AccountDeletionRepository } from './account-deletion.repository.js';
import { DeletionRepository } from './deletion.repository.js';
import { Inject, Injectable, Module } from '@nestjs/common';
import type { DynamicModule, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { DeletionLedger } from './deletion-ledger.js';
import { DeletionLedgerModule } from './deletion-ledger.module.js';
import type { DeletionLedgerConfig } from './adapters/r2-deletion-ledger.js';
import { DeletionApplyService } from './deletion-apply.service.js';
import { DeletionReconciler } from './deletion-reconciler.js';
import { MessagesCoreModule } from '../messages/messages-core.module.js';

export type DeletionOptions = { config: DeletionLedgerConfig } | { ledger: DeletionLedger };
@Injectable()
class ReplayLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: ReturnType<typeof setTimeout>;
  private readonly abort = new AbortController();
  private pending?: Promise<void>;
  constructor(@Inject(DeletionReconciler) private readonly replay: DeletionReconciler) {}
  onApplicationBootstrap() { this.schedule(0); }
  private schedule(ms: number) {
    this.timer = setTimeout(() => {
      this.pending = this.replay.tick(this.abort.signal).then(result => {
        if (result?.discoveryFailed || result?.failed || result?.invalid) process.stderr.write('deletion_replay_unavailable\n');
      }, () => {
        // Fixed diagnostic only: never log ledger keys, contents or SDK exceptions.
        process.stderr.write('deletion_replay_unavailable\n');
      }).finally(() => { if (!this.abort.signal.aborted) this.schedule(5000); });
    }, ms);
    this.timer.unref();
  }
  async onApplicationShutdown() { this.abort.abort(); clearTimeout(this.timer); await this.pending; }
}
@Module({})
export class DeletionModule {
  static register(infrastructure: DynamicModule, options?: DeletionOptions, replay = false): DynamicModule {
    return { module: DeletionModule, imports: [IdentityGuardModule, infrastructure, MessagesCoreModule,
      ...(options && 'config' in options ? [DeletionLedgerModule.register(options.config)] : [])],
    providers: [DeletionRepository, AccountDeletionRepository, DeletionApplyService,
      ...(!options || 'ledger' in options ? [{ provide: DeletionLedger, useValue: options?.ledger ?? null }] : []),
      ...(replay && options ? [DeletionReplayRepository, { provide: DeletionReconciler, inject: [DeletionLedger, DeletionApplyService, Transactions, DeletionReplayRepository],
        useFactory: (ledger: DeletionLedger, apply: DeletionApplyService, transactions: Transactions, repository: DeletionReplayRepository) => new DeletionReconciler(ledger, apply, transactions, repository) }, ReplayLifecycle] : [])],
    exports: [DeletionApplyService, ...(options && 'config' in options ? [DeletionLedgerModule] : [DeletionLedger])] };
  }
}
