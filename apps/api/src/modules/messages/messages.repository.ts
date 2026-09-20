import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from '../../infrastructure/database/transactions.js';
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
    if (!tx.writable) {
      const row = await tx.prisma.messages.findFirst({ where: { room_id: roomId, id: messageId }, select: {
        id: true, room_id: true, stream_id: true, sender_member_id: true, content_owner_user_id: true, deletion_root_id: true, quote_id: true, text_content: true, content_kind: true, version: true, created_order: true, created_at: true, deleted_at: true, moderated: true,
        stream: { select: { kind: true } }, content_owner: { select: { status: true } },
        sender: { select: { user: { select: { status: true, profile: { select: { user_id: true, nickname: true, avatar: { select: { id: true, owner_user_id: true, kind: true, room_id: true, state: true, deleted_at: true } } } } } } } },
        deletion_root: { select: { deleted_at: true, moderated: true, content_owner: { select: { status: true } } } },
      } });
      if (!row) return undefined;
      const profile = row.sender.user.profile, avatar = profile?.avatar, root = row.deletion_root;
      return { id: row.id, room_id: row.room_id, stream_id: row.stream_id, sender_member_id: row.sender_member_id, content_owner_user_id: row.content_owner_user_id, deletion_root_id: row.deletion_root_id, quote_id: row.quote_id, text_content: row.text_content, content_kind: row.content_kind, version: String(row.version), created_order: String(row.created_order), created_at: row.created_at, deleted_at: row.deleted_at, moderated: Number(row.moderated), stream_kind: row.stream.kind, nickname: profile?.nickname ?? '', content_owner_status: row.content_owner.status,
        root_blocked: Number(row.deletion_root_id !== null && (!root || root.deleted_at !== null || root.moderated || ['DELETING', 'DELETED'].includes(root.content_owner.status))),
        avatar_id: avatar && avatar.owner_user_id === profile?.user_id && avatar.kind === 'AVATAR' && avatar.room_id === null && avatar.state === 'READY' && avatar.deleted_at === null && row.sender.user.status === 'ACTIVE' ? avatar.id : null };
    }
    const [row] = await tx.rows<MessageRow>(`SELECT m.id,m.room_id,m.stream_id,m.sender_member_id,m.content_owner_user_id,m.deletion_root_id,m.quote_id,m.text_content,m.content_kind,m.version,m.created_order,m.created_at,m.deleted_at,m.moderated,s.kind AS stream_kind,p.nickname,u.status AS content_owner_status,av.id AS avatar_id,
    (m.deletion_root_id IS NOT NULL AND (root.id IS NULL OR root.deleted_at IS NOT NULL OR root.moderated=1 OR ru.status IN ('DELETING','DELETED'))) AS root_blocked
    FROM messages m JOIN message_streams s ON s.room_id=m.room_id AND s.id=m.stream_id
    JOIN room_members sender ON sender.room_id=m.room_id AND sender.id=m.sender_member_id
    LEFT JOIN user_profiles p ON p.user_id=sender.user_id JOIN users u ON u.id=m.content_owner_user_id
    LEFT JOIN users su ON su.id=sender.user_id LEFT JOIN media_assets av ON av.id=p.avatar_asset_id AND av.owner_user_id=p.user_id AND av.kind='AVATAR' AND av.room_id IS NULL AND av.state='READY' AND av.deleted_at IS NULL AND su.status='ACTIVE'
    LEFT JOIN messages root ON root.room_id=m.room_id AND root.id=m.deletion_root_id LEFT JOIN users ru ON ru.id=root.content_owner_user_id
    WHERE m.room_id=? AND m.id=?${tx.writable ? ' FOR UPDATE' : ''}`, [roomId, messageId]);
    return row;
  }

  async grant(tx: Transaction, roomId: string, streamId: string, memberId: string): Promise<MessageGrantRow | undefined> {
    if (tx.writable) return (await tx.rows<MessageGrantRow>('SELECT member_id,room_id,stream_id,can_read FROM stream_grants WHERE room_id=? AND stream_id=? AND member_id=? AND valid_from<=UTC_TIMESTAMP(3) AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(3)) AND revoked_at IS NULL FOR UPDATE', [roomId, streamId, memberId]))[0];
    const now = await tx.now();
    const row = await tx.prisma.stream_grants.findFirst({ where: { room_id: roomId, stream_id: streamId, member_id: memberId, valid_from: { lte: now }, OR: [{ expires_at: null }, { expires_at: { gt: now } }], revoked_at: null }, select: { member_id: true, room_id: true, stream_id: true, can_read: true } });
    return row ? { ...row, can_read: Number(row.can_read) } : undefined;
  }
  async attachments(tx: Transaction, roomId: string, messageId: string): Promise<MessageAttachmentRow[]> {
    const rows = await tx.prisma.message_attachments.findMany({ where: { room_id: roomId, message_id: messageId, asset: { state: 'READY', deleted_at: null, owner: { status: { notIn: ['DELETING', 'DELETED'] } } } }, orderBy: { position: 'asc' }, select: { asset: { select: { id: true, objects: { where: { state: 'READY', variant: { in: ['image', 'video', 'poster'] } }, orderBy: { variant: 'asc' }, select: { width: true, height: true, variant: true } } } } } });
    return rows.flatMap(row => row.asset.objects.map(object => ({ id: row.asset.id, width: Number(object.width), height: Number(object.height), variant: object.variant })));
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
    await tx.prisma.message_streams.create({ data: { id: streamId, room_id: roomId, kind: 'RESTRICTED' }, select: { id: true } });
    await tx.prisma.stream_pairs.create({ data: { id: randomUUID(), room_id: roomId, left_member_id: members[0], right_member_id: members[1], stream_id: streamId }, select: { id: true } });
    await tx.prisma.stream_grants.createMany({ data: members.map(member_id => ({ id: randomUUID(), room_id: roomId, stream_id: streamId, member_id, can_read: true, can_send: true })) });
    await tx.prisma.room_members.updateMany({ where: { room_id: roomId, id: { in: members } }, data: { acl_epoch: { increment: 1n } } });
  }
  async pendingOwner(tx: Transaction, roomId: string): Promise<boolean> {
    // Before the room lock, matching bootstrap order; current read avoids RR
    // snapshots and serializes sends with actual owner/inbox grant attachment.
    return (await tx.rows("SELECT room_id FROM default_room_bindings WHERE room_id=? AND owner_bound=0 FOR UPDATE", [roomId])).length === 1;
  }
  async pendingInbox(tx: Transaction, roomId: string, actorId: string): Promise<string> {
    // Only ROOM_OWNER creates an unpaired restricted stream, with one real fan
    // grant. The room lock serializes discovery/creation and later owner binding.
    const rows = await tx.rows<{ id: string }>(`SELECT s.id FROM message_streams s
      JOIN stream_grants g ON g.room_id=s.room_id AND g.stream_id=s.id
      LEFT JOIN stream_pairs p ON p.room_id=s.room_id AND p.stream_id=s.id
      WHERE s.room_id=? AND s.kind='RESTRICTED' AND g.member_id=? AND p.id IS NULL FOR UPDATE`, [roomId, actorId]);
    if (rows.length > 1) throw new Error('owner_inbox_conflict');
    if (rows[0]) return rows[0].id;
    const id = randomUUID();
    await tx.prisma.message_streams.create({ data: { id, room_id: roomId, kind: 'RESTRICTED' }, select: { id: true } });
    await tx.prisma.stream_grants.create({ data: { id: randomUUID(), room_id: roomId, stream_id: id,
      member_id: actorId, can_read: true, can_send: true }, select: { id: true } });
    await tx.prisma.room_members.update({ where: { id: actorId }, data: { acl_epoch: { increment: 1n } }, select: { id: true } });
    return id;
  }
  sendGrants(tx: Transaction, roomId: string, streamId: string, members: [string, string]): Promise<MessageSendGrantRow[]> {
    return tx.rows<MessageSendGrantRow>('SELECT member_id,can_read,can_send FROM stream_grants WHERE room_id=? AND stream_id=? AND member_id IN (?,?) AND revoked_at IS NULL AND valid_from<=UTC_TIMESTAMP(3) AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(3)) ORDER BY member_id FOR UPDATE', [roomId, streamId, ...members]);
  }

  async room(tx: Transaction, roomId: string): Promise<MessageRoomRow | undefined> {
    const [row] = await tx.rows<MessageRoomRow>('SELECT id,status,owner_member_id FROM rooms WHERE id=? FOR UPDATE', [roomId]);
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

  async requireAsset(tx: Transaction, roomId: string, userId: string, kind: 'PHOTO' | 'VIDEO', assetId: string): Promise<{ declaredBytes: number } | undefined> {
    const assets = await tx.rows<MessageIdRow & { declared_bytes: string }>("SELECT id,declared_bytes FROM media_assets WHERE room_id=? AND id=? AND owner_user_id=? AND kind=? AND state='READY' AND deleted_at IS NULL AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE", [roomId, assetId, userId, kind]);
    const attached = await tx.rows<MessageIdRow>('SELECT id FROM message_attachments WHERE asset_id=? FOR UPDATE', [assetId]);
    return assets.length === 1 && attached.length === 0 ? { declaredBytes: Number(assets[0]!.declared_bytes) } : undefined;
  }

  async insertMessage(tx: Transaction, fields: { id: string; roomId: string; streamId: string; actorId: string; userId: string; quoteId: string | null; content: SendInput['content']; order: bigint }): Promise<void> {
    const { id, roomId, streamId, actorId, userId, quoteId, content, order } = fields;
    await tx.prisma.messages.create({ data: { id, room_id: roomId, stream_id: streamId, sender_member_id: actorId, content_owner_user_id: userId, quote_id: quoteId, content_kind: content.type, text_content: content.type === 'TEXT' ? content.text : null, created_order: order }, select: { id: true } });
    if (content.type === 'PHOTO' || content.type === 'VIDEO') await tx.prisma.message_attachments.createMany({ data: content.assetIds.map((asset_id, position) => ({ id: randomUUID(), room_id: roomId, message_id: id, asset_id, position })) });
  }
  async insertReceipt(tx: Transaction, fields: { roomId: string; actorId: string; clientMessageId: string; messageId: string; payloadDigest: Buffer }): Promise<void> {
    await tx.prisma.command_receipts.create({ data: { id: randomUUID(), room_id: fields.roomId, actor_id: fields.actorId, client_message_id: fields.clientMessageId, message_id: fields.messageId, payload_digest: new Uint8Array(fields.payloadDigest) }, select: { id: true } });
  }
  stickerInvalidationCandidate(tx: Transaction, assetId: string) {
    return tx.prisma.message_stickers.findFirst({ where: { sticker: { asset_id: assetId, status: 'REVOKED' }, message: { content_kind: 'STICKER', moderated: false, deleted_at: null } },
      orderBy: [{ room_id: 'asc' }, { message_id: 'asc' }], select: { room_id: true, message_id: true } });
  }
  stickerInvalidationBatch(tx: Transaction, roomId: string, assetId: string) {
    // Current rows after the room lock, not the candidate lookup's older snapshot.
    // Bound one room/50 messages; catalog revocation itself never takes room locks.
    return tx.rows<{ id: string; room_id: string; stream_id: string; version: string }>(`SELECT m.id,m.room_id,m.stream_id,m.version
      FROM messages m JOIN message_stickers ms ON ms.room_id=m.room_id AND ms.message_id=m.id JOIN sticker_catalog sc ON sc.id=ms.sticker_id
      WHERE m.room_id=? AND sc.asset_id=? AND sc.status='REVOKED' AND m.content_kind='STICKER' AND m.moderated=0 AND m.deleted_at IS NULL
      ORDER BY m.id LIMIT 50 FOR UPDATE`, [roomId, assetId]);
  }
  moderateSticker(tx: Transaction, roomId: string, messageId: string) {
    return tx.prisma.messages.updateMany({ where: { room_id: roomId, id: messageId, moderated: false, deleted_at: null, content_kind: 'STICKER' }, data: { moderated: true, version: { increment: 1n } } });
  }
  async ownedMessage(tx: Transaction, roomId: string, messageId: string, userId: string): Promise<OwnedMessageRow | undefined> {
    const [row] = await tx.rows<OwnedMessageRow>('SELECT m.id,m.stream_id,m.version,m.deleted_at FROM messages m JOIN room_members sender ON sender.room_id=m.room_id AND sender.id=m.sender_member_id WHERE m.room_id=? AND m.id=? AND sender.user_id=? FOR UPDATE', [roomId, messageId, userId]);
    return row;
  }

  async deletionRequest(tx: Transaction, userId: string, messageId: string): Promise<{ id: string; requested_at: Date } | undefined> {
    const [row] = await tx.rows<{ id: string; requested_at: Date }>('SELECT id,requested_at FROM deletion_requests WHERE actor_user_id=? AND message_id=? FOR UPDATE', [userId, messageId]);
    return row;
  }

  async blockMessageAndCopies(tx: Transaction, roomId: string, messageId: string, userId: string, requestId: string, requestedAt: Date, existing: boolean): Promise<void> {
    const now = await tx.now();
    if (!existing) await tx.prisma.deletion_requests.create({ data: { id: requestId, actor_user_id: userId, room_id: roomId, message_id: messageId, requested_at: requestedAt }, select: { id: true } });
    await tx.prisma.messages.updateMany({ where: { room_id: roomId, id: messageId, deleted_at: null }, data: { deleted_at: now, text_content: null, version: { increment: 1n } } });
    await tx.prisma.command_receipts.updateMany({ where: { room_id: roomId, message_id: messageId }, data: { deleted: true, payload_digest: null } });
    await tx.prisma.message_publications.updateMany({ where: { room_id: roomId, OR: [{ source_message_id: messageId }, { published_message_id: messageId }] }, data: { state: 'REVOKED' } });
    await tx.prisma.messages.updateMany({ where: { room_id: roomId, deletion_root_id: messageId, deleted_at: null }, data: { deleted_at: now, text_content: null, version: { increment: 1n } } });
  }
  attachedAssets(tx: Transaction, roomId: string, messageId: string): Promise<MessageIdRow[]> {
    return tx.rows<MessageIdRow>('SELECT a.id FROM media_assets a JOIN message_attachments x ON x.asset_id=a.id JOIN messages m ON m.room_id=x.room_id AND m.id=x.message_id WHERE m.room_id=? AND (m.id=? OR m.deletion_root_id=?) FOR UPDATE', [roomId, messageId, messageId]);
  }

  async blockAsset(tx: Transaction, assetId: string): Promise<void> {
    await tx.prisma.media_assets.updateMany({ where: { id: assetId, state: { not: 'DELETED' }, deleted_at: null }, data: { deleted_at: await tx.now() } });
    await tx.prisma.media_assets.updateMany({ where: { id: assetId, state: { not: 'DELETED' } }, data: { state: 'DELETING' } });
  }
  async nextDeletionOrder(tx: Transaction, roomId: string): Promise<bigint> {
    const [counter] = await tx.rows<RowDataPacket & { last_order: string }>('SELECT last_order FROM room_counters WHERE room_id=? FOR UPDATE', [roomId]);
    const order = BigInt(counter!.last_order) + 1n;
    await tx.prisma.room_counters.updateMany({ where: { room_id: roomId }, data: { last_order: order } });
    return order;
  }
  async event(tx: Transaction, row: { id: string; room_id: string; stream_id: string }, version: string, order: bigint, kind: MessageEventKind): Promise<string> {
    const id = randomUUID();
    await tx.prisma.room_events.create({ data: { id, room_id: row.room_id, stream_id: row.stream_id, message_id: row.id, message_version: BigInt(version), event_order: order, kind }, select: { id: true } });
    return id;
  }

}
