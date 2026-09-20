import { affected } from '../../infrastructure/database/transactions.js';
import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from '../../infrastructure/database/transactions.js';
@Injectable()
export class MediaWorkerRepository {
  reference(tx: Transaction, assetId: string) {
    return tx.prisma.media_assets.findMany({ where: { id: assetId }, select: { owner_user_id: true } });
  }
  lockOwner(tx: Transaction, userId: unknown) {
    return tx.rows<RowDataPacket>("SELECT u.status,s.status AS linked FROM users u LEFT JOIN platform_soop s ON s.user_id=u.id WHERE u.id=? FOR UPDATE", [userId]);
  }
  lockAsset(tx: Transaction, assetId: string) {
    return tx.rows<RowDataPacket>('SELECT id,owner_user_id,room_id,kind,content_type,declared_bytes,reserved_bytes,state,deleted_at FROM media_assets WHERE id=? FOR UPDATE', [assetId]);
  }
  async block(tx: Transaction, assetId: unknown) {
    await tx.prisma.media_assets.updateMany({ where: { id: String(assetId), deleted_at: null }, data: { deleted_at: await tx.now() } });
    return affected(tx.prisma.media_assets.updateMany({ where: { id: String(assetId) }, data: { state: 'DELETING' } }));
  }
  originals(tx: Transaction, assetId: unknown) {
    return tx.rows<RowDataPacket>("SELECT object_key FROM media_objects WHERE asset_id=? AND variant='input' AND state='STORED' FOR UPDATE", [assetId]);
  }
  attempts(tx: Transaction, assetId: unknown) {
    return tx.rows("SELECT id FROM media_objects WHERE asset_id=? AND variant IN ('image','video','poster') FOR UPDATE", [assetId]);
  }
  reserveRetry(tx: Transaction, bytes: number, capBytes: number) {
    return tx.execute("UPDATE media_budget SET reserved_bytes=reserved_bytes+? WHERE id='global' AND reserved_bytes+?<=limit_bytes", [bytes, capBytes]);
  }
  reserveAssetRetry(tx: Transaction, bytes: number, assetId: unknown) {
    return affected(tx.prisma.media_assets.updateMany({ where: { id: String(assetId) }, data: { reserved_bytes: { increment: BigInt(bytes) } } }));
  }
  allocate(tx: Transaction, objectId: string, assetId: unknown, attempt: string, key: string, variant: 'image' | 'video' | 'poster' = 'image') {
    return tx.prisma.media_objects.create({ data: { id: objectId, asset_id: String(assetId), attempt_id: attempt, variant, object_key: key }, select: { id: true } });
  }
  fence(tx: Transaction, jobId: string, generation: string, owner: string, token: string) {
    return tx.rows("SELECT id FROM jobs WHERE id=? AND purpose='MEDIA' AND state='RUNNING' AND generation=? AND lease_owner=? AND lease_token=? AND lease_until>UTC_TIMESTAMP(3) FOR UPDATE", [jobId, generation, owner, token]);
  }
  // DB-clock renewal must atomically reject an expired/reclaimed lease. Job-only
  // transaction: never acquire domain locks after this update.
  renew(tx: Transaction, jobId: string, generation: string, owner: string, token: string) {
    return tx.execute("UPDATE jobs SET lease_until=TIMESTAMPADD(SECOND,300,UTC_TIMESTAMP(3)) WHERE id=? AND purpose='MEDIA' AND state='RUNNING' AND generation=? AND lease_owner=? AND lease_token=? AND lease_until>UTC_TIMESTAMP(3)", [jobId, generation, owner, token]);
  }
  readyObject(tx: Transaction, bytes: number, sha256: string, width: number, height: number, objectId: string, assetId: unknown, durationMs: number | null = null) {
    return affected(tx.prisma.media_objects.updateMany({ where: { id: objectId, asset_id: String(assetId), state: 'ALLOCATED' }, data: { state: 'READY', byte_length: BigInt(bytes), sha256, width, height, duration_ms: durationMs } }));
  }
  readyAsset(tx: Transaction, assetId: unknown) {
    return affected(tx.prisma.media_assets.updateMany({ where: { id: String(assetId) }, data: { state: 'READY' } }));
  }
  uploading(tx: Transaction, assetId: unknown) {
    return tx.rows("SELECT id FROM media_assets WHERE id=? AND upload_until>TIMESTAMPADD(MINUTE,-5,UTC_TIMESTAMP(3)) FOR UPDATE", [assetId]);
  }
  recentAttempts(tx: Transaction, assetId: unknown) {
    return tx.rows("SELECT id FROM media_objects WHERE asset_id=? AND created_at>TIMESTAMPADD(MINUTE,-10,UTC_TIMESTAMP(3)) LIMIT 1 FOR UPDATE", [assetId]);
  }
  objects(tx: Transaction, assetId: unknown) {
    return tx.rows<RowDataPacket>("SELECT id,object_key FROM media_objects WHERE asset_id=? AND state<>'DELETED' FOR UPDATE", [assetId]);
  }
  currentObjects(tx: Transaction, assetId: unknown) {
    return tx.rows<RowDataPacket>("SELECT id FROM media_objects WHERE asset_id=? AND state<>'DELETED' FOR UPDATE", [assetId]);
  }
  deleteObjects(tx: Transaction, assetId: unknown) {
    return affected(tx.prisma.media_objects.updateMany({ where: { asset_id: String(assetId) }, data: { state: 'DELETED' } }));
  }
  releaseBudget(tx: Transaction, bytes: unknown, minimum: unknown) {
    return affected(tx.prisma.media_budget.updateMany({ where: { id: 'global', reserved_bytes: { gte: BigInt(String(minimum)) } }, data: { reserved_bytes: { decrement: BigInt(String(bytes)) } } }));
  }
  deleteAsset(tx: Transaction, assetId: unknown) {
    return affected(tx.prisma.media_assets.updateMany({ where: { id: String(assetId) }, data: { state: 'DELETED', reserved_bytes: 0n, upload_token: null, upload_until: null } }));
  }
  recoverable(tx: Transaction) {
    return tx.rows<RowDataPacket>(`SELECT a.id FROM media_assets a WHERE (
    (a.state IN ('RESERVED','PROCESSING','READY') AND a.expires_at<=UTC_TIMESTAMP(3)
      AND NOT EXISTS (SELECT 1 FROM message_attachments x WHERE x.asset_id=a.id)
      AND NOT EXISTS (SELECT 1 FROM user_profiles p WHERE p.avatar_asset_id=a.id)
      AND NOT EXISTS (SELECT 1 FROM sticker_catalog c WHERE c.asset_id=a.id AND c.status IN ('ACTIVE','RETIRED') AND c.approved_at IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM publication_media pm JOIN message_publications p ON p.room_id=pm.room_id AND p.id=pm.publication_id WHERE pm.destination_asset_id=a.id AND p.state='PREPARING')) OR
    (a.state='UPLOADING' AND a.upload_until<=UTC_TIMESTAMP(3)) OR a.state='DELETING')
    AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.purpose='MEDIA' AND j.resource_id=a.id AND
      (j.state='PENDING' OR (j.state='RUNNING' AND j.lease_until>UTC_TIMESTAMP(3)) OR
       j.dedupe_key=UNHEX(SHA2(CONCAT('media-recovery:',a.id,':',DATE_FORMAT(UTC_TIMESTAMP(3),'%Y%m%d%H')),256))))
    ORDER BY a.created_at LIMIT 20 FOR UPDATE SKIP LOCKED`, []);
  }
  epoch(tx: Transaction) {
    return tx.rows<RowDataPacket>("SELECT DATE_FORMAT(UTC_TIMESTAMP(3),'%Y%m%d%H') AS epoch", []);
  }
  currentState(tx: Transaction, assetId: unknown) {
    return tx.rows<RowDataPacket>('SELECT state FROM media_assets WHERE id=? FOR UPDATE', [assetId]);
  }
  attachments(tx: Transaction, assetId: unknown) {
    return tx.rows('SELECT id FROM message_attachments WHERE asset_id=? LIMIT 1 FOR UPDATE', [assetId]);
  }
  avatars(tx: Transaction, assetId: unknown) {
    return tx.rows('SELECT user_id FROM user_profiles WHERE avatar_asset_id=? LIMIT 1 FOR UPDATE', [assetId]);
  }
  catalog(tx: Transaction, assetId: unknown) {
    return tx.rows("SELECT id FROM sticker_catalog WHERE asset_id=? AND status IN ('ACTIVE','RETIRED') AND approved_at IS NOT NULL LIMIT 1 FOR UPDATE", [assetId]);
  }
  copies(tx: Transaction, assetId: unknown) {
    return tx.rows("SELECT pm.id FROM publication_media pm JOIN message_publications p ON p.room_id=pm.room_id AND p.id=pm.publication_id WHERE pm.destination_asset_id=? AND p.state='PREPARING' LIMIT 1 FOR UPDATE", [assetId]);
  }
  async blockRecovery(tx: Transaction, assetId: unknown) {
    await tx.prisma.media_assets.updateMany({ where: { id: String(assetId), deleted_at: null }, data: { deleted_at: await tx.now() } });
    return affected(tx.prisma.media_assets.updateMany({ where: { id: String(assetId) }, data: { state: 'DELETING' } }));
  }

}
