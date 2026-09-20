import { RoomMediaCoreModule } from '../media/room-media-core.module.js';
import { RoomStateModule } from '../rooms/room-state.module.js';
import { JobsCoreModule } from '../jobs/jobs-core.module.js';
import { MessagesQueryRepository } from './messages-query.repository.js';
import { MessagesQueryService } from './messages-query.service.js';
import { Module } from '@nestjs/common';
import { MessagesCoreService } from './messages-core.service.js';
import { MessagesRepository } from './messages.repository.js';
import { AccessModule } from '../access/access.module.js';

// Separate entrypoint: worker imports do not load HTTP controllers or authentication providers.
@Module({ imports: [RoomMediaCoreModule, RoomStateModule, JobsCoreModule, AccessModule], providers: [MessagesRepository, MessagesCoreService, MessagesQueryRepository, MessagesQueryService], exports: [MessagesCoreService, MessagesQueryService] })
export class MessagesCoreModule {}
