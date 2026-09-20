import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { MembershipScopeRepository } from './membership-scope.repository.js';
import { MembershipScopeService } from './membership-scope.service.js';

@Module({})
export class MembershipScopeModule {
  static register(authentication: DynamicModule): DynamicModule {
    return { module: MembershipScopeModule, imports: [authentication], providers: [MembershipScopeRepository, MembershipScopeService], exports: [MembershipScopeService] };
  }
}
