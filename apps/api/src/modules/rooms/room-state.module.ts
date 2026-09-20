import { Module } from '@nestjs/common';
import { RoomStateRepository } from './room-state.repository.js';
import { RoomStateService } from './room-state.service.js';
@Module({ providers: [RoomStateRepository, RoomStateService], exports: [RoomStateService] })
export class RoomStateModule {}
