import { RoomStateModule } from '../rooms/room-state.module.js';
import { JobsCoreModule } from '../jobs/jobs-core.module.js';
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { MessagesCoreModule } from '../messages/messages-core.module.js';
import { PublicationPhotoRepository } from './publication-photo.repository.js';
import { PublicationsRepository } from './publications.repository.js';
import { PublicationsCoreService } from './publications-core.service.js';
@Module({ imports: [RoomStateModule, JobsCoreModule, AccessModule, MessagesCoreModule], providers: [PublicationPhotoRepository, PublicationsRepository, PublicationsCoreService], exports: [PublicationsCoreService] })
export class PublicationsCoreModule {}
