import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { ApiError, digest } from '../auth/auth-primitives.js';
import { updateProfileInput } from './dto/update-profile.dto.js';
import { uuid } from '../../common/validation/identifier.js';
import { JobsCoreService } from '../jobs/jobs-core.service.js';
import { projectActorProfileDto } from './profile-projection.js';
import { AccessService } from '../access/access.service.js';
import type { ActiveMember } from '../access/access.types.js';
import { UsersRepository } from './users.repository.js';

@Injectable()
export class UsersCoreService {
  constructor(@Inject(UsersRepository) private readonly repository: UsersRepository, @Inject(AccessService) private readonly access: AccessService, @Inject(JobsCoreService) private readonly jobs: JobsCoreService) {}
  async selfProfile(tx: Transaction, userId: string) {
    const [profile] = await this.repository.self(tx, userId);
    if (!profile) throw new ApiError('NOT_FOUND', 404);
    return { id: userId, nickname: profile.nickname, avatar: profile.visible_avatar_id ? { assetId: profile.visible_avatar_id } : null, birthday: profile.birthday_month !== null ? { month: profile.birthday_month, day: profile.birthday_day } : null, birthdayVisibleToStreamers: Number(profile.birthday_visible_to_streamers) === 1 };
  }

  async updateProfile(tx: Transaction, userId: string, body: unknown) {
    const input = updateProfileInput(body);
    // Match media worker ownership locking before profile/asset locks. Session validation already
    // holds this owner in HTTP writes; keep the invariant for direct internal callers as well.
    const owner = await this.repository.lockOwner(tx, userId);
    if (!owner.length) throw new ApiError('NOT_FOUND', 404);
    const [current] = await this.repository.lockProfile(tx, userId);
    if (!current) throw new ApiError('NOT_FOUND', 404);
    const name = input.nickname ?? current.nickname;
    const birthday = input.birthday === undefined ? (current.birthday_month === null ? null : { month: current.birthday_month, day: current.birthday_day }) : input.birthday;
    const visible = input.birthdayVisibleToStreamers ?? Number(current.birthday_visible_to_streamers) === 1;
    const avatar = input.avatarAssetId === undefined ? current.avatar_asset_id : input.avatarAssetId;
    if ('avatarAssetId' in input && avatar !== null) {
      const asset = await this.repository.attachableAvatar(tx, avatar, userId, avatar === current.avatar_asset_id);
      if (!asset.length) throw new ApiError('NOT_FOUND', 404);
    }
    const publicChanged = name !== current.nickname || avatar !== current.avatar_asset_id;
    const oldBirthday = Number(current.birthday_visible_to_streamers) === 1 && current.birthday_month !== null ? [current.birthday_month, current.birthday_day] : null;
    const newBirthday = visible && birthday ? [birthday.month, birthday.day] : null;
    const streamerChanged = JSON.stringify(oldBirthday) !== JSON.stringify(newBirthday);
    await this.repository.update(tx, name, birthday?.month ?? null, birthday?.day ?? null, visible, avatar, userId);
    if (current.avatar_asset_id !== null && avatar !== current.avatar_asset_id) {
      const removed = await this.repository.blockAvatar(tx, current.avatar_asset_id, userId);
      if (removed.affectedRows) await this.jobs.enqueue(tx, { purpose: 'MEDIA', resourceId: current.avatar_asset_id, dedupeKey: digest(`avatar-cleanup:${current.avatar_asset_id}`) });
    }
    if (publicChanged || streamerChanged) {
      const change = randomUUID();
      await this.repository.recordChange(tx, change, userId, publicChanged, streamerChanged);
      await this.jobs.enqueue(tx, { purpose: 'REALTIME_HINT', resourceId: change });
    }
    return this.selfProfile(tx, userId);
  }

  private canViewActor(viewer: ActiveMember, actorId: string, role: string): boolean {
    return viewer.mode !== 'FAN' || viewer.role === 'STREAMER' || role === 'STREAMER' || actorId === viewer.id;
  }

  // Same snapshot as media authorization. This proves a current, room-visible
  // profile reference, not ownership of an arbitrary globally scoped asset.
  async requireActorAvatar(tx: Transaction, roomId: string, userId: string, actorId: string, assetId: string): Promise<void> {
    const viewer = await this.access.requireActiveMember(tx, uuid(roomId), userId);
    const profile = await this.repository.actorAvatar(tx, roomId, uuid(actorId));
    const avatar = profile?.user.profile?.avatar;
    if (!profile || await this.access.actorBlocked(tx, roomId, viewer.id, actorId) || !this.canViewActor(viewer, profile.id, profile.role) || !avatar || avatar.id !== uuid(assetId) ||
      avatar.owner_user_id !== profile.user_id || avatar.kind !== 'AVATAR' || avatar.room_id !== null ||
      avatar.state !== 'READY' || avatar.deleted_at !== null) throw new ApiError('NOT_FOUND', 404);
  }

  private async actorProfile(tx: Transaction, viewer: ActiveMember, actorId: string, key: Buffer) {
    const [profile] = await this.repository.actor(tx, viewer.room_id, uuid(actorId));
    if (!profile || await this.access.actorBlocked(tx, viewer.room_id, viewer.id, actorId) || !this.canViewActor(viewer, profile.actor_id, profile.role)) throw new ApiError('NOT_FOUND', 404);
    const visibleBirthday = viewer.role === 'STREAMER' && Number(profile.birthday_visible_to_streamers) === 1 && profile.birthday_month !== null && profile.birthday_day !== null ? { month: profile.birthday_month, day: profile.birthday_day } : null;
    const projection = projectActorProfileDto({ actorId: profile.actor_id, nickname: profile.nickname, avatar: profile.visible_avatar_id ? { assetId: profile.visible_avatar_id } : null, role: profile.role, visibleBirthday });
    // Opaque viewer-specific revision of visible fields only: hidden birthdays never signal activity to fans.
    const revision = createHmac('sha256', key).update(JSON.stringify([viewer.room_id, viewer.id, viewer.active_period_id, profile.active_period_id, projection])).digest('base64url');
    return { ...projection, revision };
  }

  async roomProfile(tx: Transaction, roomId: string, userId: string, actorId: string, key: Buffer) {
    return this.actorProfile(tx, await this.access.requireActiveMember(tx, roomId, userId), actorId, key);
  }

  async profileManifest(tx: Transaction, roomId: string, userId: string, key: Buffer, after?: string) {
    const viewer = await this.access.requireActiveMember(tx, roomId, userId);
    if (viewer.role !== 'STREAMER') throw new ApiError('FORBIDDEN', 403);
    // A revision refresh PAGE, never an authoritative room-wide manifest or a fan activity feed.
    // M06 adds stable-generation sync. A page must not purge actors missing from this page.
    const candidates = await this.repository.manifestCandidates(tx, roomId, viewer.id, after ? uuid(after) : '');
    const profiles = [];
    for (const row of candidates.slice(0, 50)) {
      const profile = await this.actorProfile(tx, viewer, row.id as string, key);
      profiles.push({ actorId: profile.actorId, revision: profile.revision });
    }
    return { schemaVersion: 1, partial: true, profiles, next: candidates.length > 50 ? profiles.at(-1)!.actorId : null };
  }

  // Batch projection for sync uses the same public actor mapper as direct GET. The
  // repository applies viewer-specific visibility before its bounded LIMIT.
  async syncProfiles(tx: Transaction, viewer: ActiveMember) {
    const rows = await this.repository.syncProfiles(tx, viewer.role, viewer.role, viewer.room_id, viewer.mode, viewer.role, viewer.id);
    return rows.map(row => projectActorProfileDto({ actorId: row.id, nickname: row.nickname,
      avatar: row.avatar_id ? { assetId: row.avatar_id } : null, role: row.role,
      visibleBirthday: row.month === null || row.day === null ? null : { month: row.month, day: row.day } }));
  }

}
