import { Inject, Injectable } from '@nestjs/common';
import { AccessService } from '../access/access.service.js';
import { MessagesCoreService } from '../messages/messages-core.service.js';
import { PublicationPhotoRepository } from './publication-photo.repository.js';
import type { PhotoAttempt } from './publication-photo.repository.js';
import { PublicationsRepository } from './publications.repository.js';
import { randomUUID } from 'node:crypto';
import type { Transaction, Transactions } from '../../infrastructure/database/transactions.js';
import { ApiError, digest } from '../../modules/auth/auth-primitives.js';
import { identifier } from '../../common/validation/identifier.js';
import { canPublishSource } from '../../modules/access/access.policy.js';
import { RoomStateService } from '../rooms/room-state.service.js';
import { JobsCoreService } from '../jobs/jobs-core.service.js';
import { JobFailure } from '../jobs/jobs.service.js';
import type { JobLease } from '../../modules/jobs/jobs.policy.js';

class StaleLease extends Error {}
const receipt = (row: { id: unknown; state: unknown; published_message_id?: unknown }) => ({ publicationId: String(row.id), status: String(row.state).toLowerCase(), ...(row.state === 'PUBLISHED' ? { messageId: String(row.published_message_id) } : {}) });

@Injectable()
export class PublicationsCoreService {
  constructor(@Inject(PublicationsRepository) private readonly repository: PublicationsRepository, @Inject(AccessService) private readonly access: AccessService, @Inject(MessagesCoreService) private readonly messages: MessagesCoreService, @Inject(JobsCoreService) private readonly jobs: JobsCoreService, @Inject(RoomStateService) private readonly roomState: RoomStateService, @Inject(PublicationPhotoRepository) private readonly photos: PublicationPhotoRepository) {}
  private async sourceForOwner(tx: Transaction, roomId: string, userId: string, messageId: string) {
    const [room] = await this.repository.lockRoom(tx, identifier(roomId));
    if (!room || room.status !== 'ACTIVE') throw new ApiError('NOT_FOUND', 404);
    const viewer = await this.access.requireActiveMember(tx, roomId, userId);
    const source = await this.messages.load(tx, roomId, identifier(messageId));
    if (!source || !canPublishSource({ accountActive: true, soopLinked: true, roomId, memberRoomId: roomId, roomActive: true,
      memberId: viewer.id, memberActive: true, periodActive: true, visibleFrom: BigInt(viewer.visible_from_order), role: viewer.role, ownerMemberId: String(room.owner_member_id) }, {
      roomId: source.room_id, streamId: source.stream_id, streamRoomId: source.room_id, streamKind: source.stream_kind, order: BigInt(source.created_order),
      deleted: source.deleted_at !== null, moderated: Number(source.moderated) === 1, deletionRootBlocked: Number(source.root_blocked) === 1 || ['DELETING', 'DELETED'].includes(source.content_owner_status), grant: null })) throw new ApiError('NOT_FOUND', 404);
    if (!['TEXT', 'PHOTO'].includes(source.content_kind) || (source.content_kind === 'TEXT' && source.text_content === null) || source.deletion_root_id) throw new ApiError('INVALID_REQUEST', 400);
    if (source.content_kind === 'PHOTO') await this.photoSources(tx, roomId, source.id);
    const [revision] = await this.repository.revision(tx, roomId, source.id);
    return { viewer, source, revision: String(revision!.content_revision) };
  }

  // Caller requires current verified session and CSRF on this same transaction.
  async requestPublication(tx: Transaction, roomId: string, userId: string, messageId: string) {
    const { source, viewer, revision } = await this.sourceForOwner(tx, roomId, userId, messageId);
    const [existing] = await this.repository.existing(tx, roomId, messageId, revision);
    if (existing) return receipt(existing);
    const id = randomUUID();
    await this.repository.insert(tx, id, roomId, source.id, revision, viewer.id);
    await this.jobs.enqueue(tx, { purpose: 'PUBLICATION', roomId, resourceId: id, dedupeKey: digest(`publication:${id}`) });
    return { publicationId: id, status: 'preparing' };
  }
  async publicationStatus(tx: Transaction, roomId: string, userId: string, publicationId: string) {
    const viewer = await this.access.requireActiveMember(tx, identifier(roomId), userId);
    const [row] = await this.repository.status(tx, roomId, identifier(publicationId), viewer.id, viewer.id);
    if (!row || viewer.role !== 'STREAMER') throw new ApiError('NOT_FOUND', 404);
    return receipt(row);
  }

  // External I/O is unnecessary for text. Media preparation will be outside this finalizing TX.
  async publishText(transactions: Transactions, lease: JobLease): Promise<'completed' | 'lease_lost'> {
    if (lease.purpose !== 'PUBLICATION' || !lease.roomId || !lease.resourceId) throw new JobFailure('INVALID_RESOURCE', true);
    try {
      return await transactions.write(async tx => {
        // Nonlocking lookup only discovers the account lock; every authority fact is rechecked below.
        const [candidate] = await this.repository.candidate(tx, lease.roomId!, lease.resourceId!);
        if (!candidate) throw new JobFailure('INVALID_RESOURCE', true);
        const [account] = await this.repository.lockAccount(tx, candidate.user_id);
        await this.repository.lockRoomForFinalize(tx, lease.roomId!);
        const [publication] = await this.repository.lockPublication(tx, lease.roomId!, lease.resourceId!);
        if (!publication) throw new JobFailure('INVALID_RESOURCE', true);
        if (publication.state === 'PREPARING') {
          let eligible: Awaited<ReturnType<PublicationsCoreService['sourceForOwner']>> | undefined;
          if (account) {
            try { eligible = await this.sourceForOwner(tx, lease.roomId!, String(account.id), String(publication.source_message_id)); }
            catch (error) { if (!(error instanceof ApiError)) throw error; }
          }
          if (eligible && eligible.source.content_kind !== 'TEXT') throw new JobFailure('SOURCE_UNAVAILABLE');
          if (!eligible || eligible.viewer.id !== publication.publisher_member_id || eligible.revision !== String(publication.source_version)) {
            await this.repository.revoke(tx, publication.id);
          } else {
            const streams = await this.repository.sharedStreams(tx, lease.roomId!);
            if (streams.length !== 1) throw new JobFailure('INVALID_RESOURCE', true);
            const id = randomUUID(); const order = await this.roomState.nextOrder(tx, lease.roomId!);
            await this.repository.insertCopy(tx, id, lease.roomId!, streams[0]!.id, eligible.viewer.id, eligible.source.content_owner_user_id, eligible.source.id, eligible.source.text_content, order.toString());
            await this.repository.publish(tx, id, publication.id);
            await this.repository.audit(tx, randomUUID(), account!.id, lease.roomId!, 'MESSAGE_PUBLISHED');
            await this.messages.recordEvent(tx, { id, room_id: lease.roomId!, stream_id: String(streams[0]!.id) }, '1', order, 'MESSAGE_CREATED');
          }
        }
        if (!await this.jobs.complete(tx, lease)) throw new StaleLease();
        return 'completed' as const;
      });
    } catch (error) { if (error instanceof StaleLease) return 'lease_lost'; throw error; }
  }

  private async photoSources(tx: Transaction, roomId: string, messageId: string) {
    const sources = await this.photos.sources(tx, roomId, messageId);
    const [count] = await this.photos.attachmentCount(tx, roomId, messageId);
    if (!sources.length || sources.length > 4 || sources.length !== Number(count?.n) ||
      sources.some((source, position) => source.position !== position || !Number.isSafeInteger(Number(source.byte_length)) ||
        Number(source.byte_length) < 1 || Number(source.byte_length) > 10 * 1024 * 1024 ||
        !/^[a-f0-9]{64}$/.test(source.sha256) || source.width < 1 || source.height < 1)) throw new ApiError('NOT_FOUND', 404);
    return sources;
  }
  private async photoContext(tx: Transaction, lease: JobLease) {
    if (lease.purpose !== 'PUBLICATION' || !lease.roomId || !lease.resourceId) throw new JobFailure('INVALID_RESOURCE', true);
    const [candidate] = await this.repository.candidate(tx, lease.roomId, lease.resourceId);
    if (!candidate) throw new JobFailure('INVALID_RESOURCE', true);
    const [account] = await this.repository.lockAccount(tx, candidate.user_id);
    await this.repository.lockRoomForFinalize(tx, lease.roomId);
    const [publication] = await this.repository.lockPublication(tx, lease.roomId, lease.resourceId);
    if (!publication) throw new JobFailure('INVALID_RESOURCE', true);
    let eligible: Awaited<ReturnType<PublicationsCoreService['sourceForOwner']>> | undefined;
    if (publication.state === 'PREPARING' && account) {
      try { eligible = await this.sourceForOwner(tx, lease.roomId, String(account.id), String(publication.source_message_id)); }
      catch (error) { if (!(error instanceof ApiError)) throw error; }
    }
    if (eligible && (eligible.viewer.id !== publication.publisher_member_id || eligible.revision !== String(publication.source_version))) eligible = undefined;
    return { publication, eligible, account };
  }
  private async discardCopies(tx: Transaction, publicationId: string) {
    for (const copy of await this.photos.copies(tx, publicationId)) {
      await this.photos.block(tx, copy.destination_asset_id);
      await this.jobs.enqueue(tx, { purpose: 'MEDIA', resourceId: copy.destination_asset_id, dedupeKey: digest(`publication-cleanup:${copy.destination_asset_id}`) });
    }
  }
  private async complete(tx: Transaction, lease: JobLease) {
    if (!await this.jobs.complete(tx, lease)) throw new StaleLease();
  }
  async preparePhoto(tx: Transaction, lease: JobLease, prefix: string): Promise<PhotoAttempt[] | 'text' | 'completed'> {
    const { publication, eligible } = await this.photoContext(tx, lease);
    if (publication.state !== 'PREPARING' || !eligible) {
      if (publication.state !== 'PUBLISHED') { await this.repository.revoke(tx, publication.id); await this.discardCopies(tx, String(publication.id)); }
      await this.complete(tx, lease); return 'completed';
    }
    if (eligible.source.content_kind === 'TEXT') return 'text';
    const sources = await this.photoSources(tx, lease.roomId!, eligible.source.id);
    // Superseded assets keep their immutable attempts and reservations until the
    // ordinary MEDIA cleanup horizon passes. Never reuse a key after uncertain PUT.
    await this.discardCopies(tx, String(publication.id));
    const attempts = await this.photos.allocate(tx, lease.roomId!, String(publication.id), eligible.source.content_owner_user_id, sources, prefix);
    if (!(await this.photos.fence(tx, lease.id, lease.generation, lease.leaseOwner, lease.leaseToken)).length) throw new StaleLease();
    return attempts;
  }
  async finalizePhoto(tx: Transaction, lease: JobLease, attempts: PhotoAttempt[]) {
    const { publication, eligible, account } = await this.photoContext(tx, lease);
    if (publication.state === 'PREPARING') {
      const sources = eligible?.source.content_kind === 'PHOTO' ? await this.photoSources(tx, lease.roomId!, eligible.source.id) : [];
      if (!eligible || sources.length !== attempts.length || sources.some((source, index) => source.asset_id !== attempts[index]?.asset_id || source.object_id !== attempts[index]?.object_id || source.sha256 !== attempts[index]?.sha256)) {
        await this.repository.revoke(tx, publication.id); await this.discardCopies(tx, String(publication.id));
      } else {
        for (const attempt of attempts) await this.photos.ready(tx, String(publication.id), attempt);
        const streams = await this.repository.sharedStreams(tx, lease.roomId!);
        if (streams.length !== 1) throw new JobFailure('INVALID_RESOURCE', true);
        const id = randomUUID(), order = await this.roomState.nextOrder(tx, lease.roomId!);
        await this.repository.insertCopy(tx, id, lease.roomId!, streams[0]!.id, eligible.viewer.id, eligible.source.content_owner_user_id, eligible.source.id, null, order.toString());
        await this.photos.attach(tx, lease.roomId!, id, attempts);
        await this.repository.publish(tx, id, publication.id);
        await this.repository.audit(tx, randomUUID(), account!.id, lease.roomId!, 'MESSAGE_PUBLISHED');
        await this.messages.recordEvent(tx, { id, room_id: lease.roomId!, stream_id: String(streams[0]!.id) }, '1', order, 'MESSAGE_CREATED');
      }
    } else if (publication.state !== 'PUBLISHED') await this.discardCopies(tx, String(publication.id));
    await this.complete(tx, lease);
  }
  isStaleLease(error: unknown): boolean { return error instanceof StaleLease; }

  async recoverPhotos(tx: Transaction) {
    for (const candidate of await this.photos.abandoned(tx)) {
      await this.repository.lockRoomForFinalize(tx, candidate.room_id);
      const [publication] = await this.repository.lockPublication(tx, candidate.room_id, candidate.id);
      if (!publication || publication.state !== 'PREPARING') continue;
      // Hold asset locks before the final job fence, matching worker finalization.
      const copies = await this.photos.copies(tx, candidate.id);
      for (const copy of copies) await this.repository.lockCopyAsset(tx, copy.destination_asset_id);
      if ((await this.photos.runnable(tx, candidate.id)).length) continue;
      await this.repository.revoke(tx, candidate.id);
      await this.discardCopies(tx, candidate.id);
    }
  }

}
