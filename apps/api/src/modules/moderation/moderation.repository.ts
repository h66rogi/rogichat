import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { Prisma } from '../../generated/prisma/client.js';
const reportSelect = { id: true, status: true, created_at: true, payload_digest: true, reason: true, detail: true, detail_expires_at: true } as const;
@Injectable()
export class ModerationRepository {
  async manager(tx: Transaction, userId: string) {
    // Current capability locks serialize resolution with privilege revocation.
    const [row] = await tx.rows<{ manage_users: number }>('SELECT manage_users FROM admin_capabilities WHERE user_id=? FOR UPDATE', [userId]);
    return Number(row?.manage_users) === 1;
  }
  async member(tx: Transaction, roomId: string, userId: string) {
    const [row] = await tx.rows<{ id: string; role: string; status: string; active_period_id: string | null }>('SELECT id,role,status,active_period_id FROM room_members WHERE room_id=? AND user_id=? FOR UPDATE', [roomId, userId]);
    return row;
  }
  async target(tx: Transaction, roomId: string, actorId: string) {
    const [row] = await tx.rows<{ id: string; user_id: string; role: string; status: string; active_period_id: string | null; account_status: string; soop_status: string | null }>(`SELECT m.id,m.user_id,m.role,m.status,m.active_period_id,u.status AS account_status,s.status AS soop_status FROM room_members m JOIN users u ON u.id=m.user_id LEFT JOIN platform_soop s ON s.user_id=u.id WHERE m.room_id=? AND m.id=? FOR UPDATE`, [roomId, actorId]);
    return row;
  }
  ownBlocks(tx: Transaction, roomId: string, userId: string, after: string) {
    return tx.prisma.room_members.findFirst({ where: { room_id: roomId, user_id: userId }, select: { id: true } }).then(member => member ? tx.prisma.actor_blocks.findMany({ where: { room_id: roomId, blocker_actor_id: member.id, target_actor_id: { gt: after } }, orderBy: { target_actor_id: 'asc' }, take: 51, select: { target_actor_id: true, created_at: true } }) : []);
  }
  async setBlock(tx: Transaction, roomId: string, actorId: string, targetId: string, blocked: boolean) {
    const where = { room_id: roomId, blocker_actor_id: actorId, target_actor_id: targetId };
    const [prior] = await tx.rows('SELECT target_actor_id FROM actor_blocks WHERE room_id=? AND blocker_actor_id=? AND target_actor_id=? FOR UPDATE', [roomId, actorId, targetId]);
    if (Boolean(prior) === blocked) return false;
    if (blocked) await tx.prisma.actor_blocks.create({ data: where, select: { target_actor_id: true } });
    else await tx.prisma.actor_blocks.deleteMany({ where });
    return true;
  }
  async invalidate(tx: Transaction, roomId: string, actorId: string) {
    // Both participants refresh reply/push capability; nobody else's room content epoch changes.
    await tx.prisma.room_members.updateMany({ where: { room_id: roomId, id: actorId }, data: { acl_epoch: { increment: 1n } } });
  }
  bans(tx: Transaction, roomId: string, after: string) {
    return tx.prisma.room_members.findMany({ where: { room_id: roomId, status: 'BANNED', id: { gt: after } }, orderBy: { id: 'asc' }, take: 51, select: { id: true } });
  }
  async ban(tx: Transaction, roomId: string, actorId: string, periodId: string | null, banned: boolean) {
    if (banned) {
      await tx.prisma.membership_periods.updateMany({ where: { room_id: roomId, member_id: actorId, id: periodId ?? '', left_at: null }, data: { left_at: await tx.now() } });
      await tx.prisma.stream_grants.updateMany({ where: { room_id: roomId, member_id: actorId, revoked_at: null }, data: { revoked_at: await tx.now(), can_read: false, can_send: false } });
    }
    await tx.prisma.room_members.updateMany({ where: { room_id: roomId, id: actorId }, data: { status: banned ? 'BANNED' : 'LEFT', active_period_id: null } });
    await this.invalidate(tx, roomId, actorId);
    await tx.prisma.users.updateMany({ where: { members: { some: { room_id: roomId, id: actorId } } }, data: { membership_generation: { increment: 1n } } });
  }
  receipt(tx: Transaction, userId: string, key: string) {
    return tx.prisma.moderation_reports.findUnique({ where: { reporter_user_id_idempotency_key: { reporter_user_id: userId, idempotency_key: key } }, select: reportSelect });
  }
  ownReport(tx: Transaction, userId: string, reportId: string) {
    return tx.prisma.moderation_reports.findFirst({ where: { id: reportId, reporter_user_id: userId }, select: reportSelect });
  }
  createReport(tx: Transaction, data: Prisma.moderation_reportsCreateInput) {
    return tx.prisma.moderation_reports.create({ data, select: reportSelect });
  }
  queue(tx: Transaction, after: string) {
    return tx.prisma.moderation_reports.findMany({ where: { id: { gt: after }, status: 'received' }, orderBy: { id: 'asc' }, take: 51, select: { ...reportSelect, room_id: true, message_id: true, root_message_id: true, reporter_user_id: true, content_owner_user_id: true } });
  }
  async detailAvailable(tx: Transaction, row: { room_id: string; message_id: string; root_message_id: string; reporter_user_id: string; content_owner_user_id: string }) {
    const reporter = await tx.prisma.users.findFirst({ where: { id: row.reporter_user_id, status: { notIn: ['DELETING', 'DELETED'] } }, select: { id: true } });
    if (!reporter) return false;
    const message = await tx.prisma.messages.findFirst({ where: { room_id: row.room_id, id: row.message_id, deleted_at: null, moderated: false,
      content_owner: { status: { notIn: ['DELETING', 'DELETED'] } } }, select: { id: true } });
    if (!message) return false;
    return Boolean(await tx.prisma.messages.findFirst({ where: { room_id: row.room_id, id: row.root_message_id, deleted_at: null, moderated: false,
      content_owner: { status: { notIn: ['DELETING', 'DELETED'] } } }, select: { id: true } }));
  }
  async reportForReview(tx: Transaction, reportId: string) {
    const [row] = await tx.rows<{ id: string; status: string; created_at: Date }>('SELECT id,status,created_at FROM moderation_reports WHERE id=? FOR UPDATE', [reportId]);
    return row;
  }
  resolve(tx: Transaction, reportId: string, status: string, now: Date) {
    return tx.prisma.moderation_reports.updateMany({ where: { id: reportId, status: 'received' }, data: { status, resolved_at: now, detail: null } });
  }
  audit(tx: Transaction, userId: string, action: string, scope: { report_id?: string; room_id?: string; target_actor_id?: string }) {
    return tx.prisma.moderation_audit.create({ data: { id: randomUUID(), operator_user_id: userId, action, ...scope }, select: { id: true } });
  }
}
