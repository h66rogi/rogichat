import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { MediaSettings } from '../../infrastructure/config/runtime-settings.js';
import { AccessModule } from '../access/access.module.js';
import { JobsCoreModule } from '../jobs/jobs-core.module.js';
import { MediaSpooler } from '../../common/media/media-spool.js';
import { UnixImageDecoder } from './adapters/media-decoder-client.js';
import { MediaStorageModule } from './media-storage.module.js';
import { MediaWorkerRepository } from './media-worker.repository.js';
import { MediaWorkerService } from './media-worker.service.js';
import { MEDIA_DECODER } from './media.tokens.js';
@Module({})
export class MediaWorkerModule {
  static register(infrastructure: DynamicModule, settings: MediaSettings): DynamicModule {
    return { module: MediaWorkerModule, imports: [infrastructure, AccessModule, JobsCoreModule, MediaStorageModule.register(settings, true)],
      providers: [MediaWorkerRepository, MediaWorkerService,
        { provide: MEDIA_DECODER, inject: [MediaSpooler], useFactory: (spool: MediaSpooler) => new UnixImageDecoder(settings.decoderSocket!, spool) }], exports: [MediaWorkerService] };
  }
}
