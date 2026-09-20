import { RoomMediaCoreModule } from '../media/room-media-core.module.js';
import { JobsCoreModule } from '../jobs/jobs-core.module.js';
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { StickersRepository } from './stickers.repository.js';
import { StickersCoreService } from './stickers-core.service.js';

@Module({ imports: [RoomMediaCoreModule, JobsCoreModule, AccessModule], providers: [StickersRepository, StickersCoreService], exports: [StickersCoreService] })
export class StickersCoreModule {}
