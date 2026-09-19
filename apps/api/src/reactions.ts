import { randomUUID } from 'node:crypto';
import emojiRegex from 'emoji-regex';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from './transactions.js';
import { ApiError } from './auth-core.js';
import { activeMember } from './profiles.js';
import { identifier } from './rooms.js';
import { nextOrder } from './repositories.js';
import { loadMessage, readable, recordMessageEvent } from './messages.js';

export function reactionEmoji(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new ApiError('INVALID_REQUEST', 400);
  const emoji = value.normalize('NFC');
  if (!emoji.length || [...emoji].length > 32 || Buffer.byteLength(emoji, 'utf8') > 64) throw new ApiError('INVALID_REQUEST', 400);
  const matches = [...emoji.matchAll(emojiRegex())];
  if (matches.length !== 1 || matches[0]![0] !== emoji) throw new ApiError('INVALID_REQUEST', 400);
  return emoji;
}

async function projection(tx: Transaction, roomId: string, messageId: string, memberId: string) {
  // Binary grouping is essential: the database's human-text collation may equate
  // distinct supplementary emoji or presentation/modifier sequences.
  const rows = await tx.rows<RowDataPacket>(`SELECT MIN(r.emoji) AS emoji,COUNT(*) AS total
    FROM message_reactions r JOIN room_members m ON m.id=r.member_id AND m.room_id=r.room_id
    JOIN users u ON u.id=m.user_id AND u.status NOT IN ('DELETING','DELETED')
    WHERE r.room_id=? AND r.message_id=? GROUP BY BINARY r.emoji ORDER BY BINARY r.emoji`, [roomId, messageId]);
  const [mine] = await tx.rows<RowDataPacket>(`SELECT r.emoji FROM message_reactions r
    JOIN room_members m ON m.id=r.member_id AND m.room_id=r.room_id
    JOIN users u ON u.id=m.user_id AND u.status NOT IN ('DELETING','DELETED')
    WHERE r.room_id=? AND r.message_id=? AND r.member_id=?`, [roomId, messageId, memberId]);
  return { counts: rows.map(row => ({ emoji: String(row.emoji), count: Number(row.total) })), mine: mine ? String(mine.emoji) : null };
}

// Caller requires the active session/account/SOOP in this same transaction.
export async function readReactions(tx: Transaction, roomId: string, userId: string, messageId: string) {
  const viewer = await activeMember(tx, identifier(roomId), userId);
  const message = await loadMessage(tx, roomId, identifier(messageId));
  if (!message || !await readable(tx, viewer, message)) throw new ApiError('NOT_FOUND', 404);
  return projection(tx, roomId, messageId, viewer.id);
}

export async function setReaction(tx: Transaction, roomId: string, userId: string, messageId: string, value: string | null) {
  const emoji = reactionEmoji(value);
  const [room] = await tx.rows<RowDataPacket>("SELECT id FROM rooms WHERE id=? AND status='ACTIVE' FOR UPDATE", [identifier(roomId)]);
  if (!room) throw new ApiError('NOT_FOUND', 404);
  const viewer = await activeMember(tx, roomId, userId);
  const message = await loadMessage(tx, roomId, identifier(messageId));
  if (!message || !await readable(tx, viewer, message)) throw new ApiError('NOT_FOUND', 404);
  const [prior] = await tx.rows<RowDataPacket>('SELECT id,emoji FROM message_reactions WHERE room_id=? AND message_id=? AND member_id=? FOR UPDATE', [roomId, messageId, viewer.id]);
  if ((prior ? String(prior.emoji) : null) === emoji) return projection(tx, roomId, messageId, viewer.id);
  if (emoji === null) await tx.execute('DELETE FROM message_reactions WHERE room_id=? AND message_id=? AND member_id=?', [roomId, messageId, viewer.id]);
  else if (prior) await tx.execute('UPDATE message_reactions SET emoji=? WHERE id=? AND room_id=? AND message_id=? AND member_id=?', [emoji, prior.id, roomId, messageId, viewer.id]);
  else await tx.execute('INSERT INTO message_reactions (id,room_id,message_id,member_id,emoji) VALUES (?,?,?,?,?)', [randomUUID(), roomId, messageId, viewer.id, emoji]);
  await tx.execute('UPDATE messages SET version=version+1 WHERE room_id=? AND id=?', [roomId, messageId]);
  const order = await nextOrder(tx, roomId);
  await recordMessageEvent(tx, message, (BigInt(message.version) + 1n).toString(), order, 'MESSAGE_UPDATED');
  return projection(tx, roomId, messageId, viewer.id);
}
