import { MediaWriteProofModule } from './media-write-proof.module.js';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { MediaStore } from './adapters/media-store.js';
import { MediaSpooler } from '../../common/media/media-spool.js';
import { MediaCoreModule } from './media-core.module.js';
import { MediaService } from './media.service.js';
import { MediaController } from './media.controller.js';
import { MediaStorageModule } from './media-storage.module.js';
import type { MediaSettings } from '../../infrastructure/config/runtime-settings.js';
import { StickersModule } from '../stickers/stickers.module.js';
export interface MediaOptions { store: MediaStore; prefix: string; spool: MediaSpooler }
@Module({})
export class MediaModule {
  static register(infrastructure: DynamicModule, authentication: DynamicModule, options: MediaOptions | MediaSettings): DynamicModule {
    return { module: MediaModule, imports: [infrastructure, MediaWriteProofModule, authentication, MediaCoreModule, MediaStorageModule.register(options), StickersModule.register(infrastructure, authentication)], controllers: [MediaController], providers: [MediaService] };
  }
}
