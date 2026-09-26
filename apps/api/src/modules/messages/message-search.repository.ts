import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { delegatedMemberSql } from '../access/delegation-policy.js';
import { fanSharedVisibleSql } from '../access/fan-message-policy.js';

export interface MessageSearchRow {
  id: string; room_id: string; room_name: string; created_at: Date;
  text_content: string; deletion_root_id: string | null; nickname: string | null;
}

/** The same live viewer, period, publication and stream grants used by the inbox. */
@Injectable()
export class MessageSearchRepository {
  page(tx: Transaction, userId: string, pattern: string, limit: number, before?: { at: Date; id: string }) {
    const cursor = before ? 'AND (m.created_at<? OR (m.created_at=? AND m.id<?))' : '';
    // Authorization precedes LIMIT; a cached search hit never grants access.
    return tx.rows<MessageSearchRow>(`SELECT m.id,m.room_id,r.name AS room_name,m.created_at,
      m.text_content,m.deletion_root_id,p.nickname
      FROM messages m
      JOIN rooms r ON r.id=m.room_id AND r.status='ACTIVE'
      JOIN message_streams s ON s.room_id=m.room_id AND s.id=m.stream_id
      JOIN room_members viewer ON viewer.room_id=m.room_id AND viewer.user_id=? AND viewer.status='ACTIVE'
      JOIN membership_periods period ON period.room_id=m.room_id AND period.member_id=viewer.id
        AND period.id=viewer.active_period_id AND period.left_at IS NULL
      JOIN users owner ON owner.id=m.content_owner_user_id AND owner.status NOT IN ('DELETING','DELETED')
      LEFT JOIN messages root ON root.room_id=m.room_id AND root.id=m.deletion_root_id
      LEFT JOIN users root_owner ON root_owner.id=root.content_owner_user_id
      LEFT JOIN room_members sender ON sender.room_id=m.room_id AND sender.id=m.sender_member_id
      LEFT JOIN user_profiles p ON p.user_id=sender.user_id
      WHERE m.text_content IS NOT NULL AND m.text_content LIKE ? ESCAPE '!'
        AND m.deleted_at IS NULL AND m.moderated=0
        AND m.created_order>=period.visible_from_order
        AND (m.deletion_root_id IS NULL OR (root.id IS NOT NULL AND root.deleted_at IS NULL
          AND root.moderated=0 AND root_owner.status NOT IN ('DELETING','DELETED')))
        AND NOT EXISTS (SELECT 1 FROM actor_blocks b WHERE b.room_id=m.room_id
          AND b.blocker_actor_id=viewer.id AND b.target_actor_id=m.sender_member_id)
        AND ((s.kind='ROOM_SHARED' AND ${fanSharedVisibleSql('m', 'r', 'viewer')})
          OR (s.kind='RESTRICTED' AND (${delegatedMemberSql('viewer')} OR EXISTS
            (SELECT 1 FROM stream_grants g WHERE g.room_id=m.room_id AND g.stream_id=m.stream_id
              AND g.member_id=viewer.id AND g.can_read=1 AND g.revoked_at IS NULL
              AND g.valid_from<=UTC_TIMESTAMP(3) AND (g.expires_at IS NULL OR g.expires_at>UTC_TIMESTAMP(3))))))
        ${cursor}
      ORDER BY m.created_at DESC,m.id DESC LIMIT ?`,
      [userId, pattern, ...(before ? [before.at, before.at, before.id] : []), limit + 1]);
  }
}
