import { affected } from '../../infrastructure/database/transactions.js';
import { chatAccountSql } from '../auth/chat-entitlement.js';
import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2';
import type { JobLease } from '../jobs/jobs.policy.js';
import type { Transaction } from '../../infrastructure/database/transactions.js';
export interface CleanupObject { id: string; object_key: string; state: string; byte_length: string | null; sha256: string | null; attempt_id?: string; writer_acknowledged?: boolean | number | string; cleanup_proof_id?: string | null; delete_observed_at?: Date | null }
// Successful PUT acknowledgements are recorded separately from domain finalization.
// ALLOCATED alone never proves termination, including after abort or lease expiry.
export function acknowledgedWrite(row: CleanupObject): boolean {
  return Number(row.writer_acknowledged) === 1 || ['STORED', 'READY', 'DELETED'].includes(row.state) && row.byte_length !== null &&
    /^[1-9][0-9]*$/.test(String(row.byte_length)) && typeof row.sha256 === 'string' && /^[a-f0-9]{64}$/.test(row.sha256);
}
const unprovenWrite = "((o.state NOT IN ('STORED','READY','DELETED') OR o.byte_length IS NULL OR o.byte_length=0 OR o.sha256 IS NULL OR NOT REGEXP_LIKE(o.sha256,'^[a-f0-9]{64}$','c')) AND NOT EXISTS (SELECT 1 FROM media_cleanup_attempts p WHERE p.object_id=o.id AND p.asset_id=o.asset_id AND p.attempt_id=o.attempt_id AND p.object_key=o.object_key AND p.writer_acknowledged=1))";
@Injectable()
export class MediaWorkerRepository {
  reference(tx: Transaction, assetId: string) {
    return tx.prisma.media_assets.findMany({ where: { id: assetId }, select: { owner_user_id: true } });
  }
  lockOwner(tx: Transaction, userId: unknown) {
    return tx.rows<RowDataPacket>(`SELECT u.status,s.status AS linked,${chatAccountSql('u', 's')} AS chat_allowed FROM users u LEFT JOIN platform_soop s ON s.user_id=u.id WHERE u.id=? FOR UPDATE`, [userId]);
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
  fence(tx: Transaction, lease: JobLease) {
    return tx.rows("SELECT id FROM jobs WHERE id=? AND purpose='MEDIA' AND room_id<=>? AND resource_id=? AND state='RUNNING' AND generation=? AND lease_owner=? AND lease_token=? AND lease_until>UTC_TIMESTAMP(3) FOR UPDATE", [lease.id, lease.roomId, lease.resourceId, lease.generation.toString(), lease.leaseOwner, lease.leaseToken]);
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
  objects(tx: Transaction, assetId: unknown) {
    return tx.rows<CleanupObject>("SELECT o.id,o.object_key,o.state,o.byte_length,o.sha256,p.writer_acknowledged,p.object_id AS cleanup_proof_id,p.delete_observed_at FROM media_objects o LEFT JOIN media_cleanup_attempts p ON p.object_id=o.id AND p.asset_id=o.asset_id AND p.attempt_id=o.attempt_id AND p.object_key=o.object_key WHERE o.asset_id=? ORDER BY o.id LIMIT 501 FOR UPDATE", [assetId]);
  }
  currentObjects(tx: Transaction, assetId: unknown) {
    return this.objects(tx, assetId);
  }
  async cleanupPage(tx: Transaction, assetId: string) {
    const checkpoint = await tx.prisma.media_cleanup_checkpoints.upsert({ where: { asset_id: assetId }, create: { asset_id: assetId }, update: {}, select: { object_cursor: true } });
    const page = await tx.rows<CleanupObject & { attempt_id: string }>(
      'SELECT o.id,o.attempt_id,o.object_key,o.state,o.byte_length,o.sha256,p.writer_acknowledged FROM media_objects o LEFT JOIN media_cleanup_attempts p ON p.object_id=o.id AND p.asset_id=o.asset_id AND p.attempt_id=o.attempt_id AND p.object_key=o.object_key WHERE o.asset_id=? AND o.id>? ORDER BY o.id LIMIT 100 FOR UPDATE', [assetId, checkpoint.object_cursor ?? '']);
    for (const row of page) {
      const prior = await tx.prisma.media_cleanup_attempts.findUnique({ where: { object_id: row.id }, select: { asset_id: true, attempt_id: true, object_key: true } });
      if (prior && (prior.asset_id !== assetId || prior.attempt_id !== row.attempt_id || prior.object_key !== row.object_key)) throw new Error('media_cleanup_provenance_conflict');
      await tx.prisma.media_cleanup_attempts.upsert({ where: { object_id: row.id }, create: {
        object_id: row.id, asset_id: assetId, attempt_id: row.attempt_id, object_key: row.object_key, writer_acknowledged: acknowledgedWrite(row),
      }, update: { writer_acknowledged: acknowledgedWrite(row) }, select: { object_id: true } });
    }
    return page;
  }
  async finishPage(tx: Transaction, assetId: string, page: CleanupObject[]) {
    for (const planned of page) {
      const [current] = await tx.rows<CleanupObject>('SELECT o.id,o.object_key,o.state,o.byte_length,o.sha256,p.writer_acknowledged,p.object_id AS cleanup_proof_id,p.delete_observed_at FROM media_objects o LEFT JOIN media_cleanup_attempts p ON p.object_id=o.id AND p.asset_id=o.asset_id AND p.attempt_id=o.attempt_id AND p.object_key=o.object_key WHERE o.asset_id=? AND o.id=? FOR UPDATE', [assetId, planned.id]);
      if (!current || current.object_key !== planned.object_key) throw new Error('media_cleanup_provenance_conflict');
      const acknowledged = acknowledgedWrite(current);
      await tx.prisma.media_cleanup_attempts.update({ where: { object_id: current.id }, data: { writer_acknowledged: acknowledged, delete_observed_at: acknowledged && acknowledgedWrite(planned) ? await tx.now() : null }, select: { object_id: true } });
      // Acknowledgment arriving DURING DELETE is not ordered before it: retain
      // that attempt for another pass, so a late PUT cannot resurrect a closed key.
      if (acknowledged && acknowledgedWrite(planned)) await tx.prisma.media_objects.updateMany({ where: { id: current.id, asset_id: assetId }, data: { state: 'DELETED' } });
    }
    await tx.prisma.media_cleanup_checkpoints.update({ where: { asset_id: assetId }, data: { object_cursor: page.at(-1)?.id ?? null }, select: { asset_id: true } });
    return !(await tx.rows(`SELECT o.id FROM media_objects o LEFT JOIN media_cleanup_attempts p ON p.object_id=o.id AND p.asset_id=o.asset_id AND p.attempt_id=o.attempt_id AND p.object_key=o.object_key
      WHERE o.asset_id=? AND (o.state<>'DELETED' OR p.object_id IS NULL OR p.writer_acknowledged=0 OR p.delete_observed_at IS NULL) LIMIT 1 FOR UPDATE`, [assetId])).length;
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
    (a.room_id IS NOT NULL AND EXISTS (SELECT 1 FROM rooms r WHERE r.id=a.room_id AND r.status='CLOSED')
      AND a.state<>'DELETED') OR
    (a.state='UPLOADING' AND a.upload_until<=UTC_TIMESTAMP(3)) OR a.state='DELETING' OR
    (a.state='DELETED' AND EXISTS (SELECT 1 FROM media_objects o WHERE o.asset_id=a.id AND (o.state<>'DELETED' OR ${unprovenWrite} OR EXISTS (SELECT 1 FROM media_cleanup_attempts p WHERE p.object_id=o.id AND p.delete_observed_at IS NULL)))))
    AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.purpose='MEDIA' AND j.resource_id=a.id AND
      (j.state='PENDING' OR (j.state='RUNNING' AND j.lease_until>UTC_TIMESTAMP(3))))

    ORDER BY a.created_at LIMIT 20 FOR UPDATE SKIP LOCKED`, []);
  }
  currentState(tx: Transaction, assetId: unknown) {
    return tx.rows<RowDataPacket>('SELECT state,room_id FROM media_assets WHERE id=? FOR UPDATE', [assetId]);
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
