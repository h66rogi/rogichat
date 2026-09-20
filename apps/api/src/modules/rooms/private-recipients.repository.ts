import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';

export const RECIPIENT_BATCH_SIZE = 100;

@Injectable()
export class PrivateRecipientsRepository {
  candidates(tx: Transaction, roomId: string, role: 'FAN' | 'STREAMER', after: string) {
    return tx.prisma.room_members.findMany({
      where: { room_id: roomId, id: { gt: after }, role, status: 'ACTIVE',
        active_period: { is: { left_at: null } },
        user: { status: 'ACTIVE', soop: { is: { status: 'VERIFIED' } }, profile: { isNot: null } } },
      orderBy: { id: 'asc' }, take: RECIPIENT_BATCH_SIZE,
      select: { id: true, user_id: true, active_period: { select: { member_id: true, room_id: true, left_at: true } }, user: { select: { profile: { select: {
        nickname: true, avatar: { select: { id: true, owner_user_id: true, kind: true, room_id: true, state: true, deleted_at: true } },
      } } } } },
    });
  }

  pairs(tx: Transaction, roomId: string, viewerId: string, candidateIds: string[], now: Date) {
    // Exactly the pair looked up by sendStream, with both participant grants in
    // this snapshot. Batched relations avoid per-recipient authorization queries.
    return tx.prisma.stream_pairs.findMany({
      where: { room_id: roomId, OR: [
        { left_member_id: viewerId, right_member_id: { in: candidateIds.filter(id => id > viewerId) } },
        { right_member_id: viewerId, left_member_id: { in: candidateIds.filter(id => id < viewerId) } },
      ] },
      select: { left_member_id: true, right_member_id: true,
        stream: { select: { room_id: true, kind: true, grants: {
          where: { room_id: roomId, member_id: { in: [viewerId, ...candidateIds] }, revoked_at: null,
            valid_from: { lte: now }, OR: [{ expires_at: null }, { expires_at: { gt: now } }] },
          select: { member_id: true, can_read: true, can_send: true },
        } } },
      },
    });
  }
}
