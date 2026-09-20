import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { MessagesCoreModule } from '../messages/messages-core.module.js';
import { RoomStateModule } from '../rooms/room-state.module.js';
import { ModerationController } from './moderation.controller.js';
import { ModerationService } from './moderation.service.js';
import { ModerationCoreService } from './moderation-core.service.js';
import { ModerationRepository } from './moderation.repository.js';
@Module({})
export class ModerationModule {
  static register(infrastructure: DynamicModule, auth: DynamicModule): DynamicModule {
    return { module: ModerationModule, imports: [infrastructure, auth, AccessModule, MessagesCoreModule, RoomStateModule], controllers: [ModerationController], providers: [ModerationService, ModerationCoreService, ModerationRepository] };
  }
}
