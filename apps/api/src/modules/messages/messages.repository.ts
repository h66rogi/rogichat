import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from '../../transactions.js';
import type { SendInput } from './dto/send-message.dto.js';
import type {
  MessageAttachmentRow, MessageEventKind, MessageGrantRow, MessageIdRow, MessagePairRow,
  MessageReceiptRow, MessageRoomRow, MessageRow, MessageSendGrantRow, MessageTargetRow, OwnedMessageRow,
} from './message.types.js';

// The service owns authorization, transaction lifetime and job scheduling. Every
// query here uses the caller's same transaction, including writable row locks.
@Injectable()
export class MessagesRepository {
  async load(tx: Transaction, roomId: string, messageId: string): Promise<MessageRow | undefined> {
    const [row] = await tx.rows<MessageRow>(`SELECT m.id,m.room_id,m.stream_id,m.sender_member_id,m.content_owner_user_id,m.deletion_root_id,m.quote_id,m.text_content,m.content_kind,m.version,m.created_order,m.created_at,m.deleted_at,m.moderated,s.kind AS stream_kind,p.nickname,u.status AS content_owner_status,NULL AS avatar_id,
    (m.deletion_root_id IS NOT NULL AND (root.id IS NULL OR root.deleted_at IS NOT NULL OR root.moderated=1 OR ru.status IN ('DELETING','DELETED'))) AS root_blocked
    FROM messages m JOIN message_streams s ON s.room_id=m.room_id AND s.id=m.stream_id
    JOIN room_members sender ON sender.room_id=m.room_id AND sender.id=m.sender_member_id
    LEFT JOIN user_profiles p ON p.user_id=sender.user_id JOIN users u ON u.id=m.content_owner_user_id
    LEFT JOIN messages root ON root.room_id=m.room_id AND root.id=m.deletion_root_id LEFT JOIN users ru ON ru.id=root.content_owner_user_id
    WHERE m.room_id=? AND m.id=?${tx.writable ? ' FOR UPDATE' : ''}`, [roomId, messageId]);
    return row;
  }

  async grant(tx: Transaction, roomId: string, streamId: string, memberId: string): Promise<MessageGrantRow | undefined> {
    const [row] = await tx.rows<MessageGrantRow>(`SELECT member_id,room_id,stream_id,can_read FROM stream_grants WHERE room_id=? AND stream_id=? AND member_id=? AND valid_from<=UTC_TIMESTAMP(3) AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(3)) AND revoked_at IS NULL${tx.writable ? ' FOR UPDATE' : ''}`, [roomId, streamId, memberId]);
    return row;
  }

  attachments(tx: Transaction, roomId: string, messageId: string): Promise<MessageAttachmentRow[]> {
    return tx.rows<MessageAttachmentRow>(`SELECT a.id,o.width,o.height,o.variant FROM message_attachments x JOIN media_assets a ON a.room_id=x.room_id AND a.id=x.asset_id JOIN users au ON au.id=a.owner_user_id JOIN media_objects o ON o.asset_id=a.id WHERE x.room_id=? AND x.message_id=? AND a.state='READY' AND a.deleted_at IS NULL AND au.status NOT IN ('DELETING','DELETED') AND o.state='READY' AND o.variant IN ('image','video','poster') ORDER BY x.position,o.variant`, [roomId, messageId]);
  }

  sharedStreams(tx: Transaction, roomId: string): Promise<MessageIdRow[]> {
    return tx.rows<MessageIdRow>("SELECT id FROM message_streams WHERE room_id=? AND kind='ROOM_SHARED' FOR UPDATE", [roomId]);
  }

  async target(tx: Transaction, roomId: string, actorId: string): Promise<MessageTargetRow | undefined> {
    const [row] = await tx.rows<MessageTargetRow>(`SELECT m.id,m.role FROM room_members m JOIN membership_periods p ON p.id=m.active_period_id AND p.room_id=m.room_id AND p.member_id=m.id JOIN users u ON u.id=m.user_id AND u.status='ACTIVE' JOIN platform_soop s ON s.user_id=u.id AND s.status='VERIFIED' WHERE m.room_id=? AND m.id=? AND m.status='ACTIVE' AND p.left_at IS NULL FOR UPDATE`, [roomId, actorId]);
    return row;
  }

  async pair(tx: Transaction, roomId: string, members: [string, string]): Promise<MessagePairRow | undefined> {
    const [row] = await tx.rows<MessagePairRow>('SELECT stream_id FROM stream_pairs WHERE room_id=? AND left_member_id=? AND right_member_id=? FOR UPDATE', [roomId, ...members]);
    return row;
  }

  async createPair(tx: Transaction, roomId: string, streamId: string, members: [string, string]): Promise<void> {
    await tx.execute("INSERT INTO message_streams (id,room_id,kind) VALUES (?,?,'RESTRICTED')", [streamId, roomId]);
    await tx.execute('INSERT INTO stream_pairs (id,room_id,left_member_id,right_member_id,stream_id) VALUES (?,?,?,?,?)', [randomUUID(), roomId, ...members, streamId]);
    for (const member of members) await tx.execute('INSERT INTO stream_grants (id,room_id,stream_id,member_id,can_read,can_send) VALUES (?,?,?,?,1,1)', [randomUUID(), roomId, streamId, member]);
    await tx.execute('UPDATE room_members SET acl_epoch=acl_epoch+1 WHERE room_id=? AND id IN (?,?)', [roomId, ...members]);
  }

  sendGrants(tx: Transaction, roomId: string, streamId: string, members: [string, string]): Promise<MessageSendGrantRow[]> {
    return tx.rows<MessageSendGrantRow>('SELECT member_id,can_read,can_send FROM stream_grants WHERE room_id=? AND stream_id=? AND member_id IN (?,?) AND revoked_at IS NULL AND valid_from<=UTC_TIMESTAMP(3) AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(3)) ORDER BY member_id FOR UPDATE', [roomId, streamId, ...members]);
  }

  async room(tx: Transaction, roomId: string): Promise<MessageRoomRow | undefined> {
    const [row] = await tx.rows<MessageRoomRow>('SELECT id,status FROM rooms WHERE id=? FOR UPDATE', [roomId]);
    return row;
  }

  async member(tx: Transaction, roomId: string, userId: string): Promise<MessageIdRow | undefined> {
    const [row] = await tx.rows<MessageIdRow>('SELECT id FROM room_members WHERE room_id=? AND user_id=? FOR UPDATE', [roomId, userId]);
    return row;
  }

  async receipt(tx: Transaction, roomId: string, actorId: string, clientMessageId: string): Promise<MessageReceiptRow | undefined> {
    const [row] = await tx.rows<MessageReceiptRow>('SELECT message_id,payload_digest,digest_version,deleted FROM command_receipts WHERE room_id=? AND actor_id=? AND client_message_id=? FOR UPDATE', [roomId, actorId, clientMessageId]);
    return row;
  }

  async requireAsset(tx: Transaction, roomId: string, userId: string, kind: 'PHOTO' | 'VIDEO' | 'STICKER', assetId: string): Promise<boolean> {
    const assets = await tx.rows<MessageIdRow>("SELECT id FROM media_assets WHERE room_id=? AND id=? AND owner_user_id=? AND kind=? AND state='READY' AND deleted_at IS NULL AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE", [roomId, assetId, userId, kind]);
    const attached = await tx.rows<MessageIdRow>('SELECT id FROM message_attachments WHERE asset_id=? FOR UPDATE', [assetId]);
    return assets.length === 1 && attached.length === 0;
  }

  async insertMessage(tx: Transaction, fields: { id: string; roomId: string; streamId: string; actorId: string; userId: string; quoteId: string | null; content: SendInput['content']; order: bigint }): Promise<void> {
    const { id, roomId, streamId, actorId, userId, quoteId, content, order } = fields;
    await tx.execute('INSERT INTO messages (id,room_id,stream_id,sender_member_id,content_owner_user_id,quote_id,content_kind,text_content,created_order) VALUES (?,?,?,?,?,?,?,?,?)', [id, roomId, streamId, actorId, userId, quoteId, content.type, content.type === 'TEXT' ? content.text : null, order.toString()]);
    if (content.type !== 'TEXT') {
      for (const [position, assetId] of content.assetIds.entries()) await tx.execute('INSERT INTO message_attachments (id,room_id,message_id,asset_id,position) VALUES (?,?,?,?,?)', [randomUUID(), roomId, id, assetId, position]);
    }
  }

  async insertReceipt(tx: Transaction, fields: { roomId: string; actorId: string; clientMessageId: string; messageId: string; payloadDigest: Buffer }): Promise<void> {
    await tx.execute('INSERT INTO command_receipts (id,room_id,actor_id,client_message_id,message_id,payload_digest) VALUES (?,?,?,?,?,?)', [randomUUID(), fields.roomId, fields.actorId, fields.clientMessageId, fields.messageId, fields.payloadDigest]);
  }

  async ownedMessage(tx: Transaction, roomId: string, messageId: string, userId: string): Promise<OwnedMessageRow | undefined> {
    const [row] = await tx.rows<OwnedMessageRow>('SELECT m.id,m.stream_id,m.version,m.deleted_at FROM messages m JOIN room_members sender ON sender.room_id=m.room_id AND sender.id=m.sender_member_id WHERE m.room_id=? AND m.id=? AND sender.user_id=? FOR UPDATE', [roomId, messageId, userId]);
    return row;
  }

  async deletionRequest(tx: Transaction, userId: string, messageId: string): Promise<MessageIdRow | undefined> {
    const [row] = await tx.rows<MessageIdRow>('SELECT id FROM deletion_requests WHERE actor_user_id=? AND message_id=? FOR UPDATE', [userId, messageId]);
    return row;
  }

  async blockMessageAndCopies(tx: Transaction, roomId: string, messageId: string, userId: string, requestId: string): Promise<void> {
    await tx.execute('INSERT INTO deletion_requests (id,actor_user_id,room_id,message_id) VALUES (?,?,?,?)', [requestId, userId, roomId, messageId]);
    await tx.execute('UPDATE messages SET deleted_at=COALESCE(deleted_at,UTC_TIMESTAMP(3)),text_content=NULL,version=version+1 WHERE room_id=? AND id=?', [roomId, messageId]);
    await tx.execute('UPDATE command_receipts SET deleted=1,payload_digest=NULL WHERE room_id=? AND message_id=?', [roomId, messageId]);
    await tx.execute("UPDATE message_publications SET state='REVOKED' WHERE room_id=? AND (source_message_id=? OR published_message_id=?)", [roomId, messageId, messageId]);
    await tx.execute('UPDATE messages SET deleted_at=UTC_TIMESTAMP(3),text_content=NULL,version=version+1 WHERE room_id=? AND deletion_root_id=? AND deleted_at IS NULL', [roomId, messageId]);
  }

  attachedAssets(tx: Transaction, roomId: string, messageId: string): Promise<MessageIdRow[]> {
    return tx.rows<MessageIdRow>('SELECT a.id FROM media_assets a JOIN message_attachments x ON x.asset_id=a.id JOIN messages m ON m.room_id=x.room_id AND m.id=x.message_id WHERE m.room_id=? AND (m.id=? OR m.deletion_root_id=?) FOR UPDATE', [roomId, messageId, messageId]);
  }

  async blockAsset(tx: Transaction, assetId: string): Promise<void> {
    await tx.execute("UPDATE media_assets SET state='DELETING',deleted_at=COALESCE(deleted_at,UTC_TIMESTAMP(3)) WHERE id=? AND state<>'DELETED'", [assetId]);
  }

  async nextDeletionOrder(tx: Transaction, roomId: string): Promise<bigint> {
    const [counter] = await tx.rows<RowDataPacket & { last_order: string }>('SELECT last_order FROM room_counters WHERE room_id=? FOR UPDATE', [roomId]);
    const order = BigInt(counter!.last_order) + 1n;
    await tx.execute('UPDATE room_counters SET last_order=? WHERE room_id=?', [order.toString(), roomId]);
    return order;
  }

  async event(tx: Transaction, row: { id: string; room_id: string; stream_id: string }, version: string, order: bigint, kind: MessageEventKind): Promise<string> {
    const id = randomUUID();
    await tx.execute('INSERT INTO room_events (id,room_id,stream_id,message_id,message_version,event_order,kind) VALUES (?,?,?,?,?,?,?)', [id, row.room_id, row.stream_id, row.id, version, order.toString(), kind]);
    return id;
  }
}
