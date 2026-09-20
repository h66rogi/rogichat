import { Inject, Injectable } from '@nestjs/common';
import { AccessService } from '../access/access.service.js';
import { MessagesCoreService } from '../messages/messages-core.service.js';
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
  constructor(@Inject(PublicationsRepository) private readonly repository: PublicationsRepository, @Inject(AccessService) private readonly access: AccessService, @Inject(MessagesCoreService) private readonly messages: MessagesCoreService, @Inject(JobsCoreService) private readonly jobs: JobsCoreService, @Inject(RoomStateService) private readonly roomState: RoomStateService) {}
  private async sourceForOwner(tx: Transaction, roomId: string, userId: string, messageId: string) {
    const [room] = await this.repository.lockRoom(tx, identifier(roomId));
    if (!room || room.status !== 'ACTIVE') throw new ApiError('NOT_FOUND', 404);
    const viewer = await this.access.requireActiveMember(tx, roomId, userId);
    const source = await this.messages.load(tx, roomId, identifier(messageId));
    if (!source || !canPublishSource({ accountActive: true, soopLinked: true, roomId, memberRoomId: roomId, roomActive: true,
      memberId: viewer.id, memberActive: true, periodActive: true, visibleFrom: BigInt(viewer.visible_from_order), role: viewer.role, ownerMemberId: String(room.owner_member_id) }, {
      roomId: source.room_id, streamId: source.stream_id, streamRoomId: source.room_id, streamKind: source.stream_kind, order: BigInt(source.created_order),
      deleted: source.deleted_at !== null, moderated: Number(source.moderated) === 1, deletionRootBlocked: Number(source.root_blocked) === 1 || ['DELETING', 'DELETED'].includes(source.content_owner_status), grant: null })) throw new ApiError('NOT_FOUND', 404);
    if (source.content_kind !== 'TEXT' || source.text_content === null || source.deletion_root_id) throw new ApiError('INVALID_REQUEST', 400);
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

}
