import { chatUser } from '../auth/chat-entitlement.js';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';

export const RECIPIENT_BATCH_SIZE = 100;

@Injectable()
export class PrivateRecipientsRepository {
  async candidates(tx: Transaction, roomId: string, role: 'FAN' | 'STREAMER', after: string) {
    const delegations = await tx.prisma.room_test_grants.findMany({ where: { room_id: roomId, revoked_at: null, expires_at: { gt: await tx.now() }, member: { status: 'ACTIVE', user: { admin: { is: { manage_test_access: true } } }, active_period: { is: { left_at: null } } } }, take: 10001, select: { member_id: true, period_id: true, member: { select: { active_period_id: true } } } });
    if (delegations.length > 10000) throw new ServiceUnavailableException();
    const delegates = delegations.filter(g => g.period_id === g.member.active_period_id).map(g => g.member_id);
    const rows = await tx.prisma.room_members.findMany({
      where: { room_id: roomId, id: { gt: after }, ...(role === 'FAN' ? { role, NOT: { id: { in: delegates } } } : { OR: [{ role }, { id: { in: delegates } }] }), status: 'ACTIVE',
        active_period: { is: { left_at: null } },
        user: { ...chatUser(await tx.now()), profile: { isNot: null } } },
      orderBy: { id: 'asc' }, take: RECIPIENT_BATCH_SIZE,
      select: { id: true, user_id: true, active_period: { select: { member_id: true, room_id: true, left_at: true } }, user: { select: { profile: { select: {
        nickname: true, avatar: { select: { id: true, owner_user_id: true, kind: true, room_id: true, state: true, deleted_at: true } },
      } } } } },
    });
    return rows.map(row => ({ ...row, delegated: delegates.includes(row.id) }));
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
