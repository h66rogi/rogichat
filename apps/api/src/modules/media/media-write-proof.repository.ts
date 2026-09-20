import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';

@Injectable()
export class MediaWriteProofRepository {
  async acknowledge(tx: Transaction, assetId: string, objectId: string, key: string) {
    // Evidence-only transaction after an actual successful PUT. Never grants
    // READY, membership or a lease; revoked owners may still acknowledge writes.
    const [asset] = await tx.rows<{ state: string }>('SELECT state FROM media_assets WHERE id=? FOR UPDATE', [assetId]);
    if (!asset) throw new Error('media_write_proof_conflict');
    const [object] = await tx.rows<{ attempt_id: string; object_key: string }>('SELECT attempt_id,object_key FROM media_objects WHERE asset_id=? AND id=? FOR UPDATE', [assetId, objectId]);
    if (!object || object.object_key !== key) throw new Error('media_write_proof_conflict');
    const prior = await tx.prisma.media_cleanup_attempts.findUnique({ where: { object_id: objectId }, select: { asset_id: true, attempt_id: true, object_key: true } });
    if (prior && (prior.asset_id !== assetId || prior.attempt_id !== object.attempt_id || prior.object_key !== key)) throw new Error('media_write_proof_conflict');
    // A real late PUT can resurrect bytes behind a legacy DELETED asset.
    // Reopen the existing cleanup obligation; never reconstruct lost quota.
    if (asset.state === 'DELETED') {
      await tx.prisma.media_assets.updateMany({ where: { id: assetId, state: 'DELETED' }, data: { state: 'DELETING' } });
      await tx.prisma.media_cleanup_checkpoints.upsert({ where: { asset_id: assetId }, create: { asset_id: assetId }, update: {}, select: { asset_id: true } });
    }
    await tx.prisma.media_cleanup_attempts.upsert({ where: { object_id: objectId }, create: {
      object_id: objectId, asset_id: assetId, attempt_id: object.attempt_id, object_key: key, writer_acknowledged: true,
    }, update: { writer_acknowledged: true, delete_observed_at: null }, select: { object_id: true } });
  }
}
