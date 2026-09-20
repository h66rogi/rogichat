import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { RoomMediaRepository } from './room-media.repository.js';
import { RoomMediaCoreService } from './room-media-core.service.js';
@Module({ imports: [AccessModule], providers: [RoomMediaRepository, RoomMediaCoreService], exports: [RoomMediaCoreService] })
export class RoomMediaCoreModule {}
