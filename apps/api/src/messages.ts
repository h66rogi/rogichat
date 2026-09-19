import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from './transactions.js';
import { ApiError, digest, object } from './auth-core.js';
import { activeMember } from './profiles.js';
import type { ActiveMember } from './profiles.js';
import { identifier } from './rooms.js';
import { nextOrder } from './repositories.js';
import { canReadMessage } from './access.js';
import { enqueueJob } from './jobs.js';

export interface SendInput {
  clientMessageId: string;
  intent: 'SHARED' | 'PRIVATE';
  recipientActorId: string | null;
  quoteId: string | null;
  content: { type: 'TEXT'; text: string };
}
export function sendInput(body: unknown): SendInput {
  const input = object(body, ['clientMessageId', 'intent', 'recipientActorId', 'quoteId', 'content']);
  if (input.intent !== 'SHARED' && input.intent !== 'PRIVATE') throw new ApiError('INVALID_REQUEST', 400);
  if (input.intent === 'SHARED' && input.recipientActorId !== undefined) throw new ApiError('INVALID_REQUEST', 400);
  const content = object(input.content, ['type', 'text']);
  if (content.type !== 'TEXT' || typeof content.text !== 'string') throw new ApiError('INVALID_REQUEST', 400);
  const text = content.text.normalize('NFC');
  if (!text.trim() || [...text].length > 4000 || Buffer.byteLength(text, 'utf8') > 16384 || text.includes(String.fromCharCode(0))) throw new ApiError('INVALID_REQUEST', 400);
  return { clientMessageId: identifier(input.clientMessageId), intent: input.intent,
    recipientActorId: input.intent === 'PRIVATE' ? identifier(input.recipientActorId) : null,
    quoteId: input.quoteId === undefined || input.quoteId === null ? null : identifier(input.quoteId),
    content: { type: 'TEXT', text } };
}

export interface MessageRow extends RowDataPacket {
  id: string; room_id: string; stream_id: string; sender_member_id: string;
  content_owner_user_id: string; deletion_root_id: string | null; quote_id: string | null;
  text_content: string | null; content_kind: string; version: string; created_order: string;
  created_at: Date; deleted_at: Date | null; moderated: number; stream_kind: 'ROOM_SHARED' | 'RESTRICTED';
  nickname: string; content_owner_status: string; root_blocked: number;
}
// Internal only. Always use the caller's authorized fresh snapshot, never a cached row.
export async function loadMessage(tx: Transaction, roomId: string, messageId: string): Promise<MessageRow | undefined> {
  const [row] = await tx.rows<MessageRow>(`SELECT m.id,m.room_id,m.stream_id,m.sender_member_id,m.content_owner_user_id,m.deletion_root_id,m.quote_id,m.text_content,m.content_kind,m.version,m.created_order,m.created_at,m.deleted_at,m.moderated,s.kind AS stream_kind,p.nickname,u.status AS content_owner_status,
    (m.deletion_root_id IS NOT NULL AND (root.id IS NULL OR root.deleted_at IS NOT NULL OR root.moderated=1 OR ru.status IN ('DELETING','DELETED'))) AS root_blocked
    FROM messages m JOIN message_streams s ON s.room_id=m.room_id AND s.id=m.stream_id
    JOIN room_members sender ON sender.room_id=m.room_id AND sender.id=m.sender_member_id
    LEFT JOIN user_profiles p ON p.user_id=sender.user_id JOIN users u ON u.id=m.content_owner_user_id
    LEFT JOIN messages root ON root.room_id=m.room_id AND root.id=m.deletion_root_id LEFT JOIN users ru ON ru.id=root.content_owner_user_id
    WHERE m.room_id=? AND m.id=?${tx.writable ? ' FOR UPDATE' : ''}`, [roomId, messageId]);
  return row;
}
export async function readable(tx: Transaction, viewer: ActiveMember, row: MessageRow): Promise<boolean> {
  const [grant] = row.stream_kind === 'RESTRICTED' ? await tx.rows<RowDataPacket>(`SELECT member_id,room_id,stream_id,can_read FROM stream_grants WHERE room_id=? AND stream_id=? AND member_id=? AND valid_from<=UTC_TIMESTAMP(3) AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(3)) AND revoked_at IS NULL${tx.writable ? ' FOR UPDATE' : ''}`, [row.room_id, row.stream_id, viewer.id]) : [];
  return canReadMessage({ accountActive: true, soopLinked: true, roomId: viewer.room_id, memberRoomId: viewer.room_id,
    roomActive: true, memberId: viewer.id, memberActive: true, periodActive: true,
    visibleFrom: BigInt(viewer.visible_from_order), role: viewer.role, ownerMemberId: null }, {
    roomId: row.room_id, streamId: row.stream_id, streamRoomId: row.room_id, streamKind: row.stream_kind,
    order: BigInt(row.created_order), deleted: row.deleted_at !== null, moderated: Number(row.moderated) === 1,
    deletionRootBlocked: Number(row.root_blocked) === 1 || ['DELETING', 'DELETED'].includes(row.content_owner_status),
    grant: grant ? { roomId: String(grant.room_id), streamId: String(grant.stream_id), memberId: String(grant.member_id), canRead: Number(grant.can_read) === 1, active: true } : null,
  });
}
export async function projectMessage(tx: Transaction, viewer: ActiveMember, row: MessageRow) {
  if (!await readable(tx, viewer, row)) throw new ApiError('NOT_FOUND', 404);
  let quote: { id: string; content: { type: 'TEXT'; text: string } } | null = null;
  if (row.quote_id && !row.deletion_root_id) {
    const source = await loadMessage(tx, row.room_id, row.quote_id);
    // Never recurse/copy a private source into a wider audience, even for a streamer who can read both.
    if (source && (source.stream_kind === 'ROOM_SHARED' || source.stream_id === row.stream_id) && await readable(tx, viewer, source) && source.content_kind === 'TEXT' && source.text_content !== null) {
      quote = { id: source.id, content: { type: 'TEXT', text: source.text_content } };
    }
  }
  return { id: row.id, version: String(row.version), createdAt: row.created_at.toISOString(),
    audience: row.stream_kind === 'ROOM_SHARED' ? 'SHARED' : 'PRIVATE',
    author: row.deletion_root_id ? { kind: 'anonymous' as const } : { kind: 'member' as const, actorId: row.sender_member_id, nickname: row.nickname ?? '사용자', avatar: null },
    content: { type: 'TEXT' as const, text: row.text_content }, quote };
}
export async function getMessage(tx: Transaction, roomId: string, userId: string, messageId: string) {
  const viewer = await activeMember(tx, identifier(roomId), userId);
  const row = await loadMessage(tx, roomId, identifier(messageId));
  if (!row) throw new ApiError('NOT_FOUND', 404);
  return projectMessage(tx, viewer, row);
}

async function sendStream(tx: Transaction, viewer: ActiveMember, input: SendInput): Promise<string> {
  if (input.intent === 'SHARED') {
    if (viewer.mode === 'FAN' && viewer.role !== 'STREAMER') throw new ApiError('FORBIDDEN', 403);
    const rows = await tx.rows<RowDataPacket>("SELECT id FROM message_streams WHERE room_id=? AND kind='ROOM_SHARED' FOR UPDATE", [viewer.room_id]);
    if (rows.length !== 1) throw new ApiError('CONFLICT', 409);
    return String(rows[0]!.id);
  }
  if (viewer.id === input.recipientActorId) throw new ApiError('INVALID_REQUEST', 400);
  const [target] = await tx.rows<RowDataPacket>(`SELECT m.id,m.role FROM room_members m JOIN membership_periods p ON p.id=m.active_period_id AND p.room_id=m.room_id AND p.member_id=m.id JOIN users u ON u.id=m.user_id AND u.status='ACTIVE' JOIN platform_soop s ON s.user_id=u.id AND s.status='VERIFIED' WHERE m.room_id=? AND m.id=? AND m.status='ACTIVE' AND p.left_at IS NULL FOR UPDATE`, [viewer.room_id, input.recipientActorId]);
  if (!target) throw new ApiError('NOT_FOUND', 404);
  if (viewer.mode === 'FAN' && !((viewer.role === 'FAN' && target.role === 'STREAMER') || (viewer.role === 'STREAMER' && target.role === 'FAN'))) throw new ApiError('FORBIDDEN', 403);
  const members = [viewer.id, input.recipientActorId!].sort();
  const [pair] = await tx.rows<RowDataPacket>('SELECT stream_id FROM stream_pairs WHERE room_id=? AND left_member_id=? AND right_member_id=? FOR UPDATE', [viewer.room_id, ...members]);
  const streamId = pair ? String(pair.stream_id) : randomUUID();
  if (!pair) {
    await tx.execute("INSERT INTO message_streams (id,room_id,kind) VALUES (?,?,'RESTRICTED')", [streamId, viewer.room_id]);
    await tx.execute('INSERT INTO stream_pairs (id,room_id,left_member_id,right_member_id,stream_id) VALUES (?,?,?,?,?)', [randomUUID(), viewer.room_id, ...members, streamId]);
    for (const member of members) await tx.execute('INSERT INTO stream_grants (id,room_id,stream_id,member_id,can_read,can_send) VALUES (?,?,?,?,1,1)', [randomUUID(), viewer.room_id, streamId, member]);
  }
  // An existing pair never repairs expired/revoked grants, including after rejoin.
  const grants = await tx.rows<RowDataPacket>('SELECT member_id,can_read,can_send FROM stream_grants WHERE room_id=? AND stream_id=? AND member_id IN (?,?) AND revoked_at IS NULL AND valid_from<=UTC_TIMESTAMP(3) AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(3)) ORDER BY member_id FOR UPDATE', [viewer.room_id, streamId, ...members]);
  if (grants.length !== 2 || grants.some(g => Number(g.can_read) !== 1) || !grants.some(g => g.member_id === viewer.id && Number(g.can_send) === 1)) throw new ApiError('FORBIDDEN', 403);
  return streamId;
}
export async function recordMessageEvent(tx: Transaction, row: { id: string; room_id: string; stream_id: string }, version: string, order: bigint, kind: 'MESSAGE_CREATED' | 'MESSAGE_DELETED') {
  const id = randomUUID();
  await tx.execute('INSERT INTO room_events (id,room_id,stream_id,message_id,message_version,event_order,kind) VALUES (?,?,?,?,?,?,?)', [id, row.room_id, row.stream_id, row.id, version, order.toString(), kind]);
  await enqueueJob(tx, { purpose: 'REALTIME_HINT', roomId: row.room_id, resourceId: id, dedupeKey: digest(`hint:${id}`) });
}

// Caller must require the current session/account/SOOP on this SAME transaction handle.
export async function sendMessage(tx: Transaction, roomId: string, userId: string, input: SendInput, key: Buffer) {
  const [room] = await tx.rows<RowDataPacket>('SELECT id,status FROM rooms WHERE id=? FOR UPDATE', [identifier(roomId)]);
  if (!room) throw new ApiError('NOT_FOUND', 404);
  const [member] = await tx.rows<RowDataPacket>('SELECT id FROM room_members WHERE room_id=? AND user_id=? FOR UPDATE', [roomId, userId]);
  if (!member) throw new ApiError('NOT_FOUND', 404);
  const hash = createHmac('sha256', key).update('message-command:v1:').update(JSON.stringify(input)).digest();
  const [receipt] = await tx.rows<RowDataPacket>('SELECT message_id,payload_digest,digest_version,deleted FROM command_receipts WHERE room_id=? AND actor_id=? AND client_message_id=? FOR UPDATE', [roomId, member.id, input.clientMessageId]);
  if (receipt && Number(receipt.deleted) === 1) return { clientMessageId: input.clientMessageId, messageId: String(receipt.message_id), status: 'deleted' as const };
  if (room.status !== 'ACTIVE') throw new ApiError('NOT_FOUND', 404);
  const viewer = await activeMember(tx, roomId, userId);
  if (receipt) {
    if (Number(receipt.digest_version) !== 1 || !Buffer.isBuffer(receipt.payload_digest) || receipt.payload_digest.length !== 32 || !timingSafeEqual(hash, receipt.payload_digest)) throw new ApiError('CONFLICT', 409);
    const previous = await loadMessage(tx, roomId, String(receipt.message_id));
    if (!previous || !await readable(tx, viewer, previous)) throw new ApiError('NOT_FOUND', 404);
    return { clientMessageId: input.clientMessageId, messageId: previous.id, status: 'committed' as const, version: String(previous.version) };
  }
  const streamId = await sendStream(tx, viewer, input);
  if (input.quoteId) {
    const quote = await loadMessage(tx, roomId, input.quoteId);
    if (!quote || !await readable(tx, viewer, quote) || (quote.stream_kind !== 'ROOM_SHARED' && quote.stream_id !== streamId)) throw new ApiError('NOT_FOUND', 404);
  }
  const id = randomUUID(); const order = await nextOrder(tx, roomId);
  await tx.execute('INSERT INTO messages (id,room_id,stream_id,sender_member_id,content_owner_user_id,quote_id,text_content,created_order) VALUES (?,?,?,?,?,?,?,?)', [id, roomId, streamId, viewer.id, userId, input.quoteId, input.content.text, order.toString()]);
  await tx.execute('INSERT INTO command_receipts (id,room_id,actor_id,client_message_id,message_id,payload_digest) VALUES (?,?,?,?,?,?)', [randomUUID(), roomId, viewer.id, input.clientMessageId, id, hash]);
  await recordMessageEvent(tx, { id, room_id: roomId, stream_id: streamId }, '1', order, 'MESSAGE_CREATED');
  return { clientMessageId: input.clientMessageId, messageId: id, status: 'committed' as const, version: '1' };
}

// Ownership-only path: leaving, history boundaries and a closed room do not remove author deletion rights.
export async function deleteMessage(tx: Transaction, roomId: string, userId: string, messageId: string) {
  const [room] = await tx.rows<RowDataPacket>('SELECT id FROM rooms WHERE id=? FOR UPDATE', [identifier(roomId)]);
  if (!room) throw new ApiError('NOT_FOUND', 404);
  const [row] = await tx.rows<RowDataPacket>('SELECT m.id,m.stream_id,m.version,m.deleted_at FROM messages m JOIN room_members sender ON sender.room_id=m.room_id AND sender.id=m.sender_member_id WHERE m.room_id=? AND m.id=? AND sender.user_id=? FOR UPDATE', [roomId, identifier(messageId), userId]);
  if (!row) throw new ApiError('NOT_FOUND', 404);
  const [prior] = await tx.rows<RowDataPacket>('SELECT id FROM deletion_requests WHERE actor_user_id=? AND message_id=? FOR UPDATE', [userId, messageId]);
  if (prior) return { requestId: String(prior.id), status: 'blocked' as const };
  const requestId = randomUUID();
  await tx.execute('INSERT INTO deletion_requests (id,actor_user_id,room_id,message_id) VALUES (?,?,?,?)', [requestId, userId, roomId, messageId]);
  await tx.execute('UPDATE messages SET deleted_at=COALESCE(deleted_at,UTC_TIMESTAMP(3)),text_content=NULL,version=version+1 WHERE room_id=? AND id=?', [roomId, messageId]);
  await tx.execute('UPDATE command_receipts SET deleted=1,payload_digest=NULL WHERE room_id=? AND message_id=?', [roomId, messageId]);
  // Publication projections are immediately denied by the root predicate, even before bounded M10 purge.
  // The room counter permits author deletion in CLOSED rooms without calling lockRoom's ACTIVE guard.
  const [counter] = await tx.rows<RowDataPacket>('SELECT last_order FROM room_counters WHERE room_id=? FOR UPDATE', [roomId]);
  const order = BigInt(counter!.last_order as string) + 1n;
  await tx.execute('UPDATE room_counters SET last_order=? WHERE room_id=?', [order.toString(), roomId]);
  await recordMessageEvent(tx, { id: messageId, room_id: roomId, stream_id: String(row.stream_id) }, (BigInt(row.version as string) + 1n).toString(), order, 'MESSAGE_DELETED');
  await enqueueJob(tx, { purpose: 'PURGE', roomId, resourceId: requestId, dedupeKey: digest(`purge:${requestId}`) });
  return { requestId, status: 'blocked' as const };
}
