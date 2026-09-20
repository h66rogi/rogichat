import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from '../../infrastructure/database/transactions.js';
export type MessageWindow = { kind: 'snapshot' | 'history'; from: string } | { kind: 'events'; from: string; high: string };
// SQL filters BEFORE pagination: hidden events must not affect counts, gaps or hasMore.
const grant = (alias: string) => `EXISTS (SELECT 1 FROM stream_grants g WHERE g.room_id=${alias}.room_id AND g.stream_id=${alias}.stream_id AND g.member_id=? AND g.can_read=1 AND g.revoked_at IS NULL AND g.valid_from<=UTC_TIMESTAMP(3) AND (g.expires_at IS NULL OR g.expires_at>UTC_TIMESTAMP(3)))`;
const audience = `m.created_order>=? AND (s.kind='ROOM_SHARED' OR ${grant('m')})`;
const blocked = `(m.deleted_at IS NOT NULL OR m.moderated=1 OR u.status IN ('DELETING','DELETED') OR (m.deletion_root_id IS NOT NULL AND (root.id IS NULL OR root.deleted_at IS NOT NULL OR root.moderated=1 OR ru.status IN ('DELETING','DELETED'))))`;
@Injectable()
export class MessagesQueryRepository {
async page(tx: Transaction, actorId: string, roomId: string, visibleFrom: string, window: MessageWindow, limit: number) {
  const events = window.kind === 'events';
  const range = window.kind === 'snapshot' ? 'm.created_order<=?' : window.kind === 'history' ? 'm.created_order<?' : 'e.event_order>? AND e.event_order<=?';
  const values = window.kind === 'events' ? [window.from, window.high] : [window.from];
  const rows = await tx.rows<RowDataPacket>(`SELECT m.id,m.version,m.created_order,m.created_at,m.deletion_root_id,m.sender_member_id,m.text_content,m.content_kind,s.kind,p.nickname,av.id AS avatar_id,${blocked} AS blocked,
    ${events ? 'e.event_order,' : ''}
    CASE WHEN m.deletion_root_id IS NULL AND q.id IS NOT NULL AND q.content_kind='TEXT' AND q.deleted_at IS NULL AND q.moderated=0 AND qu.status NOT IN ('DELETING','DELETED') AND (q.deletion_root_id IS NULL OR (qr.id IS NOT NULL AND qr.deleted_at IS NULL AND qr.moderated=0 AND qru.status NOT IN ('DELETING','DELETED'))) AND q.created_order>=? AND (qs.kind='ROOM_SHARED' OR (q.stream_id=m.stream_id AND ${grant('q')})) THEN q.id ELSE NULL END AS quote_id,
    q.text_content AS quote_text
    FROM ${events ? 'room_events e JOIN messages m ON m.id=e.message_id AND m.room_id=e.room_id AND m.stream_id=e.stream_id' : 'messages m'}
    JOIN message_streams s ON s.id=m.stream_id AND s.room_id=m.room_id JOIN users u ON u.id=m.content_owner_user_id
    JOIN room_members sender ON sender.id=m.sender_member_id AND sender.room_id=m.room_id LEFT JOIN user_profiles p ON p.user_id=sender.user_id
    LEFT JOIN users su ON su.id=sender.user_id LEFT JOIN media_assets av ON av.id=p.avatar_asset_id AND av.owner_user_id=p.user_id AND av.kind='AVATAR' AND av.room_id IS NULL AND av.state='READY' AND av.deleted_at IS NULL AND su.status='ACTIVE'
    LEFT JOIN messages root ON root.id=m.deletion_root_id AND root.room_id=m.room_id LEFT JOIN users ru ON ru.id=root.content_owner_user_id
    LEFT JOIN messages q ON q.id=m.quote_id AND q.room_id=m.room_id LEFT JOIN message_streams qs ON qs.id=q.stream_id AND qs.room_id=q.room_id LEFT JOIN users qu ON qu.id=q.content_owner_user_id
    LEFT JOIN messages qr ON qr.id=q.deletion_root_id AND qr.room_id=q.room_id LEFT JOIN users qru ON qru.id=qr.content_owner_user_id
    WHERE m.room_id=? AND ${audience} AND ${range} ${events ? '' : `AND NOT ${blocked}`}
    ORDER BY ${events ? 'e.event_order ASC' : 'm.created_order DESC'} LIMIT ?`, [visibleFrom, actorId, roomId, visibleFrom, actorId, ...values, limit]);
  // Batch only already-authorized page IDs. No keys or signed URLs enter the journal projection.
  const mediaIds = rows.filter(row => Number(row.blocked) !== 1 && ['PHOTO', 'VIDEO', 'STICKER'].includes(String(row.content_kind))).map(row => String(row.id));
  const attachments = mediaIds.length ? await tx.prisma.message_attachments.findMany({ where: { room_id: roomId, message_id: { in: mediaIds }, asset: { state: 'READY', deleted_at: null, owner: { status: { notIn: ['DELETING', 'DELETED'] } } } }, orderBy: { position: 'asc' }, select: { message_id: true, asset: { select: { id: true, objects: { where: { state: 'READY', variant: { in: ['image', 'video', 'poster'] } }, orderBy: { variant: 'asc' }, select: { width: true, height: true, variant: true } } } } } }) : [];
  const byMessage = new Map<string, { assetId: string; width: number; height: number; variant: string }[]>();
  for (const attachment of attachments) {
    const values = byMessage.get(attachment.message_id) ?? [];
    values.push(...attachment.asset.objects.map(object => ({ assetId: attachment.asset.id, width: Number(object.width), height: Number(object.height), variant: object.variant })));
    byMessage.set(attachment.message_id, values);
  }
  for (const row of rows) row.attachments = byMessage.get(String(row.id)) ?? [];
  return rows;
}

async affected(tx: Transaction, roomId: string, actorId: string, visibleFrom: string, from: string, high: string) {
    return tx.rows<RowDataPacket>(`SELECT m.id FROM messages m JOIN message_streams s ON s.id=m.stream_id AND s.room_id=m.room_id LEFT JOIN messages quoted ON quoted.id=m.quote_id AND quoted.room_id=m.room_id WHERE m.room_id=? AND ${audience} AND EXISTS (SELECT 1 FROM room_events e WHERE e.room_id=m.room_id AND e.event_order>? AND e.event_order<=? AND (e.message_id=m.quote_id OR e.message_id=m.deletion_root_id OR e.message_id=quoted.deletion_root_id)) LIMIT 1`, [roomId, visibleFrom, actorId, from, high]);
}
}
