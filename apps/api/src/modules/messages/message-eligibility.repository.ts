import { chatUser } from '../auth/chat-entitlement.js';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';

// Read-only, bounded to the already-authorized live page. No hidden transaction,
// locks, provider I/O or cached authority; all facts use the caller's snapshot.
@Injectable()
export class MessageEligibilityRepository {
  blocks(tx: Transaction, roomId: string, actorId: string) {
    return tx.prisma.actor_blocks.findMany({ where: { room_id: roomId, OR: [{ blocker_actor_id: actorId }, { target_actor_id: actorId }] }, select: { blocker_actor_id: true, target_actor_id: true } });
  }
  messages(tx: Transaction, roomId: string, ids: string[]) {
    return tx.prisma.messages.findMany({ where: { room_id: roomId, id: { in: ids } }, select: {
      id: true, room_id: true, sender_member_id: true, deletion_root_id: true, content_kind: true, text_content: true,
      sender: { select: { user_id: true, role: true } },
      stream: { select: { id: true, room_id: true, kind: true, pair: { select: {
        room_id: true, stream_id: true, left_member_id: true, right_member_id: true,
      } } } },
    } });
  }
  async members(tx: Transaction, roomId: string, ids: string[]) {
    const now = await tx.now();
    const rows = await tx.prisma.room_members.findMany({ where: { room_id: roomId, id: { in: ids }, status: 'ACTIVE',
      room: { status: 'ACTIVE' }, user: { ...chatUser(await tx.now()) },
      active_period: { is: { room_id: roomId, left_at: null } },
    }, select: { id: true, user_id: true, role: true, active_period_id: true,
      active_period: { select: { member_id: true, visible_from_order: true } },
      room: { select: { mode: true, owner_member_id: true } },
    } });
    const grants = rows.length ? await tx.prisma.room_test_grants.findMany({ where: { room_id: roomId, revoked_at: null, expires_at: { gt: now },
      OR: rows.map(row => ({ member_id: row.id, period_id: row.active_period_id! })),
      member: { role: 'FAN', room: { mode: 'FAN' }, user: { admin: { is: { manage_test_access: true } } } } }, take: 10001, select: { member_id: true } }) : [];
    if (grants.length > 10000) throw new ServiceUnavailableException();
    const delegated = new Set(grants.map(grant => grant.member_id));
    return rows.map(row => ({ ...row, role: delegated.has(row.id) ? 'STREAMER' as const : row.role, delegated: delegated.has(row.id) }));
  }
  pairs(tx: Transaction, roomId: string, viewerId: string, targets: string[]) {
    return tx.prisma.stream_pairs.findMany({ where: { room_id: roomId, stream: { room_id: roomId, kind: 'RESTRICTED' }, OR: [
      { left_member_id: viewerId, right_member_id: { in: targets } },
      { right_member_id: viewerId, left_member_id: { in: targets } },
    ] }, select: { room_id: true, stream_id: true, left_member_id: true, right_member_id: true } });
  }
  async grants(tx: Transaction, roomId: string, streamIds: string[], members: string[], capturedNow?: Date) {
    const now = capturedNow ?? await tx.now();
    return tx.prisma.stream_grants.findMany({ where: { room_id: roomId, stream_id: { in: streamIds }, member_id: { in: members },
      revoked_at: null, valid_from: { lte: now }, OR: [{ expires_at: null }, { expires_at: { gt: now } }],
    }, select: { stream_id: true, member_id: true, can_read: true, can_send: true } });
  }
}
