import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { RestoreMediaModule } from '../media/restore-media.module.js';
import type { RestoreMediaOptions } from '../media/restore-media.module.js';
import { AppleLifecycleModule } from '../auth/apple/apple-lifecycle.module.js';
import { DeletionModule } from '../deletion/deletion.module.js';
import type { DeletionOptions } from '../deletion/deletion.module.js';
import { RestoreGateRepository } from './restore-gate.repository.js';
import { RestoreGateService, RESTORE_SETTINGS } from './restore-gate.service.js';
import type { RestoreSettings } from './restore-gate.service.js';

// One-shot operator graph only. Never imported by API/worker composition.
@Module({})
export class RestoreGateModule {
  static register(infrastructure: DynamicModule, options: RestoreSettings & { ledger: DeletionOptions; media: RestoreMediaOptions }): DynamicModule {
    return { module: RestoreGateModule,
      imports: [infrastructure, RestoreMediaModule.register(infrastructure, options.media), DeletionModule.register(infrastructure, options.ledger, false), AppleLifecycleModule.register(infrastructure, options.auth)],
      providers: [RestoreGateRepository, RestoreGateService, { provide: RESTORE_SETTINGS, useValue: options }], exports: [RestoreGateService] };
  }
}
