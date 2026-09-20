import { Inject, Injectable } from '@nestjs/common';
import { MediaRepository } from './media.repository.js';
import { AccessService } from '../access/access.service.js';
import { MessagesCoreService } from '../messages/messages-core.service.js';
import { JobsCoreService } from '../jobs/jobs-core.service.js';
import { RoomMediaCoreService } from './room-media-core.service.js';
import { UsersCoreService } from '../users/users-core.service.js';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { ApiError, digest } from '../../modules/auth/auth-primitives.js';
import { identifier } from '../../common/validation/identifier.js';
import { mediaKey } from './adapters/media-store.js';
import { parseMediaIntent } from '../../common/media/media-policy.js';
import type { MediaIntent } from '../../common/media/media-policy.js';

const MiB = 1024 * 1024;
export interface UploadAttempt { assetId: string; token: string; objectId: string; key: string; input: MediaIntent }

@Injectable()
export class MediaCoreService {
  constructor(@Inject(MediaRepository) private readonly repository: MediaRepository, @Inject(AccessService) private readonly access: AccessService, @Inject(MessagesCoreService) private readonly messages: MessagesCoreService, @Inject(JobsCoreService) private readonly jobs: JobsCoreService, @Inject(RoomMediaCoreService) private readonly roomMedia: RoomMediaCoreService, @Inject(UsersCoreService) private readonly users: UsersCoreService) {}
  private async owner(tx: Transaction, userId: string): Promise<void> {
    const rows = await this.repository.owner(tx, userId);
    if (!rows.length) throw new ApiError('NOT_FOUND', 404);
  }
  private async budget(tx: Transaction) {
    await this.repository.ensureBudget(tx);
    const [row] = await this.repository.lockBudget(tx);
    return row!;
  }
  async reserveMedia(tx: Transaction, userId: string, roomId: string | null, input: unknown) {
    await this.owner(tx, userId);
    const [capability] = await this.repository.capability(tx, userId);
    const parsed = parseMediaIntent(input, { canRegisterStickers: Number(capability?.manage_stickers) === 1 });
    if (['PHOTO', 'VIDEO'].includes(parsed.kind)) {
      if (!roomId) throw new ApiError('INVALID_REQUEST', 400);
      await this.access.requireActiveMember(tx, identifier(roomId), userId);
      await this.roomMedia.requireRoomMedia(tx, roomId, parsed.kind as 'PHOTO' | 'VIDEO', parsed.byteLength);
    } else if (roomId !== null) throw new ApiError('INVALID_REQUEST', 400);
    const total = await this.budget(tx);
    const [pending] = await this.repository.pending(tx, userId);
    if (Number(pending!.n) >= 2) throw new ApiError('RATE_LIMITED', 429);
    // Reserve the worst-case known output as well as the input. Failed/uncertain objects keep it.
    const outputCap = parsed.kind === 'VIDEO' ? 52 * MiB : parsed.kind === 'AVATAR' ? 2 * MiB : parsed.kind === 'STICKER' ? MiB : 10 * MiB;
    const reservation = parsed.byteLength + outputCap;
    if (BigInt(total.reserved_bytes) + BigInt(reservation) > BigInt(total.limit_bytes)) throw new ApiError('MEDIA_CAPACITY', 503);
    await this.repository.ensureDaily(tx, userId);
    const [daily] = await this.repository.lockDaily(tx, userId);
    if (BigInt(daily!.input_bytes) + BigInt(parsed.byteLength) > BigInt(200 * MiB)) throw new ApiError('RATE_LIMITED', 429);
    const id = randomUUID();
    await this.repository.reserve(tx, id, userId, roomId, parsed.kind, parsed.contentType, parsed.byteLength, reservation);
    await this.repository.reserveBudget(tx, reservation);
    await this.repository.chargeDaily(tx, parsed.byteLength, userId);
    return { assetId: id, status: 'reserved' };
  }
  async mediaStatus(tx: Transaction, userId: string, assetId: string) {
    await this.owner(tx, userId);
    const [row] = await this.repository.status(tx, identifier(assetId), userId);
    if (!row) throw new ApiError('NOT_FOUND', 404);
    if (row.room_id) await this.access.requireActiveMember(tx, row.room_id, userId);
    return { assetId: row.id, status: row.state.toLowerCase() };
  }
  async beginUpload(tx: Transaction, userId: string, assetId: string, prefix: string): Promise<UploadAttempt> {
    await this.owner(tx, userId);
    // Serialize the global two-upload admission across API replicas, not only in local RAM.
    await this.budget(tx);
    const [asset] = await this.repository.lockReserved(tx, identifier(assetId), userId);
    if (!asset) throw new ApiError('NOT_FOUND', 404);
    if (asset.room_id) {
      await this.access.requireActiveMember(tx, asset.room_id, userId);
      await this.roomMedia.requireRoomMedia(tx, asset.room_id, asset.kind as 'PHOTO' | 'VIDEO' | 'STICKER', Number(asset.declared_bytes));
    }
    if (asset.state !== 'RESERVED') throw new ApiError('MEDIA_STATE', 409);
    const [busy] = await this.repository.busy(tx);
    if (Number(busy!.n) >= 2) throw new ApiError('RATE_LIMITED', 429);
    const token = randomUUID(), objectId = randomUUID();
    const key = mediaKey(prefix, asset.id, token, 'input');
    await this.repository.begin(tx, token, asset.id);
    // Persist the immutable key BEFORE any external PUT, including unknown-outcome PUTs.
    await this.repository.allocateInput(tx, objectId, asset.id, token, key);
    return { assetId: asset.id, token, objectId, key, input: { kind: asset.kind, contentType: asset.content_type, byteLength: Number(asset.declared_bytes) } as MediaIntent };
  }
  async finishUpload(tx: Transaction, userId: string, attempt: UploadAttempt, bytes: number, sha256: string) {
    await this.owner(tx, userId);
    const [asset] = await this.repository.lockUploading(tx, attempt.assetId, userId, attempt.token);
    if (!asset) throw new ApiError('MEDIA_STATE', 409);
    if (asset.room_id) {
      await this.access.requireActiveMember(tx, asset.room_id, userId);
      await this.roomMedia.requireRoomMedia(tx, asset.room_id, asset.kind as 'PHOTO' | 'VIDEO' | 'STICKER', Number(asset.declared_bytes));
    }
    if (!Number.isSafeInteger(bytes) || bytes !== Number(asset.declared_bytes) || !/^[a-f0-9]{64}$/.test(sha256)) throw new ApiError('INVALID_REQUEST', 400);
    const updated = await this.repository.storeInput(tx, bytes, sha256, attempt.objectId, asset.id, attempt.token);
    if (updated.affectedRows !== 1) throw new ApiError('MEDIA_STATE', 409);
    await this.repository.processing(tx, asset.id);
    await this.jobs.enqueue(tx, { purpose: 'MEDIA', ...(asset.room_id ? { roomId: asset.room_id } : {}), resourceId: asset.id, dedupeKey: digest(`media:${asset.id}:${attempt.token}`) });
    return { assetId: asset.id, status: 'processing' };
  }
  async failUpload(tx: Transaction, attempt: UploadAttempt): Promise<void> {
    const result = await this.repository.fail(tx, attempt.assetId, attempt.token);
    if (result.affectedRows) await this.jobs.enqueue(tx, { purpose: 'MEDIA', resourceId: attempt.assetId, dedupeKey: digest(`media-cleanup:${attempt.assetId}:${attempt.token}`) });
    // Never release a byte reservation before storage cleanup succeeds after the upload horizon.
  }

  // Called in a fresh authenticated transaction immediately before local 60-second URL signing.
  async authorizedMediaObject(tx: Transaction, userId: string, assetId: string, context: { roomId?: string; messageId?: string; actorId?: string; variant: string }) {
    await this.owner(tx, userId);
    if (!['image', 'video', 'poster'].includes(context.variant)) throw new ApiError('NOT_FOUND', 404);
    const [asset] = await this.repository.ready(tx, identifier(assetId));
    if (!asset) throw new ApiError('NOT_FOUND', 404);
    if (context.actorId !== undefined) {
      if (!context.roomId || context.messageId !== undefined || context.variant !== 'image' || asset.kind !== 'AVATAR' || asset.room_id !== null) throw new ApiError('NOT_FOUND', 404);
      await this.users.requireActorAvatar(tx, context.roomId, userId, context.actorId, assetId);
    } else if (context.roomId && context.messageId) {
      const viewer = await this.access.requireActiveMember(tx, identifier(context.roomId), userId);
      const message = await this.messages.load(tx, context.roomId, identifier(context.messageId));
      if (!message || !await this.messages.readable(tx, viewer, message)) throw new ApiError('NOT_FOUND', 404);
      const linked = await this.repository.messageLink(tx, context.roomId, context.messageId, assetId);
      if (!linked.length || asset.room_id !== context.roomId) throw new ApiError('NOT_FOUND', 404);
    } else {
      // Only the uploader can preview an unattached asset. Attached assets always use message ACL.
      const linked = await this.repository.attachments(tx, assetId);
      const copies = await this.repository.copies(tx, assetId);
      if (context.roomId || context.messageId || asset.owner_user_id !== userId || linked.length || copies.length) throw new ApiError('NOT_FOUND', 404);
      if (asset.room_id) await this.access.requireActiveMember(tx, asset.room_id, userId);
    }
    const rows = await this.repository.object(tx, assetId, context.variant);
    if (rows.length !== 1) throw new ApiError('NOT_FOUND', 404);
    return String(rows[0]!.object_key);
  }

}
