import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from './transactions.js';
import { ApiError, object } from './auth-core.js';
import { createRoom, joinRoom, leaveRoom, lockRoom, uuid } from './repositories.js';

export function identifier(value: unknown): string {
  try { if (typeof value !== 'string') throw new Error(); return uuid(value); }
  catch { throw new ApiError('INVALID_REQUEST', 400); }
}
async function manager(tx: Transaction, userId: string): Promise<boolean> {
  const [row] = await tx.rows<RowDataPacket>(`SELECT manage_rooms FROM admin_capabilities WHERE user_id=?${tx.writable ? ' FOR UPDATE' : ''}`, [userId]);
  return Number(row?.manage_rooms) === 1;
}
const history = (value: unknown): 'ALL_AVAILABLE' | 'SINCE_JOIN' => {
  if (value !== 'ALL_AVAILABLE' && value !== 'SINCE_JOIN') throw new ApiError('INVALID_REQUEST', 400);
  return value;
};
async function audit(tx: Transaction, userId: string, roomId: string, action: string) {
  // No messages, nicknames, birthdays, tokens or free-form request payloads in audit events.
  await tx.execute('INSERT INTO audit_events (id,actor_user_id,room_id,action) VALUES (?,?,?,?)', [randomUUID(), userId, roomId, action]);
}
export async function provisionRoom(tx: Transaction, userId: string, body: unknown) {
  if (!await manager(tx, userId)) throw new ApiError('FORBIDDEN', 403);
  const input = object(body, ['name', 'mode', 'ownerUserId', 'historyPolicy']);
  if (typeof input.name !== 'string') throw new ApiError('INVALID_REQUEST', 400);
  const name = input.name.normalize('NFC').trim();
  if (![...name].length || [...name].length > 80 || /[\p{Cc}\p{Cf}]/u.test(name) || (input.mode !== 'FAN' && input.mode !== 'GROUP')) throw new ApiError('INVALID_REQUEST', 400);
  const ownerId = identifier(input.ownerUserId);
  const policy = history(input.historyPolicy);
  const [owner] = await tx.rows<RowDataPacket>("SELECT u.id FROM users u JOIN creator_accounts c ON c.user_id=u.id AND c.enabled=1 JOIN platform_soop s ON s.user_id=u.id AND s.status='VERIFIED' WHERE u.id=? AND u.status='ACTIVE' FOR UPDATE", [ownerId]);
  if (!owner) throw new ApiError('INVALID_REQUEST', 400);
  const roomId = await createRoom(tx, name, input.mode);
  await tx.execute('UPDATE rooms SET history_policy=? WHERE id=?', [policy, roomId]);
  const actorId = await joinRoom(tx, roomId, ownerId);
  await tx.execute("UPDATE room_members SET role='STREAMER' WHERE id=?", [actorId]);
  await tx.execute('UPDATE rooms SET owner_member_id=? WHERE id=?', [actorId, roomId]);
  await audit(tx, userId, roomId, 'ROOM_CREATED');
  return { roomId, ownerActorId: actorId };
}
export async function listRooms(tx: Transaction, userId: string, after?: string) {
  const rows = await tx.rows<RowDataPacket>(`SELECT r.id,r.name,r.mode,m.id AS actor_id,m.status AS member_status FROM rooms r LEFT JOIN room_members m ON m.room_id=r.id AND m.user_id=? WHERE r.status='ACTIVE' AND (m.status IS NULL OR m.status<>'BANNED') AND (r.join_policy='OPEN_AUTHENTICATED' OR m.status='ACTIVE') AND r.id>? ORDER BY r.id LIMIT 51`, [userId, after ? identifier(after) : '']);
  return { rooms: rows.slice(0, 50).map(r => ({ roomId: r.id, name: r.name, mode: r.mode, joined: r.member_status === 'ACTIVE', ...(r.member_status === 'ACTIVE' ? { actorId: r.actor_id } : {}) })), next: rows.length > 50 ? rows[49]!.id : null };
}
function domainError(error: unknown): never {
  if (error instanceof Error && error.message === 'room_unavailable') throw new ApiError('NOT_FOUND', 404);
  if (error instanceof Error && ['membership_banned', 'join_policy_unsupported'].includes(error.message)) throw new ApiError('FORBIDDEN', 403);
  if (error instanceof Error && error.message === 'owner_transfer_required') throw new ApiError('CONFLICT', 409);
  throw error;
}
export async function enterRoom(tx: Transaction, roomId: string, userId: string) {
  try {
    const actorId = await joinRoom(tx, identifier(roomId), userId);
    // Return this membership's snapshot, not the room's later mutable policy.
    const [period] = await tx.rows<RowDataPacket>('SELECT p.history_policy,p.policy_version,p.visible_from_order FROM room_members m JOIN membership_periods p ON p.id=m.active_period_id AND p.room_id=m.room_id AND p.member_id=m.id WHERE m.id=?', [actorId]);
    return { actorId, historyPolicy: period!.history_policy, policyVersion: period!.policy_version, visibleFromOrder: String(period!.visible_from_order) };
  } catch (error) { domainError(error); }
}
export async function exitRoom(tx: Transaction, roomId: string, userId: string) {
  try { await leaveRoom(tx, identifier(roomId), userId); }
  catch (error) { domainError(error); }
}
export async function setHistoryPolicy(tx: Transaction, roomId: string, userId: string, body: unknown) {
  const input = object(body, ['historyPolicy']);
  const policy = history(input.historyPolicy);
  try {
    const room = await lockRoom(tx, identifier(roomId));
    const [owner] = await tx.rows<RowDataPacket>("SELECT m.id FROM room_members m JOIN membership_periods p ON p.id=m.active_period_id AND p.room_id=m.room_id AND p.member_id=m.id WHERE m.id=? AND m.room_id=? AND m.user_id=? AND m.role='STREAMER' AND m.status='ACTIVE' AND p.left_at IS NULL FOR UPDATE", [room.owner_member_id, roomId, userId]);
    if (!owner && !await manager(tx, userId)) throw new ApiError('FORBIDDEN', 403);
    if (room.history_policy !== policy) {
      await tx.execute('UPDATE rooms SET history_policy=?,policy_version=policy_version+1 WHERE id=?', [policy, roomId]);
      await audit(tx, userId, roomId, 'HISTORY_POLICY_CHANGED');
    }
    return { historyPolicy: policy, policyVersion: room.policy_version + (room.history_policy === policy ? 0 : 1) };
  } catch (error) { domainError(error); }
}
