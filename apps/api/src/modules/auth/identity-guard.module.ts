import { Module } from '@nestjs/common';
import { IdentityGuardRepository } from './identity-guard.repository.js';
import { IdentityGuardService } from './identity-guard.service.js';

@Module({ providers: [IdentityGuardRepository, IdentityGuardService], exports: [IdentityGuardService] })
export class IdentityGuardModule {}
