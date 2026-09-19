import { createHmac } from 'node:crypto';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from './transactions.js';
import { ApiError, object } from './auth-core.js';
import { nickname, validBirthday } from './access.js';
import { uuid } from './repositories.js';

interface ProfileRow extends RowDataPacket {
  user_id: string; nickname: string; birthday_month: number | null; birthday_day: number | null;
  birthday_visible_to_streamers: number; revision: string;
}
export interface ActiveMember extends RowDataPacket {
  id: string; room_id: string; user_id: string; role: 'FAN' | 'MEMBER' | 'STREAMER';
  mode: 'FAN' | 'GROUP'; active_period_id: string; visible_from_order: string;
}
export async function activeMember(tx: Transaction, roomId: string, userId: string): Promise<ActiveMember> {
  const [member] = await tx.rows<ActiveMember>(`SELECT m.id,m.room_id,m.user_id,m.role,m.active_period_id,r.mode,p.visible_from_order FROM room_members m JOIN rooms r ON r.id=m.room_id JOIN membership_periods p ON p.id=m.active_period_id AND p.room_id=m.room_id AND p.member_id=m.id WHERE m.room_id=? AND m.user_id=? AND m.status='ACTIVE' AND r.status='ACTIVE' AND p.left_at IS NULL${tx.writable ? ' FOR UPDATE' : ''}`, [uuid(roomId), userId]);
  if (!member) throw new ApiError('NOT_FOUND', 404);
  return member;
}
export async function selfProfile(tx: Transaction, userId: string) {
  const [profile] = await tx.rows<ProfileRow>('SELECT user_id,nickname,birthday_month,birthday_day,birthday_visible_to_streamers,revision FROM user_profiles WHERE user_id=?', [userId]);
  if (!profile) throw new ApiError('NOT_FOUND', 404);
  return { id: userId, nickname: profile.nickname, avatar: null, birthday: profile.birthday_month !== null ? { month: profile.birthday_month, day: profile.birthday_day } : null, birthdayVisibleToStreamers: Number(profile.birthday_visible_to_streamers) === 1 };
}

export async function updateProfile(tx: Transaction, userId: string, body: unknown) {
  const input = object(body, ['nickname', 'birthday', 'birthdayVisibleToStreamers']);
  if (!Object.keys(input).length) throw new ApiError('INVALID_REQUEST', 400);
  const [current] = await tx.rows<ProfileRow>('SELECT user_id,nickname,birthday_month,birthday_day,birthday_visible_to_streamers,revision FROM user_profiles WHERE user_id=? FOR UPDATE', [userId]);
  if (!current) throw new ApiError('NOT_FOUND', 404);
  let name = current.nickname;
  let birthday = current.birthday_month === null ? null : { month: current.birthday_month, day: current.birthday_day };
  let visible = Number(current.birthday_visible_to_streamers) === 1;
  try {
    if ('nickname' in input) name = nickname(input.nickname);
    if ('birthday' in input) {
      if (input.birthday === null) birthday = null;
      else { const value = object(input.birthday, ['month', 'day']); birthday = validBirthday(value.month, value.day); }
    }
    if ('birthdayVisibleToStreamers' in input) {
      if (typeof input.birthdayVisibleToStreamers !== 'boolean') throw new Error('invalid_visibility');
      visible = input.birthdayVisibleToStreamers;
    }
  } catch { throw new ApiError('INVALID_REQUEST', 400); }
  await tx.execute('UPDATE user_profiles SET nickname=?,birthday_month=?,birthday_day=?,birthday_visible_to_streamers=?,revision=revision+1 WHERE user_id=?', [name, birthday?.month ?? null, birthday?.day ?? null, visible, userId]);
  return selfProfile(tx, userId);
}

async function actorProfile(tx: Transaction, viewer: ActiveMember, actorId: string, key: Buffer) {
  const [profile] = await tx.rows<ProfileRow & { actor_id: string; role: string; active_period_id: string }>(
    `SELECT p.user_id,p.nickname,p.birthday_month,p.birthday_day,p.birthday_visible_to_streamers,p.revision,m.id AS actor_id,m.role,m.active_period_id FROM room_members m JOIN users u ON u.id=m.user_id JOIN platform_soop s ON s.user_id=u.id AND s.status='VERIFIED' JOIN user_profiles p ON p.user_id=u.id JOIN membership_periods mp ON mp.id=m.active_period_id AND mp.room_id=m.room_id AND mp.member_id=m.id WHERE m.room_id=? AND m.id=? AND m.status='ACTIVE' AND u.status='ACTIVE' AND mp.left_at IS NULL`, [viewer.room_id, uuid(actorId)]);
  if (!profile || (viewer.mode === 'FAN' && viewer.role !== 'STREAMER' && profile.role !== 'STREAMER' && profile.actor_id !== viewer.id)) throw new ApiError('NOT_FOUND', 404);
  const birthday = viewer.role === 'STREAMER' && Number(profile.birthday_visible_to_streamers) === 1 && profile.birthday_month !== null ? { birthday: { month: profile.birthday_month, day: profile.birthday_day } } : {};
  const projection = { actorId: profile.actor_id, nickname: profile.nickname, avatar: null, role: profile.role, ...birthday };
  // Opaque viewer-specific revision of visible fields only: hidden birthdays never signal activity to fans.
  const revision = createHmac('sha256', key).update(JSON.stringify([viewer.room_id, viewer.id, viewer.active_period_id, profile.active_period_id, projection])).digest('base64url');
  return { ...projection, revision };
}

export async function roomProfile(tx: Transaction, roomId: string, userId: string, actorId: string, key: Buffer) {
  return actorProfile(tx, await activeMember(tx, roomId, userId), actorId, key);
}

export async function profileManifest(tx: Transaction, roomId: string, userId: string, key: Buffer, after?: string) {
  const viewer = await activeMember(tx, roomId, userId);
  if (viewer.role !== 'STREAMER') throw new ApiError('FORBIDDEN', 403);
  // A revision refresh PAGE, never an authoritative room-wide manifest or a fan activity feed.
  // M06 adds stable-generation sync. A page must not purge actors missing from this page.
  const candidates = await tx.rows<RowDataPacket>("SELECT m.id FROM room_members m JOIN users u ON u.id=m.user_id JOIN platform_soop s ON s.user_id=u.id AND s.status='VERIFIED' JOIN membership_periods p ON p.id=m.active_period_id AND p.room_id=m.room_id AND p.member_id=m.id AND p.left_at IS NULL WHERE m.room_id=? AND m.status='ACTIVE' AND u.status='ACTIVE' AND m.id>? ORDER BY m.id LIMIT 51", [roomId, after ? uuid(after) : '']);
  const profiles = [];
  for (const row of candidates.slice(0, 50)) {
    const profile = await actorProfile(tx, viewer, row.id as string, key);
    profiles.push({ actorId: profile.actorId, revision: profile.revision });
  }
  return { schemaVersion: 1, partial: true, profiles, next: candidates.length > 50 ? profiles.at(-1)!.actorId : null };
}
