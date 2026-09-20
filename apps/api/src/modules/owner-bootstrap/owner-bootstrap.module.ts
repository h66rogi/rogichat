import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { IdentityGuardModule } from '../auth/identity-guard.module.js';
import { RoomStateModule } from '../rooms/room-state.module.js';
import { OwnerBootstrapRepository } from './owner-bootstrap.repository.js';
import { OWNER_BOOTSTRAP_CONFIG, OwnerBootstrapService } from './owner-bootstrap.service.js';
import type { OwnerBootstrapConfig } from './owner-bootstrap.service.js';

@Module({})
export class OwnerBootstrapModule {
  static register(infrastructure: DynamicModule, config: OwnerBootstrapConfig): DynamicModule {
    return { module: OwnerBootstrapModule, imports: [infrastructure, IdentityGuardModule, RoomStateModule],
      providers: [OwnerBootstrapRepository, OwnerBootstrapService, { provide: OWNER_BOOTSTRAP_CONFIG, useValue: config }],
      exports: [OwnerBootstrapService] };
  }
}
