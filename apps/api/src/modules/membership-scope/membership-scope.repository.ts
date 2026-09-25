import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { delegatedMemberSql } from '../access/delegation-policy.js';
import { fanSharedVisibleSql } from '../access/fan-message-policy.js';
import type { Transaction } from '../../infrastructure/database/transactions.js';
const maximum = 10000;
@Injectable()
export class MembershipScopeRepository {
  async batch(tx: Transaction, userId: string, roomIds: string[], now: Date) {
    const members = await tx.prisma.room_members.findMany({ where: { user_id: userId, room_id: { in: roomIds }, status: 'ACTIVE', room: { status: 'ACTIVE' }, active_period: { is: { left_at: null } } }, take: maximum + 1,
      select: { id: true, room_id: true, role: true, active_period_id: true, acl_epoch: true, active_period: { select: { visible_from_order: true } }, user: { select: { membership_generation: true } }, room: { select: { mode: true, policy_version: true, content_epoch: true } } } });
    const grants = await tx.prisma.stream_grants.findMany({ where: { member_id: { in: members.map(m => m.id) } }, orderBy: { stream_id: 'asc' }, take: maximum + 1,
      select: { member_id: true, stream_id: true, can_read: true, can_send: true, valid_from: true, expires_at: true, revoked_at: true } });
    // ACL-before-LIMIT is required to bound aggregate work without including hidden stickers.
    const revoked = await tx.rows<{ room_id: string; id: string }>(`SELECT DISTINCT m.room_id,sc.id FROM sticker_catalog sc JOIN message_stickers ms ON ms.sticker_id=sc.id JOIN messages m ON m.id=ms.message_id AND m.room_id=ms.room_id JOIN message_streams s ON s.id=m.stream_id AND s.room_id=m.room_id JOIN rooms r ON r.id=m.room_id JOIN room_members rm ON rm.room_id=m.room_id AND rm.user_id=? JOIN membership_periods p ON p.id=rm.active_period_id AND p.member_id=rm.id AND p.room_id=rm.room_id WHERE sc.status='REVOKED' AND m.room_id IN (${roomIds.map(() => '?').join(',')}) AND m.created_order>=p.visible_from_order AND NOT EXISTS (SELECT 1 FROM actor_blocks b WHERE b.room_id=m.room_id AND b.blocker_actor_id=rm.id AND b.target_actor_id=m.sender_member_id) AND ((s.kind='ROOM_SHARED' AND ${fanSharedVisibleSql('m', 'r', 'rm')}) OR (s.kind='RESTRICTED' AND (${delegatedMemberSql('rm')} OR EXISTS (SELECT 1 FROM stream_grants g WHERE g.stream_id=s.id AND g.member_id=rm.id AND g.can_read=1 AND g.revoked_at IS NULL AND g.valid_from<=? AND (g.expires_at IS NULL OR g.expires_at>?))))) ORDER BY m.room_id,sc.id LIMIT 10001`, [userId, ...roomIds, now, now]);
    // A delegate's public actor profile is room-visible while the grant is live.
    // Include this room's role projection in every viewer's authorization epoch,
    // so expiry removes cached streamer profiles even without a write/worker.
    const delegations = await tx.prisma.room_test_grants.findMany({ where: { room_id: { in: roomIds }, member: { status: 'ACTIVE', role: 'FAN', active_period: { is: { left_at: null } }, user: { status: 'ACTIVE', admin: { is: { manage_test_access: true } } } } }, orderBy: { id: 'asc' }, take: maximum + 1, select: { id: true, room_id: true, member_id: true, period_id: true, expires_at: true, revoked_at: true, member: { select: { active_period_id: true } } } });
    if (members.length > maximum || grants.length > maximum || revoked.length > maximum || delegations.length > maximum) throw new ServiceUnavailableException();
    return { members, grants, revoked, delegations };
  }
}
