import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { ActiveMember } from '../access/access.types.js';
import { delegatedMemberSql } from '../access/delegation-policy.js';
import { fanSharedVisibleSql } from '../access/fan-message-policy.js';

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

  // The boundary is selected from the same authorized, live message set as
  // history. Each stream has its own high-water mark; a single room-wide
  // message ID would misclassify interleaved private fan conversations.
  async firstUnread(tx: Transaction, viewer: ActiveMember, now: Date): Promise<string | null> {
    const rows = await tx.rows<{ id: string }>(`SELECT m.id
      FROM messages m
      JOIN message_streams s ON s.id=m.stream_id AND s.room_id=m.room_id
      JOIN rooms r ON r.id=m.room_id
      JOIN room_members viewer ON viewer.id=? AND viewer.room_id=m.room_id
      JOIN users u ON u.id=m.content_owner_user_id
      LEFT JOIN messages root ON root.id=m.deletion_root_id AND root.room_id=m.room_id
      LEFT JOIN users ru ON ru.id=root.content_owner_user_id
      LEFT JOIN own_read_states rs ON rs.room_id=m.room_id AND rs.stream_id=m.stream_id
        AND rs.member_id=? AND rs.period_id=?
      WHERE m.room_id=? AND m.created_order>=? AND m.sender_member_id<>?
        AND m.created_order>COALESCE(rs.last_read_order,0)
        AND NOT EXISTS (SELECT 1 FROM actor_blocks b WHERE b.room_id=m.room_id
          AND b.blocker_actor_id=? AND b.target_actor_id=m.sender_member_id)
        AND ((s.kind='ROOM_SHARED' AND ${fanSharedVisibleSql('m', 'r', 'viewer')}) OR (s.kind='RESTRICTED' AND EXISTS (
          SELECT 1 FROM room_members rm WHERE rm.room_id=m.room_id AND rm.id=?
            AND (${delegatedMemberSql('rm')} OR EXISTS (SELECT 1 FROM stream_grants g WHERE g.room_id=m.room_id
              AND g.stream_id=m.stream_id AND g.member_id=rm.id AND g.can_read=1
              AND g.revoked_at IS NULL AND g.valid_from<=?
              AND (g.expires_at IS NULL OR g.expires_at>?))))))
        AND m.deleted_at IS NULL AND m.moderated=0
        AND u.status NOT IN ('DELETING','DELETED')
        AND (m.deletion_root_id IS NULL OR (root.id IS NOT NULL
          AND root.deleted_at IS NULL AND root.moderated=0
          AND ru.status NOT IN ('DELETING','DELETED')))
        AND (m.content_kind<>'STICKER' OR EXISTS (
          SELECT 1 FROM message_stickers ms
          JOIN sticker_catalog sc ON sc.id=ms.sticker_id
          JOIN media_assets sa ON sa.id=sc.asset_id
          WHERE ms.room_id=m.room_id AND ms.message_id=m.id
            AND sc.status IN ('ACTIVE','RETIRED') AND sc.approved_at IS NOT NULL
            AND sa.kind='STICKER' AND sa.room_id IS NULL AND sa.state='READY'
            AND sa.deleted_at IS NULL AND EXISTS (
              SELECT 1 FROM media_objects so WHERE so.asset_id=sa.id
                AND so.variant='image' AND so.state='READY')))
      ORDER BY m.created_order ASC LIMIT 1`,
      [viewer.id, viewer.id, viewer.active_period_id, viewer.room_id, viewer.visible_from_order,
        viewer.id, viewer.id, viewer.id, now, now]);
    return rows[0]?.id ?? null;
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
