import { Inject, Injectable } from '@nestjs/common';
import { AccessService } from '../access/access.service.js';
import { RoomMediaRepository } from './room-media.repository.js';
import { partialPolicy, fields } from './dto/room-media-policy.dto.js';
import type { RoomMediaPolicy } from './dto/room-media-policy.dto.js';
import { randomUUID } from 'node:crypto';
import type { PolicyRow } from './room-media.repository.js';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { ApiError } from '../../modules/auth/auth-primitives.js';
import { identifier } from '../../common/validation/identifier.js';
import { MEDIA_LIMITS } from '../../common/media/media-policy.js';


@Injectable()
export class RoomMediaCoreService {
  constructor(@Inject(RoomMediaRepository) private readonly repository: RoomMediaRepository, @Inject(AccessService) private readonly access: AccessService) {}
  private async currentPolicy(tx: Transaction, roomId: string): Promise<{ row: PolicyRow; policy: RoomMediaPolicy }> {
    const [row] = await this.repository.current(tx, identifier(roomId));
    if (!row) throw new ApiError('NOT_FOUND', 404);
    return { row, policy: {
      photoEnabled: row.photo_enabled === null ? true : Number(row.photo_enabled) === 1,
      videoEnabled: row.video_enabled === null ? true : Number(row.video_enabled) === 1,
      stickerEnabled: row.sticker_enabled === null ? true : Number(row.sticker_enabled) === 1,
      photoMaxBytes: row.photo_max_bytes === null ? MEDIA_LIMITS.photoBytes : Number(row.photo_max_bytes),
      videoMaxBytes: row.video_max_bytes === null ? MEDIA_LIMITS.videoBytes : Number(row.video_max_bytes),
    } };
  }

  // Session/account authorization belongs to the caller, on this same transaction handle.
  async readRoomMediaPolicy(tx: Transaction, roomId: string, userId: string): Promise<RoomMediaPolicy> {
    await this.access.requireActiveMember(tx, identifier(roomId), userId);
    return (await this.currentPolicy(tx, roomId)).policy;
  }

  async setRoomMediaPolicy(tx: Transaction, roomId: string, userId: string, body: unknown): Promise<RoomMediaPolicy> {
    const input = partialPolicy(body);
    const { row, policy } = await this.currentPolicy(tx, roomId);
    const [owner] = await this.repository.owner(tx, row.owner_member_id, roomId, userId);
    if (!owner) {
      const [admin] = await this.repository.manager(tx, userId);
      if (Number(admin?.manage_rooms) !== 1) throw new ApiError('FORBIDDEN', 403);
    }
    const next = { ...policy, ...input };
    if (fields.some(key => next[key] !== policy[key])) {
      await this.repository.update(tx, roomId, next.photoEnabled, next.videoEnabled, next.stickerEnabled, next.photoMaxBytes, next.videoMaxBytes, next.photoEnabled, next.videoEnabled, next.stickerEnabled, next.photoMaxBytes, next.videoMaxBytes);
      await this.repository.advancePolicy(tx, roomId);
      // Only scoped identifiers and a fixed action; never the free-form request body.
      await this.repository.audit(tx, randomUUID(), userId, roomId, 'MEDIA_POLICY_CHANGED');
    }
    return next;
  }

  // Internal admission check only: caller MUST separately authorize the current member,
  // content owner and target message. Commands use current locking reads even if a prior
  // consistent read established an older snapshot before a policy revocation committed.
  async requireRoomMedia(tx: Transaction, roomId: string, kind: 'PHOTO' | 'VIDEO' | 'STICKER', bytes: number): Promise<void> {
    if (!['PHOTO', 'VIDEO', 'STICKER'].includes(kind) || !Number.isSafeInteger(bytes) || bytes < 1) throw new ApiError('INVALID_MEDIA_INTENT', 400);
    const { policy } = await this.currentPolicy(tx, roomId);
    const enabled = kind === 'PHOTO' ? policy.photoEnabled : kind === 'VIDEO' ? policy.videoEnabled : policy.stickerEnabled;
    if (!enabled) throw new ApiError('MEDIA_FORBIDDEN', 403);
    const cap = kind === 'PHOTO' ? Math.min(policy.photoMaxBytes, MEDIA_LIMITS.photoBytes)
      : kind === 'VIDEO' ? Math.min(policy.videoMaxBytes, MEDIA_LIMITS.videoBytes) : MEDIA_LIMITS.stickerBytes;
    if (!Number.isSafeInteger(cap) || bytes > cap) throw new ApiError('INVALID_MEDIA_INTENT', 400);
  }

}
