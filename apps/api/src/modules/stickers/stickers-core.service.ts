import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { ApiError, digest, object } from '../auth/auth-primitives.js';
import { identifier } from '../../common/validation/identifier.js';
import { AccessService } from '../access/access.service.js';
import { MEDIA_LIMITS } from '../../common/media/media-policy.js';
import { RoomMediaCoreService } from '../media/room-media-core.service.js';
import { JobsCoreService } from '../jobs/jobs-core.service.js';
import { StickersRepository } from './stickers.repository.js';
import type { StickerAssetRow, StickerRow } from './stickers.repository.js';

@Injectable()
export class StickersCoreService {
  constructor(@Inject(StickersRepository) private readonly repository: StickersRepository,
    @Inject(AccessService) private readonly access: AccessService, @Inject(JobsCoreService) private readonly jobs: JobsCoreService, @Inject(RoomMediaCoreService) private readonly roomMedia: RoomMediaCoreService) {}

  private async operator(tx: Transaction, userId: string) {
    if (!(await this.repository.operator(tx, userId)).length) throw new ApiError('FORBIDDEN', 403);
  }
  private async asset(tx: Transaction, assetId: string): Promise<StickerAssetRow> {
    const rows = await this.repository.asset(tx, assetId);
    const value = rows[0];
    if (rows.length !== 1 || !value || !Number.isSafeInteger(Number(value.byte_length)) || Number(value.byte_length) < 1 ||
      Number(value.byte_length) > MEDIA_LIMITS.stickerBytes || Number(value.declared_bytes) > MEDIA_LIMITS.stickerBytes ||
      !Number.isInteger(value.width) || value.width < 1 || value.width > 512 || !Number.isInteger(value.height) || value.height < 1 || value.height > 512) throw new ApiError('NOT_FOUND', 404);
    return value;
  }
  private dto(row: StickerRow) { return { id: row.id, label: row.label, assetId: row.asset_id, status: row.status }; }
  private async catalog(tx: Transaction, stickerId: string): Promise<StickerRow> {
    // Immutable reference lookup is not authorization. Lock asset before catalog, matching GC.
    const [reference] = await this.repository.reference(tx, identifier(stickerId));
    if (!reference) throw new ApiError('NOT_FOUND', 404);
    if (tx.writable) await this.repository.lockAsset(tx, reference.asset_id);
    const [catalog] = await this.repository.catalog(tx, stickerId);
    if (!catalog || catalog.asset_id !== reference.asset_id) throw new ApiError('NOT_FOUND', 404);
    return catalog;
  }

  // Caller owns fresh session/CSRF validation and this command's transaction.
  async register(tx: Transaction, userId: string, body: unknown) {
    const input = object(body, ['assetId', 'label']);
    const assetId = identifier(input.assetId);
    if (typeof input.label !== 'string') throw new ApiError('INVALID_REQUEST', 400);
    const label = input.label.normalize('NFC').trim();
    if (!label.length || [...label].length > 64 || [...label].some(character => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127)) throw new ApiError('INVALID_REQUEST', 400);
    await this.operator(tx, userId);
    const asset = await this.asset(tx, assetId);
    if (asset.owner_user_id !== userId) throw new ApiError('NOT_FOUND', 404);
    const [prior] = await this.repository.byAsset(tx, assetId);
    if (prior) {
      if (prior.label !== label) throw new ApiError('CONFLICT', 409);
      return this.dto(prior);
    }
    if (Number(asset.unexpired) !== 1) throw new ApiError('NOT_FOUND', 404);
    const id = randomUUID();
    await this.repository.register(tx, id, assetId, label, userId);
    return { id, label, assetId, status: 'DRAFT' };
  }

  async changeState(tx: Transaction, userId: string, stickerId: string, body: unknown) {
    const input = object(body, ['status']);
    if (input.status !== 'ACTIVE' && input.status !== 'RETIRED' && input.status !== 'REVOKED') throw new ApiError('INVALID_REQUEST', 400);
    await this.operator(tx, userId);
    const catalog = await this.catalog(tx, stickerId);
    if (catalog.status === input.status) return this.dto(catalog);
    if (catalog.status === 'REVOKED' || (catalog.status === 'DRAFT' && input.status === 'RETIRED')) throw new ApiError('CONFLICT', 409);
    if (input.status === 'ACTIVE') {
      const asset = await this.asset(tx, catalog.asset_id);
      if (catalog.approved_at === null && (Number(asset.unexpired) !== 1 || asset.owner_status !== 'ACTIVE')) throw new ApiError('NOT_FOUND', 404);
    }
    await this.repository.state(tx, catalog.id, input.status, userId);
    if (input.status === 'REVOKED') {
      await this.repository.blockAsset(tx, catalog.asset_id);
      await this.jobs.enqueue(tx, { purpose: 'MEDIA', resourceId: catalog.asset_id, dedupeKey: digest(`sticker-revoke:${catalog.id}`) });
    }
    return { ...this.dto(catalog), status: input.status };
  }

  async list(tx: Transaction, roomId: string, userId: string, after?: string) {
    await this.access.requireActiveMember(tx, identifier(roomId), userId);
    await this.roomMedia.requireRoomMedia(tx, roomId, 'STICKER', 1);
    const rows = await this.repository.list(tx, after === undefined ? '' : identifier(after));
    const page = rows.slice(0, 50);
    return { items: page.map(row => ({ id: row.id, label: row.label, assetId: row.asset_id })), nextCursor: rows.length > 50 ? page[49]!.id : null };
  }

  // Only new messages call this admission port. Committed command retries bypass new-send policy.
  async requireSend(tx: Transaction, roomId: string, stickerId: string) {
    const catalog = await this.catalog(tx, stickerId);
    if (catalog.status !== 'ACTIVE' || !catalog.approved_at) throw new ApiError('NOT_FOUND', 404);
    const asset = await this.asset(tx, catalog.asset_id);
    await this.roomMedia.requireRoomMedia(tx, identifier(roomId), 'STICKER', Number(asset.byte_length));
    return { stickerId: catalog.id, assetId: catalog.asset_id };
  }
  attach(tx: Transaction, roomId: string, messageId: string, stickerId: string) { return this.repository.attach(tx, roomId, messageId, stickerId); }

  // Trusted read port: caller MUST already authorize the containing message's current ACL.
  async messageContent(tx: Transaction, roomId: string, messageId: string) {
    const [link] = await this.repository.messageSticker(tx, roomId, messageId);
    if (!link) throw new ApiError('NOT_FOUND', 404);
    const catalog = await this.catalog(tx, link.sticker_id);
    if (!['ACTIVE', 'RETIRED'].includes(catalog.status) || !catalog.approved_at) throw new ApiError('NOT_FOUND', 404);
    const asset = await this.asset(tx, catalog.asset_id);
    return { stickerId: catalog.id, assetId: catalog.asset_id, width: asset.width, height: asset.height };
  }
}
