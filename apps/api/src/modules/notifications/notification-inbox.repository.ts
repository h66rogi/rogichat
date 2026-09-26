import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { delegatedMemberSql } from '../access/delegation-policy.js';
import { fanSharedVisibleSql } from '../access/fan-message-policy.js';

export interface InboxRow {
  id: string;
  room_id: string;
  room_name: string;
  created_at: Date;
  read_at: Date | null;
}

// Filter by the current message ACL before LIMIT. The receipt table stores no
// content, and neither a stale receipt nor a deleted message can grant access.
const visible = `viewer.user_id=? AND viewer.status='ACTIVE' AND period.left_at IS NULL
  AND r.status='ACTIVE' AND m.deleted_at IS NULL AND m.moderated=0
  AND owner.status='ACTIVE' AND m.sender_member_id<>viewer.id
  AND m.created_order>=period.visible_from_order
  AND NOT EXISTS (SELECT 1 FROM actor_blocks b WHERE b.room_id=m.room_id
    AND ((b.blocker_actor_id=viewer.id AND b.target_actor_id=m.sender_member_id)
      OR (b.target_actor_id=viewer.id AND b.blocker_actor_id=m.sender_member_id)))
  AND (m.deletion_root_id IS NULL OR (root.id IS NOT NULL AND root.deleted_at IS NULL
    AND root.moderated=0 AND root_owner.status='ACTIVE'))
  AND (m.content_kind<>'STICKER' OR EXISTS (SELECT 1 FROM message_stickers ms
    JOIN sticker_catalog sc ON sc.id=ms.sticker_id JOIN media_assets sa ON sa.id=sc.asset_id
    WHERE ms.room_id=m.room_id AND ms.message_id=m.id AND sc.status IN ('ACTIVE','RETIRED')
      AND sc.approved_at IS NOT NULL AND sa.kind='STICKER' AND sa.room_id IS NULL
      AND sa.state='READY' AND sa.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM media_objects so WHERE so.asset_id=sa.id AND so.variant='image' AND so.state='READY')))
  AND ((s.kind='ROOM_SHARED' AND ${fanSharedVisibleSql('m', 'r', 'viewer')})
    OR (s.kind='RESTRICTED' AND (${delegatedMemberSql('viewer')} OR EXISTS
      (SELECT 1 FROM stream_grants g WHERE g.room_id=m.room_id AND g.stream_id=m.stream_id
        AND g.member_id=viewer.id AND g.can_read=1 AND g.revoked_at IS NULL
        AND g.valid_from<=UTC_TIMESTAMP(3) AND (g.expires_at IS NULL OR g.expires_at>UTC_TIMESTAMP(3))))))`;

const source = `FROM messages m
  JOIN rooms r ON r.id=m.room_id
  JOIN message_streams s ON s.room_id=m.room_id AND s.id=m.stream_id
  JOIN room_members viewer ON viewer.room_id=m.room_id
  JOIN membership_periods period ON period.room_id=viewer.room_id
    AND period.member_id=viewer.id AND period.id=viewer.active_period_id
  JOIN users owner ON owner.id=m.content_owner_user_id
  LEFT JOIN messages root ON root.room_id=m.room_id AND root.id=m.deletion_root_id
  LEFT JOIN users root_owner ON root_owner.id=root.content_owner_user_id
  LEFT JOIN notification_reads receipt ON receipt.user_id=viewer.user_id AND receipt.message_id=m.id
  LEFT JOIN own_read_states seen ON seen.room_id=m.room_id AND seen.stream_id=m.stream_id
    AND seen.member_id=viewer.id AND seen.period_id=period.id
  WHERE ${visible}`;

@Injectable()
export class NotificationInboxRepository {
  page(tx: Transaction, userId: string, limit: number, cursor?: { createdAt: Date; id: string }) {
    const where = cursor ? ' AND (m.created_at<? OR (m.created_at=? AND m.id<?))' : '';
    return tx.rows<InboxRow>(`SELECT m.id,m.room_id,r.name AS room_name,m.created_at,
      CASE WHEN receipt.read_at IS NOT NULL THEN receipt.read_at
        WHEN seen.last_read_order>=m.created_order THEN seen.updated_at ELSE NULL END AS read_at
      ${source}${where}
      ORDER BY m.created_at DESC,m.id DESC LIMIT ?`,
      [userId, ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []), limit + 1]);
  }
  async visible(tx: Transaction, userId: string, messageId: string): Promise<{ room_id: string } | undefined> {
    const [row] = await tx.rows<{ room_id: string }>(`SELECT m.room_id ${source} AND m.id=? LIMIT 1`, [userId, messageId]);
    return row;
  }
  markRead(tx: Transaction, userId: string, roomId: string, messageId: string) {
    return tx.prisma.notification_reads.createMany({
      data: [{ user_id: userId, room_id: roomId, message_id: messageId }], skipDuplicates: true,
    });
  }
}
