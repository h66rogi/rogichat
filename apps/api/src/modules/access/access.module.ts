import { BlockPolicyRepository } from './block-policy.repository.js';
import { Module } from '@nestjs/common';
import { AccessService } from './access.service.js';
import { MembershipRepository } from './membership.repository.js';

@Module({ providers: [MembershipRepository, BlockPolicyRepository, AccessService], exports: [AccessService] })
export class AccessModule {}
