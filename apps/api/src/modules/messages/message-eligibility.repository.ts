import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';

// Read-only, bounded to the already-authorized live page. No hidden transaction,
// locks, provider I/O or cached authority; all facts use the caller's snapshot.
@Injectable()
export class MessageEligibilityRepository {
  messages(tx: Transaction, roomId: string, ids: string[]) {
    return tx.prisma.messages.findMany({ where: { room_id: roomId, id: { in: ids } }, select: {
      id: true, room_id: true, sender_member_id: true, deletion_root_id: true, content_kind: true, text_content: true,
      sender: { select: { user_id: true } },
      stream: { select: { id: true, room_id: true, kind: true, pair: { select: {
        room_id: true, stream_id: true, left_member_id: true, right_member_id: true,
      } } } },
    } });
  }
  members(tx: Transaction, roomId: string, ids: string[]) {
    return tx.prisma.room_members.findMany({ where: { room_id: roomId, id: { in: ids }, status: 'ACTIVE',
      room: { status: 'ACTIVE' }, user: { status: 'ACTIVE', soop: { is: { status: 'VERIFIED' } } },
      active_period: { is: { room_id: roomId, left_at: null } },
    }, select: { id: true, user_id: true, role: true, active_period_id: true,
      active_period: { select: { member_id: true, visible_from_order: true } },
      room: { select: { mode: true, owner_member_id: true } },
    } });
  }
  pairs(tx: Transaction, roomId: string, viewerId: string, targets: string[]) {
    return tx.prisma.stream_pairs.findMany({ where: { room_id: roomId, stream: { room_id: roomId, kind: 'RESTRICTED' }, OR: [
      { left_member_id: viewerId, right_member_id: { in: targets } },
      { right_member_id: viewerId, left_member_id: { in: targets } },
    ] }, select: { room_id: true, stream_id: true, left_member_id: true, right_member_id: true } });
  }
  async grants(tx: Transaction, roomId: string, streamIds: string[], members: string[]) {
    const now = await tx.now();
    return tx.prisma.stream_grants.findMany({ where: { room_id: roomId, stream_id: { in: streamIds }, member_id: { in: members },
      revoked_at: null, valid_from: { lte: now }, OR: [{ expires_at: null }, { expires_at: { gt: now } }],
    }, select: { stream_id: true, member_id: true, can_read: true, can_send: true } });
  }
}
