import { affected } from '../../infrastructure/database/transactions.js';
import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from '../../infrastructure/database/transactions.js';
@Injectable()
export class ReactionsRepository {
  counts(tx: Transaction, roomId: string, messageId: string) {
    return tx.rows<RowDataPacket>(`SELECT MIN(r.emoji) AS emoji,COUNT(*) AS total
    FROM message_reactions r JOIN room_members m ON m.id=r.member_id AND m.room_id=r.room_id
    JOIN users u ON u.id=m.user_id AND u.status NOT IN ('DELETING','DELETED')
    WHERE r.room_id=? AND r.message_id=? GROUP BY BINARY r.emoji ORDER BY BINARY r.emoji`, [roomId, messageId]);
  }
  mine(tx: Transaction, roomId: string, messageId: string, memberId: string) {
    return tx.prisma.message_reactions.findMany({ where: { room_id: roomId, message_id: messageId, member_id: memberId, member: { user: { status: { notIn: ['DELETING', 'DELETED'] } } } }, select: { emoji: true } });
  }
  lockRoom(tx: Transaction, roomId: string) {
    return tx.rows<RowDataPacket>("SELECT id FROM rooms WHERE id=? AND status='ACTIVE' FOR UPDATE", [roomId]);
  }
  prior(tx: Transaction, roomId: string, messageId: string, memberId: string) {
    return tx.rows<RowDataPacket>('SELECT id,emoji FROM message_reactions WHERE room_id=? AND message_id=? AND member_id=? FOR UPDATE', [roomId, messageId, memberId]);
  }
  remove(tx: Transaction, roomId: string, messageId: string, memberId: string) {
    return affected(tx.prisma.message_reactions.deleteMany({ where: { room_id: roomId, message_id: messageId, member_id: memberId } }));
  }
  replace(tx: Transaction, emoji: string, id: unknown, roomId: string, messageId: string, memberId: string) {
    return affected(tx.prisma.message_reactions.updateMany({ where: { id: String(id), room_id: roomId, message_id: messageId, member_id: memberId }, data: { emoji } }));
  }
  insert(tx: Transaction, id: string, roomId: string, messageId: string, memberId: string, emoji: string) {
    return tx.prisma.message_reactions.create({ data: { id, room_id: roomId, message_id: messageId, member_id: memberId, emoji }, select: { id: true } });
  }
  advanceVersion(tx: Transaction, roomId: string, messageId: string) {
    return affected(tx.prisma.messages.updateMany({ where: { room_id: roomId, id: messageId }, data: { version: { increment: 1n } } }));
  }

}
