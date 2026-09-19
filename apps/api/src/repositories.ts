import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from './transactions.js';

export function uuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new Error('invalid_uuid');
  return value;
}

export interface RoomRow extends RowDataPacket {
  id: string; name: string; mode: 'FAN' | 'GROUP'; status: 'ACTIVE' | 'CLOSED';
  history_policy: 'ALL_AVAILABLE' | 'SINCE_JOIN'; join_policy: string; policy_version: number; owner_member_id: string | null;
}
export interface MemberRow extends RowDataPacket {
  id: string; room_id: string; user_id: string; role: 'FAN' | 'MEMBER' | 'STREAMER';
  status: 'ACTIVE' | 'LEFT' | 'BANNED'; active_period_id: string | null;
}

export async function createUser(tx: Transaction, nickname: string): Promise<string> {
  const id = randomUUID();
  await tx.execute('INSERT INTO users (id) VALUES (?)', [id]);
  await tx.execute('INSERT INTO user_profiles (user_id,nickname) VALUES (?,?)', [id, nickname]);
  return id;
}

// Internal provisioning primitive. HTTP callers must separately require manage_rooms capability.
export async function createRoom(tx: Transaction, name: string, mode: 'FAN' | 'GROUP'): Promise<string> {
  const id = randomUUID();
  await tx.execute('INSERT INTO rooms (id,name,mode) VALUES (?,?,?)', [id, name, mode]);
  await tx.execute('INSERT INTO room_counters (room_id) VALUES (?)', [id]);
  await tx.execute('INSERT INTO message_streams (id,room_id,kind) VALUES (?,?,?)', [randomUUID(), id, 'ROOM_SHARED']);
  return id;
}

export async function lockRoom(tx: Transaction, roomId: string): Promise<RoomRow> {
  const [room] = await tx.rows<RoomRow>('SELECT id,name,mode,status,history_policy,join_policy,policy_version,owner_member_id FROM rooms WHERE id=? FOR UPDATE', [uuid(roomId)]);
  if (!room || room.status !== 'ACTIVE') throw new Error('room_unavailable');
  return room;
}

// Commit-ordered, rollback-safe counter. All commands lock room before this counter.
export async function nextOrder(tx: Transaction, roomId: string): Promise<bigint> {
  await lockRoom(tx, roomId);
  const [counter] = await tx.rows<RowDataPacket>('SELECT last_order FROM room_counters WHERE room_id=? FOR UPDATE', [roomId]);
  if (!counter) throw new Error('room_counter_missing');
  const next = BigInt(counter.last_order as string) + 1n;
  await tx.execute('UPDATE room_counters SET last_order=? WHERE room_id=?', [next.toString(), roomId]);
  return next;
}

// Caller owns account/session authorization. Room lock serializes membership and future message writes.
export async function joinRoom(tx: Transaction, roomId: string, userId: string): Promise<string> {
  const room = await lockRoom(tx, roomId);
  if (room.join_policy !== 'OPEN_AUTHENTICATED') throw new Error('join_policy_unsupported');
  const [existing] = await tx.rows<MemberRow>('SELECT id,room_id,user_id,role,status,active_period_id FROM room_members WHERE room_id=? AND user_id=? FOR UPDATE', [roomId, uuid(userId)]);
  if (existing?.status === 'BANNED') throw new Error('membership_banned');
  if (existing?.status === 'ACTIVE' && existing.active_period_id) return existing.id;
  const memberId = existing?.id ?? randomUUID();
  if (!existing) await tx.execute('INSERT INTO room_members (id,room_id,user_id,role) VALUES (?,?,?,?)', [memberId, roomId, userId, room.mode === 'FAN' ? 'FAN' : 'MEMBER']);
  const boundary = await nextOrder(tx, roomId);
  const periodId = randomUUID();
  await tx.execute('INSERT INTO membership_periods (id,room_id,member_id,policy_version,history_policy,visible_from_order) VALUES (?,?,?,?,?,?)',
    [periodId, roomId, memberId, room.policy_version, room.history_policy, room.history_policy === 'ALL_AVAILABLE' ? '0' : boundary.toString()]);
  await tx.execute('UPDATE room_members SET status=?,active_period_id=? WHERE id=?', ['ACTIVE', periodId, memberId]);
  await tx.execute('UPDATE users SET membership_generation=membership_generation+1 WHERE id=?', [userId]);
  return memberId;
}

export async function leaveRoom(tx: Transaction, roomId: string, userId: string): Promise<void> {
  const room = await lockRoom(tx, roomId);
  const [member] = await tx.rows<MemberRow>('SELECT id,room_id,user_id,role,status,active_period_id FROM room_members WHERE room_id=? AND user_id=? FOR UPDATE', [roomId, uuid(userId)]);
  if (!member || member.status !== 'ACTIVE') return;
  if (room.owner_member_id === member.id) throw new Error('owner_transfer_required');
  await tx.execute('UPDATE membership_periods SET left_at=UTC_TIMESTAMP(3) WHERE id=? AND left_at IS NULL', [member.active_period_id]);
  await tx.execute('UPDATE room_members SET status=?,active_period_id=NULL WHERE id=?', ['LEFT', member.id]);
  await tx.execute('UPDATE users SET membership_generation=membership_generation+1 WHERE id=?', [userId]);
}

export async function consumeRate(tx: Transaction, key: Buffer, limit: number, seconds: number): Promise<boolean> {
  if (key.length !== 32 || !Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 86400) throw new Error('invalid_rate_policy');
  // Atomic sliding bucket start uses database UTC; duplicate insert acquires an exclusive row lock.
  await tx.execute('INSERT INTO rate_buckets (key_digest,used,expires_at) VALUES (?,0,TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3))) ON DUPLICATE KEY UPDATE key_digest=key_digest', [key, seconds]);
  const [bucket] = await tx.rows<RowDataPacket>('SELECT used,expires_at<=UTC_TIMESTAMP(3) AS expired FROM rate_buckets WHERE key_digest=? FOR UPDATE', [key]);
  if (!bucket) throw new Error('rate_bucket_missing');
  if (Number(bucket.expired) === 1) await tx.execute('UPDATE rate_buckets SET used=0,expires_at=TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3)) WHERE key_digest=?', [seconds, key]);
  else if (Number(bucket.used) >= limit) return false;
  await tx.execute('UPDATE rate_buckets SET used=used+1 WHERE key_digest=?', [key]);
  return true;
}

export async function collectExpiredRates(tx: Transaction): Promise<number> {
  return (await tx.execute('DELETE FROM rate_buckets WHERE expires_at < TIMESTAMPADD(SECOND,-60,UTC_TIMESTAMP(3)) ORDER BY expires_at LIMIT 100')).affectedRows;
}
