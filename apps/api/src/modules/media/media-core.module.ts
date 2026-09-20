import { Module } from '@nestjs/common';
import { UsersCoreModule } from '../users/users-core.module.js';
import { AccessModule } from '../access/access.module.js';
import { MessagesCoreModule } from '../messages/messages-core.module.js';
import { JobsCoreModule } from '../jobs/jobs-core.module.js';
import { RoomMediaCoreModule } from './room-media-core.module.js';
import { MediaRepository } from './media.repository.js';
import { MediaCoreService } from './media-core.service.js';
@Module({ imports: [AccessModule, MessagesCoreModule, JobsCoreModule, RoomMediaCoreModule, UsersCoreModule], providers: [MediaRepository, MediaCoreService], exports: [MediaCoreService] })
export class MediaCoreModule {}
