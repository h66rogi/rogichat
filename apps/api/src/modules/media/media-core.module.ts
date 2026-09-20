import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { MessagesCoreModule } from '../messages/messages-core.module.js';
import { JobsCoreModule } from '../jobs/jobs-core.module.js';
import { RoomMediaCoreModule } from './room-media-core.module.js';
import { MediaRepository } from './media.repository.js';
import { MediaCoreService } from './media-core.service.js';
@Module({ imports: [AccessModule, MessagesCoreModule, JobsCoreModule, RoomMediaCoreModule], providers: [MediaRepository, MediaCoreService], exports: [MediaCoreService] })
export class MediaCoreModule {}
