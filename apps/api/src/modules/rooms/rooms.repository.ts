import { affected } from '../../infrastructure/database/transactions.js';
import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from '../../infrastructure/database/transactions.js';
@Injectable()
export class RoomsRepository {
  manager(tx: Transaction, userId: string) {
    return tx.writable ? tx.rows<{ manage_rooms: number }>('SELECT manage_rooms FROM admin_capabilities WHERE user_id=? FOR UPDATE', [userId]) : tx.prisma.admin_capabilities.findMany({ where: { user_id: userId }, select: { manage_rooms: true } });
  }
  audit(tx: Transaction, id: string, userId: string, roomId: string, action: string) {
    return tx.prisma.audit_events.create({ data: { id, actor_user_id: userId, room_id: roomId, action }, select: { id: true } });
  }
  eligibleOwner(tx: Transaction, ownerId: string) {
    return tx.rows<RowDataPacket>("SELECT u.id FROM users u JOIN creator_accounts c ON c.user_id=u.id AND c.enabled=1 JOIN platform_soop s ON s.user_id=u.id AND s.status='VERIFIED' WHERE u.id=? AND u.status='ACTIVE' FOR UPDATE", [ownerId]);
  }
  async visibleRooms(tx: Transaction, userId: string, after: string) {
    const rows = await tx.prisma.rooms.findMany({ where: { status: 'ACTIVE', id: { gt: after }, members: { none: { user_id: userId, status: 'BANNED' } }, OR: [{ join_policy: 'OPEN_AUTHENTICATED' }, { members: { some: { user_id: userId, status: 'ACTIVE' } } }] }, orderBy: { id: 'asc' }, take: 51, select: { id: true, name: true, mode: true, members: { where: { user_id: userId }, select: { id: true, status: true } } } });
    return rows.map(row => ({ id: row.id, name: row.name, mode: row.mode, actor_id: row.members[0]?.id ?? null, member_status: row.members[0]?.status ?? null }));
  }
  async period(tx: Transaction, actorId: string) {
    const row = await tx.prisma.room_members.findUnique({ where: { id: actorId }, select: { active_period: { select: { history_policy: true, policy_version: true, visible_from_order: true } } } });
    return row?.active_period ? [row.active_period] : [];
  }
  activeOwner(tx: Transaction, ownerId: string | null, roomId: string, userId: string) {
    return tx.rows<RowDataPacket>("SELECT m.id FROM room_members m JOIN membership_periods p ON p.id=m.active_period_id AND p.room_id=m.room_id AND p.member_id=m.id WHERE m.id=? AND m.room_id=? AND m.user_id=? AND m.role='STREAMER' AND m.status='ACTIVE' AND p.left_at IS NULL FOR UPDATE", [ownerId, roomId, userId]);
  }
  changePolicy(tx: Transaction, policy: string, roomId: string) {
    return affected(tx.prisma.rooms.updateMany({ where: { id: roomId }, data: { history_policy: policy as 'ALL_AVAILABLE' | 'SINCE_JOIN', policy_version: { increment: 1 } } }));
  }

}
