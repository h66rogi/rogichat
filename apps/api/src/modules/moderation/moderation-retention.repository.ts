import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
export type RetentionScope = { kind: 'message'; roomId: string; messageId: string } | { kind: 'account'; userId: string } | { kind: 'expiry'; now: Date };
@Injectable()
export class ModerationRetentionRepository {
  async clear(tx: Transaction, scope: RetentionScope, limit: number) {
    // Current bounded locks are required: deletion may have established an RR
    // snapshot before waiting for a report writer's room/account fence.
    const clause = scope.kind === 'message' ? 'room_id=? AND (message_id=? OR root_message_id=?)' :
      scope.kind === 'account' ? '(reporter_user_id=? OR content_owner_user_id=?)' : 'detail_expires_at<=?';
    const values = scope.kind === 'message' ? [scope.roomId, scope.messageId, scope.messageId] :
      scope.kind === 'account' ? [scope.userId, scope.userId] : [scope.now];
    const sql = `SELECT id FROM moderation_reports WHERE ${clause} AND detail IS NOT NULL ORDER BY id LIMIT ? FOR UPDATE`;
    const page = await tx.rows<{ id: string }>(sql, [...values, limit]);
    const result = page.length ? await tx.prisma.moderation_reports.updateMany({ where: { id: { in: page.map(row => row.id) }, detail: { not: null } }, data: { detail: null } }) : { count: 0 };
    const pending = await tx.rows<{ id: string }>(sql, [...values, 1]);
    return { changed: result.count, done: pending.length === 0 };
  }
}
