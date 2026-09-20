import { affected } from '../../infrastructure/database/transactions.js';
import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { chatUser, chatAccountSql } from '../auth/chat-entitlement.js';
interface Asset {
  id: string; owner_user_id: string; room_id: string | null; kind: string; content_type: string;
  declared_bytes: string; reserved_bytes: string; state: string; upload_token: string | null;
}

@Injectable()
export class MediaRepository {
  async owner(tx: Transaction, userId: string) {
    return tx.writable ? tx.rows(`SELECT u.id FROM users u LEFT JOIN platform_soop s ON s.user_id=u.id WHERE u.id=? AND u.status='ACTIVE' AND ${chatAccountSql('u', 's')} FOR UPDATE`, [userId]) : tx.prisma.users.findMany({ where: { id: userId, ...chatUser(await tx.now()) }, select: { id: true } });
  }
  ensureBudget(tx: Transaction) {
    return tx.prisma.media_budget.createMany({ data: [{ id: 'global' }], skipDuplicates: true });
  }
  lockBudget(tx: Transaction) {
    return tx.rows<RowDataPacket>("SELECT reserved_bytes,limit_bytes FROM media_budget WHERE id='global' FOR UPDATE", []);
  }
  capability(tx: Transaction, userId: string) {
    return tx.rows<RowDataPacket>('SELECT manage_stickers FROM admin_capabilities WHERE user_id=? FOR UPDATE', [userId]);
  }
  async pending(tx: Transaction, userId: string) {
    return [{ n: await tx.prisma.media_assets.count({ where: { owner_user_id: userId, state: { in: ['RESERVED', 'UPLOADING', 'PROCESSING'] } } }) }];
  }
  async ensureDaily(tx: Transaction, userId: string) {
    const day = await tx.now(); day.setUTCHours(0, 0, 0, 0);
    return tx.prisma.media_daily_usage.createMany({ data: [{ user_id: userId, day }], skipDuplicates: true });
  }
  lockDaily(tx: Transaction, userId: string) {
    return tx.rows<RowDataPacket>('SELECT input_bytes FROM media_daily_usage WHERE user_id=? AND day=UTC_DATE() FOR UPDATE', [userId]);
  }
  async reserve(tx: Transaction, id: string, userId: string, roomId: string | null, kind: string, contentType: string, bytes: number, reservation: number) {
    return tx.prisma.media_assets.create({ data: { id, owner_user_id: userId, room_id: roomId, kind, content_type: contentType, declared_bytes: BigInt(bytes), reserved_bytes: BigInt(reservation), expires_at: new Date((await tx.now()).getTime() + 3600000) }, select: { id: true } });
  }
  reserveBudget(tx: Transaction, reservation: number) {
    return affected(tx.prisma.media_budget.updateMany({ where: { id: 'global' }, data: { reserved_bytes: { increment: BigInt(reservation) } } }));
  }
  async chargeDaily(tx: Transaction, bytes: number, userId: string) {
    const day = await tx.now(); day.setUTCHours(0, 0, 0, 0);
    return affected(tx.prisma.media_daily_usage.updateMany({ where: { user_id: userId, day }, data: { input_bytes: { increment: BigInt(bytes) } } }));
  }
  status(tx: Transaction, assetId: string, userId: string) {
    return tx.prisma.media_assets.findMany({ where: { id: assetId, owner_user_id: userId, deleted_at: null }, select: { id: true, state: true, room_id: true } });
  }
  lockReserved(tx: Transaction, assetId: string, userId: string) {
    return tx.rows<Asset>("SELECT id,owner_user_id,room_id,kind,content_type,declared_bytes,reserved_bytes,state,upload_token FROM media_assets WHERE id=? AND owner_user_id=? AND deleted_at IS NULL AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE", [assetId, userId]);
  }
  async busy(tx: Transaction) { return [{ n: await tx.prisma.media_assets.count({ where: { state: 'UPLOADING' } }) }]; }
  async begin(tx: Transaction, token: string, assetId: string) {
    return affected(tx.prisma.media_assets.updateMany({ where: { id: assetId }, data: { state: 'UPLOADING', upload_token: token, upload_until: new Date((await tx.now()).getTime() + 900000) } }));
  }
  allocateInput(tx: Transaction, id: string, assetId: string, token: string, key: string) {
    return tx.prisma.media_objects.create({ data: { id, asset_id: assetId, attempt_id: token, variant: 'input', object_key: key }, select: { id: true } });
  }
  lockUploading(tx: Transaction, assetId: string, userId: string, token: string) {
    return tx.rows<Asset>("SELECT id,owner_user_id,room_id,kind,content_type,declared_bytes,reserved_bytes,state,upload_token FROM media_assets WHERE id=? AND owner_user_id=? AND state='UPLOADING' AND upload_token=? AND upload_until>UTC_TIMESTAMP(3) AND deleted_at IS NULL FOR UPDATE", [assetId, userId, token]);
  }
  async storeInput(tx: Transaction, bytes: number, sha256: string, objectId: string, assetId: string, token: string) {
    return affected(tx.prisma.media_objects.updateMany({ where: { id: objectId, asset_id: assetId, attempt_id: token, state: 'ALLOCATED' }, data: { state: 'STORED', byte_length: BigInt(bytes), sha256 } }));
  }
  async processing(tx: Transaction, assetId: string) {
    return affected(tx.prisma.media_assets.updateMany({ where: { id: assetId }, data: { state: 'PROCESSING' } }));
  }
  async fail(tx: Transaction, assetId: string, token: string) {
    return affected(tx.prisma.media_assets.updateMany({ where: { id: assetId, state: 'UPLOADING', upload_token: token }, data: { state: 'DELETING', deleted_at: await tx.now() } }));
  }
  ready(tx: Transaction, assetId: string) {
    return tx.prisma.media_assets.findMany({ where: { id: assetId, state: 'READY', deleted_at: null, owner: { status: { notIn: ['DELETING', 'DELETED'] } } }, select: { id: true, owner_user_id: true, room_id: true, kind: true, content_type: true, declared_bytes: true, reserved_bytes: true, state: true, upload_token: true, expires_at: true } });
  }
  messageLink(tx: Transaction, roomId: string, messageId: string, assetId: string) {
    return tx.prisma.message_attachments.findMany({ where: { room_id: roomId, message_id: messageId, asset_id: assetId }, select: { id: true } });
  }
  attachments(tx: Transaction, assetId: string) {
    return tx.prisma.message_attachments.findMany({ where: { asset_id: assetId }, select: { id: true } });
  }
  copies(tx: Transaction, assetId: string) {
    return tx.prisma.publication_media.findMany({ where: { destination_asset_id: assetId }, select: { id: true } });
  }
  catalogReference(tx: Transaction, assetId: string) {
    return tx.prisma.sticker_catalog.findUnique({ where: { asset_id: assetId }, select: { id: true } });
  }
  object(tx: Transaction, assetId: string, variant: string) {
    return tx.prisma.media_objects.findMany({ where: { asset_id: assetId, variant, state: 'READY' }, select: { object_key: true } });
  }

}
