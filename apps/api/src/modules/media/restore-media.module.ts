import { Inject, Injectable, Module } from '@nestjs/common';
import type { DynamicModule, OnApplicationShutdown } from '@nestjs/common';
import type { MediaConfig } from './adapters/media-store.js';
import { RestoreMediaRepository } from './restore-media.repository.js';
import { RestoreMediaService } from './restore-media.service.js';
import { RestoreMediaR2Store } from './restore-media.store.js';
import { RESTORE_MEDIA_LIMITS, RESTORE_MEDIA_MAXIMUMS, RESTORE_MEDIA_STORE } from './restore-media.types.js';
import type { RestoreMediaStore } from './restore-media.types.js';
/** Programmatic isolated drill seam, never accepted by production config/CLI parsing. */
export type RestoreMediaOptions = MediaConfig | { store: RestoreMediaStore | null } | undefined;
@Injectable()
class RestoreMediaLifecycle implements OnApplicationShutdown {
  constructor(@Inject(RESTORE_MEDIA_STORE) private readonly store: RestoreMediaStore | null) {}
  onApplicationShutdown(): void { this.store?.close?.(); }
}
/** Explicit operator composition only. Never imported into the API or worker. */
@Module({})
export class RestoreMediaModule {
  static register(infrastructure: DynamicModule, config: RestoreMediaOptions): DynamicModule {
    return { module: RestoreMediaModule, imports: [infrastructure], providers: [RestoreMediaRepository, RestoreMediaService,
      { provide: RESTORE_MEDIA_STORE, useFactory: () => config ? 'store' in config ? config.store : new RestoreMediaR2Store(config) : null },
      { provide: RESTORE_MEDIA_LIMITS, useValue: RESTORE_MEDIA_MAXIMUMS }, RestoreMediaLifecycle], exports: [RestoreMediaService] };
  }
}
export type { RestoreMediaEvidence, RestoreMediaStore } from './restore-media.types.js';
