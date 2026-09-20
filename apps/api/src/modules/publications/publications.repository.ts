import { affected } from '../../infrastructure/database/transactions.js';
import { chatAccountSql } from '../auth/chat-entitlement.js';
import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from '../../infrastructure/database/transactions.js';
@Injectable()
export class PublicationsRepository {
  lockRoom(tx: Transaction, roomId: string) {
    return tx.rows<RowDataPacket>('SELECT id,status,owner_member_id FROM rooms WHERE id=? FOR UPDATE', [roomId]);
  }
  revision(tx: Transaction, roomId: string, messageId: string) {
    return tx.rows<RowDataPacket>('SELECT content_revision FROM messages WHERE room_id=? AND id=? FOR UPDATE', [roomId, messageId]);
  }
  existing(tx: Transaction, roomId: string, messageId: string, revision: string) {
    return tx.rows<{ id: string; state: string; published_message_id: string | null }>('SELECT id,state,published_message_id FROM message_publications WHERE room_id=? AND source_message_id=? AND source_version=? FOR UPDATE', [roomId, messageId, revision]);
  }
  insert(tx: Transaction, id: string, roomId: string, sourceId: string, revision: string, memberId: string) {
    return tx.prisma.message_publications.create({ data: { id, room_id: roomId, source_message_id: sourceId, source_version: BigInt(revision), publisher_member_id: memberId }, select: { id: true } });
  }
  status(tx: Transaction, roomId: string, publicationId: string, ownerId: string, publisherId: string) {
    return tx.prisma.message_publications.findMany({ where: { room_id: roomId, id: publicationId, publisher_member_id: publisherId, publisher: { room: { owner_member_id: ownerId } } }, select: { id: true, state: true, published_message_id: true } });
  }
  async candidate(tx: Transaction, roomId: string, resourceId: string) {
    const rows = await tx.prisma.message_publications.findMany({ where: { room_id: roomId, id: resourceId }, select: { publisher: { select: { user_id: true } } } });
    return rows.map(row => ({ user_id: row.publisher.user_id }));
  }
  lockAccount(tx: Transaction, userId: unknown) {
    return tx.rows<RowDataPacket>(`SELECT u.id FROM users u LEFT JOIN platform_soop s ON s.user_id=u.id WHERE u.id=? AND u.status='ACTIVE' AND ${chatAccountSql('u', 's')} FOR UPDATE`, [userId]);
  }
  lockRoomForFinalize(tx: Transaction, roomId: string) {
    return tx.rows('SELECT id FROM rooms WHERE id=? FOR UPDATE', [roomId]);
  }
  lockPublication(tx: Transaction, roomId: string, resourceId: string) {
    return tx.rows<RowDataPacket>('SELECT id,state,source_message_id,source_version,publisher_member_id FROM message_publications WHERE room_id=? AND id=? FOR UPDATE', [roomId, resourceId]);
  }
  lockCopyAsset(tx: Transaction, id: string) { return tx.rows('SELECT id FROM media_assets WHERE id=? FOR UPDATE', [id]); }
  revoke(tx: Transaction, id: unknown) { return affected(tx.prisma.message_publications.updateMany({ where: { id: String(id) }, data: { state: 'REVOKED' } })); }
  sharedStreams(tx: Transaction, roomId: string) {
    return tx.rows<RowDataPacket>("SELECT id FROM message_streams WHERE room_id=? AND kind='ROOM_SHARED' FOR UPDATE", [roomId]);
  }
  insertCopy(tx: Transaction, id: string, roomId: string, streamId: unknown, memberId: string, ownerId: string, sourceId: string, text: string | null, order: string) {
    return tx.prisma.messages.create({ data: { id, room_id: roomId, stream_id: String(streamId), sender_member_id: memberId, content_owner_user_id: ownerId, deletion_root_id: sourceId, text_content: text, created_order: BigInt(order) }, select: { id: true } });
  }
  publish(tx: Transaction, messageId: string, id: unknown) { return affected(tx.prisma.message_publications.updateMany({ where: { id: String(id) }, data: { state: 'PUBLISHED', published_message_id: messageId } })); }
  audit(tx: Transaction, id: string, userId: unknown, roomId: string, action: string) {
    return tx.prisma.audit_events.create({ data: { id, actor_user_id: String(userId), room_id: roomId, action }, select: { id: true } });
  }

}
