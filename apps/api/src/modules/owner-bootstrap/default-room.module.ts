import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { IdentityGuardModule } from '../auth/identity-guard.module.js';
import { RoomStateModule } from '../rooms/room-state.module.js';
import { readDefaultRoomConfig } from './default-room.config.js';
import type { DefaultRoomConfig } from './default-room.config.js';
import { DefaultRoomRepository } from './default-room.repository.js';
import { DEFAULT_ROOM_AUTH, DEFAULT_ROOM_CONFIG, DefaultRoomService } from './default-room.service.js';
@Module({})
export class DefaultRoomModule {
  static register(infrastructure: DynamicModule, auth: Pick<AuthConfig, 'identityGuardKey'>, initialization?: DefaultRoomConfig): DynamicModule {
    return { module: DefaultRoomModule, imports: [infrastructure, IdentityGuardModule, RoomStateModule],
      providers: [DefaultRoomRepository, DefaultRoomService, { provide: DEFAULT_ROOM_AUTH, useValue: auth },
        { provide: DEFAULT_ROOM_CONFIG, useFactory: () => initialization ?? readDefaultRoomConfig() }], exports: [DefaultRoomService] };
  }
}
