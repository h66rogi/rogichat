import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from '../../infrastructure/database/transactions.js';
@Injectable()
export class SyncRepository {
async clock(tx: Transaction): Promise<Date> { return (await tx.rows<RowDataPacket>('SELECT UTC_TIMESTAMP(3) AS now'))[0]!.now as Date; }
  async state(tx: Transaction, actorId: string) {
    const row = await tx.prisma.room_members.findUnique({ where: { id: actorId }, select: { acl_epoch: true, user: { select: { membership_generation: true } }, room: { select: { policy_version: true, content_epoch: true, counter: { select: { last_order: true } } } } } });
    return row?.room.counter ? [{ acl_epoch: String(row.acl_epoch), policy_version: row.room.policy_version, content_epoch: String(row.room.content_epoch), membership_generation: String(row.user.membership_generation), last_order: String(row.room.counter.last_order) }] : [];
  }
  async grants(tx: Transaction, roomId: string, actorId: string) {
    const now = await tx.now();
    const rows = await tx.prisma.stream_grants.findMany({ where: { room_id: roomId, member_id: actorId }, orderBy: { stream_id: 'asc' }, take: 10001, select: { stream_id: true, can_read: true, can_send: true, valid_from: true, expires_at: true, revoked_at: true } });
    return rows.map(row => ({ ...row, can_read: Number(row.can_read), can_send: Number(row.can_send), active: Number(row.valid_from <= now && (row.expires_at === null || row.expires_at > now) && row.revoked_at === null) }));
  }
  account(tx: Transaction, userId: string) { return tx.prisma.users.findMany({ where: { id: userId }, select: { membership_generation: true } }); }
  async rooms(tx: Transaction, userId: string) {
    const now = await tx.now();
    const delegated = await tx.prisma.room_test_grants.findMany({ where: { member: { user_id: userId, user: { admin: { is: { manage_test_access: true } } } }, revoked_at: null, expires_at: { gt: now } }, take: 10001, select: { member_id: true, period_id: true } });
    if (delegated.length > 10000) throw new ServiceUnavailableException();
    const rows = await tx.prisma.room_members.findMany({ where: { user_id: userId, status: 'ACTIVE', room: { status: 'ACTIVE' }, active_period: { is: { left_at: null } } }, orderBy: { room_id: 'asc' }, take: 10001, select: { id: true, role: true, active_period_id: true, acl_epoch: true, room: { select: { id: true, name: true, mode: true } } } });
    return rows.map(row => ({ id: row.room.id, name: row.room.name, mode: row.room.mode, actor_id: row.id, role: row.room.mode === 'FAN' && delegated.some(g => g.member_id === row.id && g.period_id === row.active_period_id) ? 'STREAMER' : row.role, active_period_id: row.active_period_id, acl_epoch: String(row.acl_epoch) }));
  }

}
