import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { mediaKey } from '../media/adapters/media-store.js';
import { JobFailure } from '../jobs/jobs.service.js';

export interface PhotoSource {
  asset_id: string; object_id: string; object_key: string; byte_length: string;
  sha256: string; width: number; height: number; position: number;
}
export interface PhotoAttempt extends PhotoSource { destinationId: string; objectId: string; key: string }

@Injectable()
export class PublicationPhotoRepository {
  // Current locking reads are necessary: the publication candidate lookup may
  // have established an older RR snapshot before waiting for the room lock.
  sources(tx: Transaction, roomId: string, messageId: string) {
    return tx.rows<PhotoSource>(`SELECT a.id AS asset_id,o.id AS object_id,o.object_key,o.byte_length,o.sha256,o.width,o.height,x.position
      FROM message_attachments x JOIN media_assets a ON a.room_id=x.room_id AND a.id=x.asset_id
      JOIN media_objects o ON o.asset_id=a.id
      WHERE x.room_id=? AND x.message_id=? AND a.kind='PHOTO' AND a.state='READY' AND a.deleted_at IS NULL
      AND o.variant='image' AND o.state='READY' ORDER BY x.position FOR UPDATE`, [roomId, messageId]);
  }
  attachmentCount(tx: Transaction, roomId: string, messageId: string) {
    return tx.rows<{ n: string }>('SELECT COUNT(*) AS n FROM message_attachments WHERE room_id=? AND message_id=? FOR UPDATE', [roomId, messageId]);
  }
  copies(tx: Transaction, publicationId: string) {
    return tx.rows<{ destination_asset_id: string }>('SELECT destination_asset_id FROM publication_media WHERE publication_id=? ORDER BY position FOR UPDATE', [publicationId]);
  }
  async block(tx: Transaction, assetId: string) {
    await tx.rows('SELECT id FROM media_assets WHERE id=? FOR UPDATE', [assetId]);
    await tx.prisma.media_assets.updateMany({ where: { id: assetId, state: { not: 'DELETED' } }, data: { state: 'DELETING', deleted_at: await tx.now() } });
  }
  async allocate(tx: Transaction, roomId: string, publicationId: string, ownerId: string, sources: PhotoSource[], prefix: string): Promise<PhotoAttempt[]> {
    const bytes = sources.reduce((total, source) => total + BigInt(source.byte_length), 0n);
    await tx.prisma.media_budget.createMany({ data: [{ id: 'global' }], skipDuplicates: true });
    const [budget] = await tx.rows<{ reserved_bytes: string; limit_bytes: string }>("SELECT reserved_bytes,limit_bytes FROM media_budget WHERE id='global' FOR UPDATE", []);
    if (!budget || BigInt(budget.reserved_bytes) + bytes > BigInt(budget.limit_bytes)) throw new JobFailure('TEMPORARY_UNAVAILABLE');
    await tx.prisma.media_budget.update({ where: { id: 'global' }, data: { reserved_bytes: { increment: bytes } }, select: { id: true } });
    const attempts: PhotoAttempt[] = [];
    for (const source of sources) {
      const destinationId = randomUUID(), objectId = randomUUID(), attemptId = randomUUID();
      const key = mediaKey(prefix, destinationId, attemptId, 'image');
      await tx.prisma.media_assets.create({ data: { id: destinationId, owner_user_id: ownerId, room_id: roomId,
        kind: 'PHOTO', content_type: 'image/webp', state: 'PROCESSING', declared_bytes: BigInt(source.byte_length),
        reserved_bytes: BigInt(source.byte_length), expires_at: new Date((await tx.now()).getTime() + 3600000) }, select: { id: true } });
      await tx.prisma.media_objects.create({ data: { id: objectId, asset_id: destinationId, attempt_id: attemptId, variant: 'image', object_key: key }, select: { id: true } });
      await tx.prisma.publication_media.upsert({ where: { publication_id_position: { publication_id: publicationId, position: source.position } },
        create: { id: randomUUID(), room_id: roomId, publication_id: publicationId, position: source.position, source_asset_id: source.asset_id, source_object_id: source.object_id, destination_asset_id: destinationId },
        update: { source_asset_id: source.asset_id, source_object_id: source.object_id, destination_asset_id: destinationId }, select: { id: true } });
      attempts.push({ ...source, destinationId, objectId, key });
    }
    return attempts;
  }
  fence(tx: Transaction, id: string, generation: bigint, owner: string, token: string) {
    return tx.rows("SELECT id FROM jobs WHERE id=? AND purpose='PUBLICATION' AND state='RUNNING' AND generation=? AND lease_owner=? AND lease_token=? AND lease_until>UTC_TIMESTAMP(3) FOR UPDATE", [id, generation.toString(), owner, token]);
  }
  async ready(tx: Transaction, publicationId: string, attempt: PhotoAttempt) {
    const links = await tx.rows('SELECT id FROM publication_media WHERE publication_id=? AND position=? AND destination_asset_id=? AND source_asset_id=? AND source_object_id=? FOR UPDATE',
      [publicationId, attempt.position, attempt.destinationId, attempt.asset_id, attempt.object_id]);
    if (links.length !== 1) throw new JobFailure('SOURCE_UNAVAILABLE');
    const asset = await tx.prisma.media_assets.updateMany({ where: { id: attempt.destinationId, state: 'PROCESSING', deleted_at: null }, data: { state: 'READY' } });
    const object = await tx.prisma.media_objects.updateMany({ where: { id: attempt.objectId, asset_id: attempt.destinationId, object_key: attempt.key, state: 'ALLOCATED' },
      data: { state: 'READY', byte_length: BigInt(attempt.byte_length), sha256: attempt.sha256, width: attempt.width, height: attempt.height } });
    if (asset.count !== 1 || object.count !== 1) throw new JobFailure('SOURCE_UNAVAILABLE');
  }
  async attach(tx: Transaction, roomId: string, messageId: string, attempts: PhotoAttempt[]) {
    await tx.prisma.messages.update({ where: { id: messageId }, data: { content_kind: 'PHOTO' }, select: { id: true } });
    await tx.prisma.message_attachments.createMany({ data: attempts.map(attempt => ({ id: randomUUID(), room_id: roomId, message_id: messageId, asset_id: attempt.destinationId, position: attempt.position })) });
  }
  async abandoned(tx: Transaction) {
    // Polymorphic job references have no ORM relation. Acquire a bounded room
    // first (SKIP LOCKED), then publication locks; never take publication/asset
    // locks before the room. Runnable jobs are rechecked after asset locks.
    const eligible = `p.state='PREPARING'
      AND EXISTS (SELECT 1 FROM publication_media pm WHERE pm.publication_id=p.id)
      AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.purpose='PUBLICATION' AND j.resource_id=p.id
        AND (j.state='PENDING' OR (j.state='RUNNING' AND (j.lease_until>UTC_TIMESTAMP(3) OR j.attempts<j.max_attempts))))`;
    const [room] = await tx.rows<{ id: string }>(`SELECT r.id FROM rooms r
      WHERE EXISTS (SELECT 1 FROM message_publications p WHERE p.room_id=r.id AND ${eligible})
      ORDER BY r.id LIMIT 1 FOR UPDATE SKIP LOCKED`, []);
    if (!room) return [];
    return tx.rows<{ id: string; room_id: string }>(`SELECT p.id,p.room_id FROM message_publications p
      WHERE p.room_id=? AND ${eligible} ORDER BY p.created_at,p.id LIMIT 20 FOR UPDATE`, [room.id]);
  }
  runnable(tx: Transaction, publicationId: string) {
    return tx.rows("SELECT id FROM jobs WHERE purpose='PUBLICATION' AND resource_id=? AND (state='PENDING' OR (state='RUNNING' AND (lease_until>UTC_TIMESTAMP(3) OR attempts<max_attempts))) FOR UPDATE", [publicationId]);
  }
}
