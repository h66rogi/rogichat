import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { DeletionReceipt } from '../deletion/deletion-ledger.js';

export interface MediaBasis { kind: 'ATTACHMENT' | 'PUBLICATION' | 'AVATAR' | 'ACCOUNT'; id: string; assetId: string; roomId: string | null }
@Injectable()
export class AccountMediaRepository {
  async admit(tx: Transaction, receipt: DeletionReceipt, basis: MediaBasis) {
    const userId = receipt.intent.targetId;
    // Account and (if applicable) one room already locked. Asset is the next
    // serialization point; no second account or room lock may follow it.
    const [asset] = await tx.rows<{ owner_user_id: string; room_id: string | null }>('SELECT owner_user_id,room_id FROM media_assets WHERE id=? FOR UPDATE', [basis.assetId]);
    if (!asset || asset.room_id !== basis.roomId || (['ACCOUNT', 'AVATAR'].includes(basis.kind) && asset.owner_user_id !== userId)) throw new Error('account_media_scope');
    // Current locking existence probes are necessary after asset-lock waits:
    // an older RR snapshot cannot authorize revoking another account's reference.
    const shared = Boolean((await tx.rows("SELECT id FROM sticker_catalog WHERE asset_id=? AND approved_at IS NOT NULL LIMIT 1 FOR SHARE", [basis.assetId])).length ||
      (await tx.rows('SELECT a.id FROM message_attachments a JOIN messages m ON m.room_id=a.room_id AND m.id=a.message_id WHERE a.asset_id=? AND m.content_owner_user_id<>? LIMIT 1 FOR SHARE', [basis.assetId, userId])).length ||
      (await tx.rows('SELECT user_id FROM user_profiles WHERE avatar_asset_id=? AND user_id<>? LIMIT 1 FOR SHARE', [basis.assetId, userId])).length ||
      (await tx.rows('SELECT pm.id FROM publication_media pm JOIN message_publications p ON p.room_id=pm.room_id AND p.id=pm.publication_id JOIN messages m ON m.room_id=p.room_id AND m.id=p.source_message_id WHERE (pm.source_asset_id=? OR pm.destination_asset_id=?) AND m.content_owner_user_id<>? LIMIT 1 FOR SHARE', [basis.assetId, basis.assetId, userId])).length);
    const disposition = shared ? 'PRESERVED' : 'REVOKED';
    const identity = { request_id: receipt.intent.requestId, reference_kind: basis.kind, reference_id: basis.id, asset_id: basis.assetId };
    const prior = await tx.prisma.account_media_provenance.findUnique({ where: { request_id_reference_kind_reference_id_asset_id: identity }, select: {
      content_owner_user_id: true, asset_owner_user_id: true, room_id: true, requested_at: true, ledger_sha256: true,
    } });
    if (prior && (prior.content_owner_user_id !== userId || prior.asset_owner_user_id !== asset.owner_user_id || prior.room_id !== basis.roomId ||
      prior.requested_at.toISOString() !== receipt.intent.requestedAt || Buffer.from(prior.ledger_sha256).toString('hex') !== receipt.sha256)) throw new Error('account_media_provenance_conflict');
    await tx.prisma.account_media_provenance.upsert({ where: { request_id_reference_kind_reference_id_asset_id: identity }, create: {
      ...identity, content_owner_user_id: userId, asset_owner_user_id: asset.owner_user_id, room_id: basis.roomId,
      requested_at: new Date(receipt.intent.requestedAt), ledger_sha256: Buffer.from(receipt.sha256, 'hex'), disposition,
    }, update: { disposition }, select: { asset_id: true } });
    if (!shared) {
      await tx.prisma.media_assets.updateMany({ where: { id: basis.assetId, deleted_at: null }, data: { deleted_at: await tx.now() } });
      await tx.prisma.media_assets.updateMany({ where: { id: basis.assetId, state: { not: 'DELETED' } }, data: { state: 'DELETING', upload_token: null, upload_until: null } });
      await tx.prisma.media_cleanup_checkpoints.upsert({ where: { asset_id: basis.assetId }, create: { asset_id: basis.assetId }, update: {}, select: { asset_id: true } });
    }
    return disposition;
  }

  async page(tx: Transaction, receipt: DeletionReceipt) {
    const requestId = receipt.intent.requestId, userId = receipt.intent.targetId;
    const profile = await tx.prisma.user_profiles.findUnique({ where: { user_id: userId }, select: { avatar_asset_id: true } });
    if (profile?.avatar_asset_id) {
      await this.admit(tx, receipt, { kind: 'AVATAR', id: userId, assetId: profile.avatar_asset_id, roomId: null });
      await tx.prisma.user_profiles.updateMany({ where: { user_id: userId, avatar_asset_id: profile.avatar_asset_id }, data: { avatar_asset_id: null, revision: { increment: 1n } } });
      return true;
    }
    const scan = await tx.prisma.account_media_scans.upsert({ where: { request_id: requestId }, create: { request_id: requestId }, update: {}, select: { asset_cursor: true } });
    const asset = await tx.prisma.media_assets.findFirst({ where: { owner_user_id: userId, ...(scan.asset_cursor ? { id: { gt: scan.asset_cursor } } : {}) },
      orderBy: { id: 'asc' }, select: { id: true, room_id: true } });
    if (asset?.room_id) await tx.rows('SELECT id FROM rooms WHERE id=? FOR UPDATE', [asset.room_id]);
    if (asset) await this.admit(tx, receipt, { kind: 'ACCOUNT', id: userId, assetId: asset.id, roomId: asset.room_id });
    await tx.prisma.account_media_scans.update({ where: { request_id: requestId }, data: { asset_cursor: asset?.id ?? null }, select: { request_id: true } });
    return Boolean(asset);
  }
}
