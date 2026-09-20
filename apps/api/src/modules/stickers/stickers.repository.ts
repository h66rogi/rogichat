import { affected } from '../../infrastructure/database/transactions.js';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../infrastructure/database/transactions.js';

export interface StickerRow {
  id: string; asset_id: string; label: string; status: string; approved_at: Date | null;
}
export interface StickerAssetRow {
  id: string; owner_user_id: string; declared_bytes: string; unexpired: number;
  byte_length: string; width: number; height: number;
}

@Injectable()
export class StickersRepository {
  operator(tx: Transaction, userId: string) {
    return tx.rows("SELECT u.id FROM users u JOIN admin_capabilities c ON c.user_id=u.id WHERE u.id=? AND u.status='ACTIVE' AND c.manage_stickers=1 FOR UPDATE", [userId]);
  }
  approvalReference(tx: Transaction, id: string) {
    return tx.prisma.sticker_catalog.findUnique({ where: { id }, select: { asset_id: true, approved_at: true, asset: { select: { owner_user_id: true } } } });
  }
  lockRegistrar(tx: Transaction, userId: string) {
    // Initial approval serializes with registrar deletion before any asset lock.
    return tx.rows<{ status: string }>('SELECT status FROM users WHERE id=? FOR UPDATE', [userId]);
  }
  serviceAsset(tx: Transaction, assetId: string) {
    // Approved catalog assets are service-owned. Never acquire the registrar user
    // after the asset lock: media cleanup takes user -> asset, and deletion of
    // that registrar must not hide an approved sticker.
    if (!tx.writable) return this.readAsset(tx, assetId);
    return tx.rows<StickerAssetRow>(`SELECT a.id,a.owner_user_id,a.declared_bytes,(a.expires_at>UTC_TIMESTAMP(3)) AS unexpired,
      o.byte_length,o.width,o.height FROM media_assets a JOIN media_objects o ON o.asset_id=a.id
      WHERE a.id=? AND a.kind='STICKER' AND a.room_id IS NULL AND a.state='READY' AND a.deleted_at IS NULL
      AND o.variant='image' AND o.state='READY' FOR UPDATE`, [assetId]);
  }
  byAsset(tx: Transaction, assetId: string) {
    return tx.writable ? tx.rows<StickerRow>('SELECT id,asset_id,label,status,approved_at FROM sticker_catalog WHERE asset_id=? FOR UPDATE', [assetId]) : tx.prisma.sticker_catalog.findMany({ where: { asset_id: assetId }, select: { id: true, asset_id: true, label: true, status: true, approved_at: true } });
  }
  catalog(tx: Transaction, id: string) {
    return tx.writable ? tx.rows<StickerRow>('SELECT id,asset_id,label,status,approved_at FROM sticker_catalog WHERE id=? FOR UPDATE', [id]) : tx.prisma.sticker_catalog.findMany({ where: { id }, select: { id: true, asset_id: true, label: true, status: true, approved_at: true } });
  }
  reference(tx: Transaction, id: string) { return tx.prisma.sticker_catalog.findMany({ where: { id }, select: { asset_id: true } }); }
  lockAsset(tx: Transaction, assetId: string) {
    return tx.rows('SELECT id FROM media_assets WHERE id=? FOR UPDATE', [assetId]);
  }
  async register(tx: Transaction, id: string, assetId: string, label: string, userId: string) {
    await tx.prisma.sticker_catalog.create({ data: { id, asset_id: assetId, label, registered_by_user_id: userId }, select: { id: true } });
    await this.audit(tx, id, userId, 'REGISTERED');
  }
  async state(tx: Transaction, id: string, status: 'ACTIVE' | 'RETIRED' | 'REVOKED', userId: string) {
    if (status === 'ACTIVE') await tx.prisma.sticker_catalog.updateMany({ where: { id, approved_at: null }, data: { approved_by_user_id: userId, approved_at: await tx.now() } });
    await tx.prisma.sticker_catalog.updateMany({ where: { id }, data: { status } });
    await this.audit(tx, id, userId, status);
  }
  private audit(tx: Transaction, id: string, userId: string, action: string) {
    return tx.prisma.sticker_audit_events.create({ data: { id: randomUUID(), sticker_id: id, actor_user_id: userId, action }, select: { id: true } });
  }
  async blockAsset(tx: Transaction, assetId: string) {
    const where = { id: assetId, kind: 'STICKER', room_id: null, state: { not: 'DELETED' } };
    await tx.prisma.media_assets.updateMany({ where: { ...where, deleted_at: null }, data: { deleted_at: await tx.now() } });
    return affected(tx.prisma.media_assets.updateMany({ where, data: { state: 'DELETING' } }));
  }
  list(tx: Transaction, after: string) {
    return tx.prisma.sticker_catalog.findMany({ where: { id: { gt: after }, status: 'ACTIVE', approved_at: { not: null }, asset: { kind: 'STICKER', room_id: null, state: 'READY', deleted_at: null, objects: { some: { variant: 'image', state: 'READY' } } } }, orderBy: { id: 'asc' }, take: 51, select: { id: true, asset_id: true, label: true, status: true, approved_at: true } });
  }
  attach(tx: Transaction, roomId: string, messageId: string, stickerId: string) {
    return tx.prisma.message_stickers.create({ data: { room_id: roomId, message_id: messageId, sticker_id: stickerId }, select: { message_id: true } });
  }
  messageSticker(tx: Transaction, roomId: string, messageId: string) { return tx.prisma.message_stickers.findMany({ where: { room_id: roomId, message_id: messageId }, select: { sticker_id: true } }); }

  private async readAsset(tx: Transaction, assetId: string): Promise<StickerAssetRow[]> {
    const now = await tx.now();
    const assets = await tx.prisma.media_assets.findMany({ where: { id: assetId, kind: 'STICKER', room_id: null, state: 'READY', deleted_at: null }, select: { id: true, owner_user_id: true, declared_bytes: true, expires_at: true, objects: { where: { variant: 'image', state: 'READY' }, select: { byte_length: true, width: true, height: true } } } });
    return assets.flatMap(asset => asset.objects.map(object => ({ id: asset.id, owner_user_id: asset.owner_user_id, declared_bytes: String(asset.declared_bytes), unexpired: Number(asset.expires_at > now), byte_length: String(object.byte_length), width: Number(object.width), height: Number(object.height) })));
  }

}
