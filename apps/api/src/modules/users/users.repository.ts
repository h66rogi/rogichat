import { affected } from '../../infrastructure/database/transactions.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { ActiveMember } from '../access/membership.repository.js';
import { canonicalProfileId } from '../auth/soop-profile.contract.js';
interface ProfileRow {
  user_id: string; nickname: string; birthday_month: number | null; birthday_day: number | null;
  birthday_visible_to_streamers: number; revision: string; avatar_asset_id: string | null; visible_avatar_id: string | null;
  provider_avatar_url: string | null;
}

const profileSelect = {
  user_id: true, nickname: true, birthday_month: true, birthday_day: true,
  birthday_visible_to_streamers: true, revision: true, avatar_asset_id: true,
  avatar_customized: true, provider_profile_initialized: true,
  user: { select: { soop: { select: { status: true, provider_subject: true, profile_image_url: true } } } },
  avatar: { select: { id: true, owner_user_id: true, kind: true, room_id: true, state: true, deleted_at: true } },
} satisfies Prisma.user_profilesSelect;
type SelectedProfile = Prisma.user_profilesGetPayload<{ select: typeof profileSelect }>;
function projectProfile(row: SelectedProfile, active = true): ProfileRow {
  const avatar = row.avatar;
  const soop = row.user.soop;
  return { user_id: row.user_id, nickname: row.nickname, birthday_month: row.birthday_month,
    birthday_day: row.birthday_day, birthday_visible_to_streamers: Number(row.birthday_visible_to_streamers),
    revision: String(row.revision), avatar_asset_id: row.avatar_asset_id,
    provider_avatar_url: active && row.avatar_asset_id === null && !row.avatar_customized && row.provider_profile_initialized &&
      soop?.status === 'VERIFIED' && canonicalProfileId(soop.profile_image_url) === Buffer.from(soop.provider_subject).toString('utf8') ? soop.profile_image_url : null,
    visible_avatar_id: avatar && active && avatar.owner_user_id === row.user_id && avatar.kind === 'AVATAR' && avatar.room_id === null && avatar.state === 'READY' && avatar.deleted_at === null ? avatar.id : null };
}

@Injectable()
export class UsersRepository {
  async selfSoop(tx: Transaction, userId: string) {
    const row = await tx.prisma.platform_soop.findUnique({ where: { user_id: userId }, select: { status: true, provider_subject: true,
      profile_image_url: true, user: { select: { profile: { select: { avatar_customized: true, avatar_asset_id: true, provider_profile_initialized: true } } } } } });
    if (row?.status !== 'VERIFIED') return { soop: null, providerAvatarUrl: null };
    const displayId = Buffer.from(row.provider_subject).toString('utf8'), profile = row.user.profile;
    return { soop: { displayId }, providerAvatarUrl: profile && !profile.avatar_customized && profile.avatar_asset_id === null &&
      profile.provider_profile_initialized && canonicalProfileId(row.profile_image_url) === displayId ? row.profile_image_url : null };
  }
  async markCustomized(tx: Transaction, userId: string, nickname: boolean, avatar: boolean) {
    if (nickname || avatar) await tx.prisma.user_profiles.updateMany({ where: { user_id: userId }, data: {
      ...(nickname ? { nickname_customized: true } : {}), ...(avatar ? { avatar_customized: true } : {}),
    } });
  }
  async self(tx: Transaction, userId: string) {
    const rows = await tx.prisma.user_profiles.findMany({ where: { user_id: userId }, select: { ...profileSelect, user: { select: { ...profileSelect.user.select, status: true } } } });
    return rows.map(row => projectProfile(row, row.user.status === 'ACTIVE'));
  }
  lockOwner(tx: Transaction, userId: string) {
    return tx.rows("SELECT id FROM users WHERE id=? AND status='ACTIVE' FOR UPDATE", [userId]);
  }
  lockProfile(tx: Transaction, userId: string) {
    return tx.rows<ProfileRow>('SELECT user_id,nickname,birthday_month,birthday_day,birthday_visible_to_streamers,revision,avatar_asset_id FROM user_profiles WHERE user_id=? FOR UPDATE', [userId]);
  }
  attachableAvatar(tx: Transaction, avatar: string, userId: string, alreadyAssigned: boolean) {
    return tx.rows("SELECT id FROM media_assets WHERE id=? AND owner_user_id=? AND kind='AVATAR' AND room_id IS NULL AND state='READY' AND deleted_at IS NULL AND (expires_at>UTC_TIMESTAMP(3) OR ?) FOR UPDATE", [avatar, userId, alreadyAssigned]);
  }
  update(tx: Transaction, name: string, month: number | null, day: number | null, visible: boolean, avatar: string | null, userId: string) {
    return affected(tx.prisma.user_profiles.updateMany({ where: { user_id: userId }, data: { nickname: name, birthday_month: month, birthday_day: day, birthday_visible_to_streamers: visible, avatar_asset_id: avatar, revision: { increment: 1n } } }));
  }
  async blockAvatar(tx: Transaction, avatar: string, userId: string) {
    const where = { id: avatar, owner_user_id: userId, kind: 'AVATAR', room_id: null, state: { notIn: ['DELETING', 'DELETED'] } };
    await tx.prisma.media_assets.updateMany({ where: { ...where, deleted_at: null }, data: { deleted_at: await tx.now() } });
    return affected(tx.prisma.media_assets.updateMany({ where, data: { state: 'DELETING' } }));
  }
  recordChange(tx: Transaction, change: string, userId: string, publicChanged: boolean, streamerChanged: boolean) {
    return tx.prisma.profile_changes.create({ data: { id: change, user_id: userId, public_changed: publicChanged, streamer_changed: streamerChanged }, select: { id: true } });
  }
  async actor(tx: Transaction, roomId: string, actorId: string) {
    const rows = await tx.prisma.room_members.findMany({ where: { room_id: roomId, id: actorId, status: 'ACTIVE', active_period: { is: { left_at: null } }, user: { status: 'ACTIVE', soop: { is: { status: 'VERIFIED' } }, profile: { isNot: null } } }, select: { id: true, role: true, active_period_id: true, user: { select: { profile: { select: profileSelect } } } } });
    return rows.map(row => ({ ...projectProfile(row.user.profile!), actor_id: row.id, role: row.role as ActiveMember['role'], active_period_id: row.active_period_id! }));
  }
  actorAvatar(tx: Transaction, roomId: string, actorId: string) {
    // Access proof only: no nickname, birthday or provider identity is loaded.
    return tx.prisma.room_members.findFirst({ where: { room_id: roomId, id: actorId, status: 'ACTIVE', active_period: { is: { left_at: null } }, user: { status: 'ACTIVE', soop: { is: { status: 'VERIFIED' } } } }, select: {
      id: true, role: true, user_id: true,
      user: { select: { profile: { select: { avatar: { select: { id: true, owner_user_id: true, kind: true, room_id: true, state: true, deleted_at: true } } } } } },
    } });
  }
  async manifestCandidates(tx: Transaction, roomId: string, actorId: string, after: string) {
    const blocks = await tx.prisma.actor_blocks.findMany({ where: { room_id: roomId, blocker_actor_id: actorId }, select: { target_actor_id: true } });
    return tx.prisma.room_members.findMany({ where: { room_id: roomId, id: { gt: after, notIn: blocks.map(row => row.target_actor_id) }, status: 'ACTIVE', active_period: { is: { left_at: null } }, user: { status: 'ACTIVE', soop: { is: { status: 'VERIFIED' } } } }, orderBy: { id: 'asc' }, take: 51, select: { id: true } });
  }
  async syncProfiles(tx: Transaction, role: string, birthdayRole: string, roomId: string, mode: string, visibilityRole: string, actorId: string) {
    const blocks = await tx.prisma.actor_blocks.findMany({ where: { room_id: roomId, blocker_actor_id: actorId }, select: { target_actor_id: true } });
    const rows = await tx.prisma.room_members.findMany({ where: { room_id: roomId, id: { notIn: blocks.map(row => row.target_actor_id) }, status: 'ACTIVE', active_period: { is: { left_at: null } }, user: { status: 'ACTIVE', soop: { is: { status: 'VERIFIED' } }, profile: { isNot: null } }, ...(mode === 'GROUP' || visibilityRole === 'STREAMER' ? {} : { OR: [{ role: 'STREAMER' as const }, { id: actorId }] }) }, orderBy: { id: 'asc' }, take: 10001, select: { id: true, role: true, user: { select: { profile: { select: profileSelect } } } } });
    return rows.map(row => { const profile = projectProfile(row.user.profile!); return { id: row.id, role: row.role, nickname: profile.nickname, avatar_id: profile.visible_avatar_id, provider_avatar_available: profile.provider_avatar_url !== null, month: role === 'STREAMER' && profile.birthday_visible_to_streamers === 1 ? profile.birthday_month : null, day: birthdayRole === 'STREAMER' && profile.birthday_visible_to_streamers === 1 ? profile.birthday_day : null }; });
  }

}
