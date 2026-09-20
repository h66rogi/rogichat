import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { RestoreMediaFailure } from './restore-media.types.js';

/** Bounded, consistent Prisma snapshot; no storage I/O or hidden transaction. */
@Injectable()
export class RestoreMediaRepository {
  async snapshot(tx: Transaction, limit: number) {
    const take = limit + 1;
    const [assets, objects, attempts, provenance, checkpoints] = await Promise.all([
      tx.prisma.media_assets.findMany({ take, orderBy: { id: 'asc' }, select: {
        id: true, owner_user_id: true, room_id: true, kind: true, state: true, deleted_at: true, expires_at: true,
        reserved_bytes: true, owner: { select: { status: true } },
        catalog_entry: { select: { id: true, status: true, approved_at: true } },
        // A blocked registrar must not make independent shared/service content
        // disappear. Bind these current retention references into the digest.
        attachments: { take: 1, orderBy: { id: 'asc' }, where: { message: { deleted_at: null, content_owner: { status: { in: ['ACTIVE', 'SUSPENDED'] } } } }, select: { id: true } },
        avatar_profile: { select: { user_id: true, user: { select: { status: true } } } },
        publication_sources: { take: 1, orderBy: { id: 'asc' }, where: { publication: { state: { in: ['PREPARING', 'PUBLISHED'] }, source: { deleted_at: null, content_owner: { status: { in: ['ACTIVE', 'SUSPENDED'] } } } } }, select: { id: true } },
        publication_copy: { select: { id: true, publication: { select: { state: true, source: { select: { deleted_at: true, content_owner: { select: { status: true } } } } } } } },
      } }),
      tx.prisma.media_objects.findMany({ take, orderBy: { id: 'asc' }, select: {
        id: true, asset_id: true, attempt_id: true, variant: true, object_key: true, state: true, byte_length: true, sha256: true,
      } }),
      tx.prisma.media_cleanup_attempts.findMany({ take, orderBy: { object_id: 'asc' } }),
      tx.prisma.account_media_provenance.findMany({ take, orderBy: [{ request_id: 'asc' }, { reference_kind: 'asc' }, { reference_id: 'asc' }, { asset_id: 'asc' }] }),
      tx.prisma.media_cleanup_checkpoints.findMany({ take, orderBy: { asset_id: 'asc' } }),
    ]);
    if ([assets, objects, attempts, provenance, checkpoints].some(rows => rows.length > limit)) throw new RestoreMediaFailure('LIMIT_EXCEEDED');
    return { assets, objects, attempts, provenance, checkpoints };
  }
}
