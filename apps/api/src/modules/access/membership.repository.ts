import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';

export interface ActiveMember {
  id: string; room_id: string; user_id: string; role: 'FAN' | 'MEMBER' | 'STREAMER';
  mode: 'FAN' | 'GROUP'; active_period_id: string; visible_from_order: string;
  temporaryGrantId?: string; temporaryExpiresAt?: Date;
}

export interface RoomSendOwner { memberId: string; userId: string; status: string }

@Injectable()
export class MembershipRepository {
  async lockRoomSendOwner(tx: Transaction, roomId: string): Promise<RoomSendOwner | undefined> {
    // Discovery only: RR may return an old owner. Revalidate under the room lock
    // before admitting a NEW command; never use this snapshot as authority.
    const room = await tx.prisma.rooms.findUnique({ where: { id: roomId }, select: { owner: { select: { id: true, user_id: true } } } });
    if (!room?.owner) return undefined;
    // Prisma has no locking read. One bound PK lock serializes with account
    // status changes, before room/member locks, through the message commit.
    const [account] = await tx.rows<{ status: string }>('SELECT status FROM users WHERE id=? FOR UPDATE', [room.owner.user_id]);
    return account ? { memberId: room.owner.id, userId: room.owner.user_id, status: account.status } : undefined;
  }

  async currentRoomSendOwner(tx: Transaction, roomId: string, owner: RoomSendOwner): Promise<boolean> {
    // Current membership/period, not discovery snapshot; room is already locked.
    const member = await this.findActive(tx, roomId, owner.userId);
    return member?.id === owner.memberId && member.role === 'STREAMER';
  }

  async findActive(tx: Transaction, roomId: string, userId: string): Promise<ActiveMember | undefined> {
    if (tx.writable) {
      const member = (await tx.rows<ActiveMember>(`SELECT m.id,m.room_id,m.user_id,m.role,m.active_period_id,r.mode,p.visible_from_order FROM room_members m JOIN rooms r ON r.id=m.room_id JOIN membership_periods p ON p.id=m.active_period_id AND p.room_id=m.room_id AND p.member_id=m.id WHERE m.room_id=? AND m.user_id=? AND m.status='ACTIVE' AND r.status='ACTIVE' AND p.left_at IS NULL FOR UPDATE`, [roomId, userId]))[0];
      return member ? this.project(tx, member) : undefined;
    }
    const member = await tx.prisma.room_members.findFirst({ where: { room_id: roomId, user_id: userId, status: 'ACTIVE', room: { status: 'ACTIVE' }, active_period: { is: { left_at: null } } }, select: { id: true, room_id: true, user_id: true, role: true, active_period_id: true, room: { select: { mode: true } }, active_period: { select: { visible_from_order: true } } } });
    return member?.active_period && member.active_period_id ? this.project(tx, { id: member.id, room_id: member.room_id, user_id: member.user_id, role: member.role, active_period_id: member.active_period_id, mode: member.room.mode, visible_from_order: String(member.active_period.visible_from_order) }) : undefined;
  }
  private async project(tx: Transaction, member: ActiveMember): Promise<ActiveMember> {
    if (member.mode !== 'FAN' || member.role !== 'FAN') return member;
    let grant: { id: string; expires_at: Date } | undefined | null;
    if (tx.writable) {
      // Room/member already locked; grant changes take this same room lock.
      [grant] = await tx.rows<{ id: string; expires_at: Date }>(`SELECT g.id,g.expires_at FROM room_test_grants g JOIN admin_capabilities a ON a.user_id=? AND a.manage_test_access=1 WHERE g.room_id=? AND g.member_id=? AND g.period_id=? AND g.revoked_at IS NULL AND g.expires_at>UTC_TIMESTAMP(3) ORDER BY g.expires_at DESC,g.id LIMIT 1 FOR UPDATE`, [member.user_id, member.room_id, member.id, member.active_period_id]);
    } else {
      const now = await tx.now();
      grant = await tx.prisma.room_test_grants.findFirst({ where: { room_id: member.room_id, member_id: member.id, period_id: member.active_period_id, revoked_at: null, expires_at: { gt: now }, member: { user: { status: 'ACTIVE', admin: { is: { manage_test_access: true } } } } }, orderBy: [{ expires_at: 'desc' }, { id: 'asc' }], select: { id: true, expires_at: true } });
    }
    if (!grant || grant.expires_at <= await tx.now()) return member;
    return { ...member, role: 'STREAMER', temporaryGrantId: grant.id, temporaryExpiresAt: grant.expires_at };
  }

}
