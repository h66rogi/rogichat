import { Inject, Injectable, Module } from '@nestjs/common';
import type { DynamicModule, OnApplicationShutdown, Provider } from '@nestjs/common';
import { R2MediaStore } from './adapters/media-store.js';
import { MediaSpooler } from '../../common/media/media-spool.js';
import type { MediaSettings } from '../../infrastructure/config/runtime-settings.js';
import type { MediaOptions } from './media.module.js';
import { MEDIA_STORE, MEDIA_PREFIX } from './media.tokens.js';
@Injectable()
class StoreLifecycle implements OnApplicationShutdown {
  constructor(@Inject(MEDIA_STORE) private readonly store: R2MediaStore) {}
  onApplicationShutdown(): void { this.store.close(); }
}
@Module({})
export class MediaStorageModule {
  static register(options: MediaOptions | MediaSettings, worker = false): DynamicModule {
    const providers: Provider[] = 'store' in options ? [
      { provide: MEDIA_STORE, useValue: options.store }, { provide: MEDIA_PREFIX, useValue: options.prefix }, { provide: MediaSpooler, useValue: options.spool },
    ] : [
      { provide: MEDIA_STORE, useFactory: () => new R2MediaStore(options.config) },
      { provide: MEDIA_PREFIX, useValue: options.config.prefix },
      { provide: MediaSpooler, useFactory: () => new MediaSpooler({ directory: options.scratch, capacityBytes: 64 * 1024 * 1024, ...(worker ? { maxConcurrent: 1 } : {}) }) }, StoreLifecycle,
    ];
    return { module: MediaStorageModule, providers, exports: [MEDIA_STORE, MEDIA_PREFIX, MediaSpooler] };
  }
}
