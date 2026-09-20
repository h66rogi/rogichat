import { RoomStateModule } from './room-state.module.js';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { RoomsController } from './rooms.controller.js';
import { RoomsService } from './rooms.service.js';
import { RoomsCoreService } from './rooms-core.service.js';
import { RoomsRepository } from './rooms.repository.js';
import { RoomMediaCoreModule } from '../media/room-media-core.module.js';

@Module({})
export class RoomsModule {
  static register(infrastructure: DynamicModule, authentication: DynamicModule): DynamicModule {
    return { module: RoomsModule, imports: [infrastructure, authentication, RoomStateModule, RoomMediaCoreModule],
      controllers: [RoomsController], providers: [RoomsRepository, RoomsCoreService, RoomsService] };
  }
}
