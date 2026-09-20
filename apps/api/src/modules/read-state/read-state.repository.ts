import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { ActiveMember } from '../access/access.types.js';

@Injectable()
export class ReadStateRepository {
  // Current-row lock exception: serialize with membership/message commands using
  // their room -> member -> message order, including first-insert races.
  async lockRoom(tx: Transaction, roomId: string): Promise<boolean> {
    const rows = await tx.rows<{ id: string }>("SELECT id FROM rooms WHERE id=? AND status='ACTIVE' FOR UPDATE", [roomId]);
    return rows.length === 1;
  }

  current(tx: Transaction, viewer: ActiveMember, streamId: string) {
    return tx.prisma.own_read_states.findFirst({ where: { room_id: viewer.room_id, member_id: viewer.id,
      stream_id: streamId, period_id: viewer.active_period_id }, select: { last_read_order: true } });
  }

  recent(tx: Transaction, viewer: ActiveMember) {
    return tx.prisma.own_read_states.findMany({ where: { room_id: viewer.room_id, member_id: viewer.id,
      period_id: viewer.active_period_id },
      orderBy: [{ updated_at: 'desc' }, { stream_id: 'asc' }], take: 100, select: { stream_id: true, last_read_order: true } });
  }

  messageAt(tx: Transaction, roomId: string, streamId: string, order: bigint) {
    return tx.prisma.messages.findFirst({ where: { room_id: roomId, stream_id: streamId, created_order: order },
      select: { id: true } });
  }

  async advance(tx: Transaction, viewer: ActiveMember, streamId: string, order: bigint): Promise<void> {
    const where = { member_id: viewer.id, stream_id: streamId, room_id: viewer.room_id };
    // The caller holds the room/member locks, so first creation and period reset
    // cannot race another command or a leave/rejoin. Same-period writes use a
    // conditional update as an additional monotonicity fence.
    const prior = await tx.prisma.own_read_states.findUnique({ where: { member_id_stream_id: {
      member_id: viewer.id, stream_id: streamId } }, select: { period_id: true } });
    if (!prior) {
      await tx.prisma.own_read_states.create({ data: { ...where, period_id: viewer.active_period_id,
        last_read_order: order }, select: { member_id: true } });
    } else {
      await tx.prisma.own_read_states.updateMany({ where: { ...where, OR: [
        { period_id: { not: viewer.active_period_id } },
        { period_id: viewer.active_period_id, last_read_order: { lt: order } },
      ] }, data: { period_id: viewer.active_period_id, last_read_order: order } });
    }
  }

  async purgeAccount(tx: Transaction, userId: string, limit: number) {
    const rows = await tx.prisma.own_read_states.findMany({ where: { period: { member: { user_id: userId } } },
      orderBy: [{ member_id: 'asc' }, { stream_id: 'asc' }], take: limit,
      select: { member_id: true, stream_id: true } });
    const deleted = rows.length ? (await tx.prisma.own_read_states.deleteMany({ where: {
      period: { member: { user_id: userId } }, OR: rows.map(row => ({ member_id: row.member_id, stream_id: row.stream_id })),
    } })).count : 0;
    const remaining = await tx.prisma.own_read_states.findFirst({ where: { period: { member: { user_id: userId } } }, select: { member_id: true } });
    return { deleted, hasMore: remaining !== null };
  }
}
