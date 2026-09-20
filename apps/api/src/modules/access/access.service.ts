import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { uuid } from '../../common/validation/identifier.js';
import { ApiError } from '../auth/auth-primitives.js';
import { MembershipRepository } from './membership.repository.js';

@Injectable()
export class AccessService {
  constructor(@Inject(MembershipRepository) private readonly memberships: MembershipRepository) {}
  async requireActiveMember(tx: Transaction, roomId: string, userId: string) {
    const member = await this.memberships.findActive(tx, uuid(roomId), userId);
    if (!member) throw new ApiError('NOT_FOUND', 404);
    return member;
  }
}
