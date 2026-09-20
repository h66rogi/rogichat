import { RoomStateModule } from '../rooms/room-state.module.js';
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { MessagesCoreModule } from '../messages/messages-core.module.js';
import { ReactionsRepository } from './reactions.repository.js';
import { ReactionsCoreService } from './reactions-core.service.js';
@Module({ imports: [RoomStateModule, AccessModule, MessagesCoreModule], providers: [ReactionsRepository, ReactionsCoreService], exports: [ReactionsCoreService] })
export class ReactionsCoreModule {}
