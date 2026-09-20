import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';

@Injectable()
export class MediaWriteProofRepository {
  async acknowledge(tx: Transaction, assetId: string, objectId: string, key: string) {
    // Evidence-only transaction after an actual successful PUT. Never grants
    // READY, membership or a lease; revoked owners may still acknowledge writes.
    await tx.rows('SELECT id FROM media_assets WHERE id=? FOR UPDATE', [assetId]);
    const [object] = await tx.rows<{ attempt_id: string; object_key: string }>('SELECT attempt_id,object_key FROM media_objects WHERE asset_id=? AND id=? FOR UPDATE', [assetId, objectId]);
    if (!object || object.object_key !== key) throw new Error('media_write_proof_conflict');
    const prior = await tx.prisma.media_cleanup_attempts.findUnique({ where: { object_id: objectId }, select: { asset_id: true, attempt_id: true, object_key: true } });
    if (prior && (prior.asset_id !== assetId || prior.attempt_id !== object.attempt_id || prior.object_key !== key)) throw new Error('media_write_proof_conflict');
    await tx.prisma.media_cleanup_attempts.upsert({ where: { object_id: objectId }, create: {
      object_id: objectId, asset_id: assetId, attempt_id: object.attempt_id, object_key: key, writer_acknowledged: true,
    }, update: { writer_acknowledged: true, delete_observed_at: null }, select: { object_id: true } });
  }
}
