import { BlockPolicyRepository } from './block-policy.repository.js';
import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { uuid } from '../../common/validation/identifier.js';
import { ApiError } from '../auth/auth-primitives.js';
import type { RoomSendOwner } from './membership.repository.js';
import { MembershipRepository } from './membership.repository.js';

@Injectable()
export class AccessService {
  constructor(@Inject(MembershipRepository) private readonly memberships: MembershipRepository, @Inject(BlockPolicyRepository) private readonly blocks: BlockPolicyRepository) {}
  blockedActors(tx: Transaction, roomId: string, actorId: string, bilateral = false) {
    return this.blocks.targets(tx, roomId, actorId, bilateral);
  }

  async actorBlocked(tx: Transaction, roomId: string, actorId: string, targetId: string, bilateral = false) {
    return (await this.blockedActors(tx, roomId, actorId, bilateral)).includes(targetId);
  }

  lockRoomSendOwner(tx: Transaction, roomId: string) {
    return this.memberships.lockRoomSendOwner(tx, uuid(roomId));
  }

  async requireRoomSendOwner(tx: Transaction, roomId: string, ownerMemberId: string | null, owner: RoomSendOwner | undefined) {
    if (!ownerMemberId || !owner) throw new ApiError('NOT_FOUND', 404);
    if (ownerMemberId !== owner.memberId) throw new ApiError('CONFLICT', 409);
    if (['DELETING', 'DELETED'].includes(owner.status) || !await this.memberships.currentRoomSendOwner(tx, roomId, owner)) throw new ApiError('NOT_FOUND', 404);
  }

  async requireActiveMember(tx: Transaction, roomId: string, userId: string) {
    const member = await this.memberships.findActive(tx, uuid(roomId), userId);
    if (!member) throw new ApiError('NOT_FOUND', 404);
    return member;
  }
}
