import { MessageEligibilityService } from './message-eligibility.service.js';
import { messageDeletionId } from '../deletion/deletion-ledger.js';
import type { DeletionIntent, LedgerEnvironment } from '../deletion/deletion-ledger.js';

import { membershipScope } from '../membership-scope/membership-scope.js';
import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { ApiError, digest } from '../auth/auth-primitives.js';
import { AccessService } from '../access/access.service.js';
import type { ActiveMember } from '../access/access.types.js';
import { identifier } from '../../common/validation/identifier.js';
import { RoomStateService } from '../rooms/room-state.service.js';
import { canReadMessage } from '../access/access.policy.js';
import { JobsCoreService } from '../jobs/jobs-core.service.js';
import { MessagesRepository } from './messages.repository.js';
import type { MessageRow } from './message.types.js';
import type { SendInput } from './dto/send-message.dto.js';
import { projectMessageDto } from './message-projection.js';
import { RoomMediaCoreService } from '../media/room-media-core.service.js';
import { StickersCoreService } from '../stickers/stickers-core.service.js';
import type { MessageReadModel } from './message-projection.js';

// Transaction-scoped domain operations. Does not own a pool, session, request, or transaction.
// HTTP admission belongs to MessagesService; workers use explicit trusted transaction ports.
@Injectable()
export class MessagesCoreService {
  constructor(@Inject(MessagesRepository) private readonly repository: MessagesRepository,
    @Inject(AccessService) private readonly access: AccessService, @Inject(JobsCoreService) private readonly jobs: JobsCoreService, @Inject(RoomStateService) private readonly roomState: RoomStateService, @Inject(RoomMediaCoreService) private readonly roomMedia: RoomMediaCoreService, @Inject(StickersCoreService) private readonly stickers: StickersCoreService, @Inject(MessageEligibilityService) private readonly eligibility: MessageEligibilityService) {}

  load(tx: Transaction, roomId: string, messageId: string) { return this.repository.load(tx, roomId, messageId); }

  async readable(tx: Transaction, viewer: ActiveMember, row: MessageRow): Promise<boolean> {
    // Publication authors are anonymous: never resolve the private source fan.
    // The publisher actor remains the policy subject without exposing it in DTOs.
    if (await this.access.actorBlocked(tx, row.room_id, viewer.id, row.sender_member_id)) return false;
    const grant = row.stream_kind === 'RESTRICTED' ? await this.repository.grant(tx, row.room_id, row.stream_id, viewer.id) : undefined;
    const allowed = canReadMessage({ accountActive: true, chatEnabled: true, roomId: viewer.room_id, memberRoomId: viewer.room_id,
      roomActive: true, memberId: viewer.id, memberActive: true, periodActive: true,
      visibleFrom: BigInt(viewer.visible_from_order), role: viewer.role, ownerMemberId: null, delegated: Boolean(viewer.temporaryGrantId) }, {
      roomId: row.room_id, streamId: row.stream_id, streamRoomId: row.room_id, streamKind: row.stream_kind,
      order: BigInt(row.created_order), deleted: row.deleted_at !== null, moderated: Number(row.moderated) === 1,
      deletionRootBlocked: Number(row.root_blocked) === 1 || ['DELETING', 'DELETED'].includes(row.content_owner_status),
      grant: grant ? { roomId: String(grant.room_id), streamId: String(grant.stream_id), memberId: String(grant.member_id), canRead: Number(grant.can_read) === 1, active: true } : null,
    });
    if (!allowed || row.content_kind !== 'STICKER') return allowed;
    try { await this.stickers.messageContent(tx, row.room_id, row.id); return true; }
    catch (error) { if (error instanceof ApiError && error.code === 'NOT_FOUND') return false; throw error; }
  }

  async project(tx: Transaction, viewer: ActiveMember, row: MessageRow) {
    if (!await this.readable(tx, viewer, row)) throw new ApiError('NOT_FOUND', 404);
    let quote: { id: string; content: { type: 'TEXT'; text: string } } | null = null;
    if (row.quote_id && !row.deletion_root_id) {
      const source = await this.load(tx, row.room_id, row.quote_id);
      const sameAudience = source && (source.stream_kind === 'ROOM_SHARED' || source.stream_id === row.stream_id ||
        row.stream_kind === 'RESTRICTED' && source.sender_member_id !== row.sender_member_id &&
        Boolean(await this.repository.quotePair(tx, row.room_id, row.stream_id, row.sender_member_id, source.sender_member_id)));
      if (source && sameAudience && await this.readable(tx, viewer, source) && source.content_kind === 'TEXT' && source.text_content !== null) {
        quote = { id: source.id, content: { type: 'TEXT', text: source.text_content } };
      }
    }
    let content: MessageReadModel['content'];
    if (row.content_kind === 'TEXT') content = { type: 'TEXT', text: row.text_content };
    else if (row.content_kind === 'STICKER') content = { type: 'STICKER', ...await this.stickers.messageContent(tx, row.room_id, row.id) };
    else if (row.content_kind === 'PHOTO' || row.content_kind === 'VIDEO') {
      const attachments = await this.repository.attachments(tx, row.room_id, row.id);
      content = { type: row.content_kind, attachments: attachments.map(a => ({ assetId: String(a.id), width: Number(a.width), height: Number(a.height), variant: String(a.variant) })) };
    } else throw new ApiError('NOT_FOUND', 404);
    const hints = (await this.eligibility.project(tx, viewer, [row.id])).get(row.id)!;
    return projectMessageDto({ ...hints, id: row.id, version: String(row.version), createdAt: row.created_at,
      audience: row.stream_kind === 'ROOM_SHARED' ? 'SHARED' : 'PRIVATE',
      author: row.deletion_root_id ? { kind: 'anonymous' } : { kind: 'member', actorId: row.sender_member_id, nickname: row.nickname ?? '사용자', avatar: row.avatar_id ? { assetId: row.avatar_id } : null }, content, quote });
  }

  async get(tx: Transaction, roomId: string, userId: string, messageId: string) {
    const viewer = await this.access.requireActiveMember(tx, identifier(roomId), userId);
    const row = await this.load(tx, roomId, identifier(messageId));
    if (!row) throw new ApiError('NOT_FOUND', 404);
    return this.project(tx, viewer, row);
  }

  private async sendStream(tx: Transaction, viewer: ActiveMember, input: SendInput): Promise<string> {
    if (input.intent === 'SHARED') {
      const rows = await this.repository.sharedStreams(tx, viewer.room_id);
      if (rows.length !== 1) throw new ApiError('CONFLICT', 409);
      return String(rows[0]!.id);
    }
    if (viewer.id === input.recipientActorId) throw new ApiError('INVALID_REQUEST', 400);
    const target = await this.repository.target(tx, viewer.room_id, input.recipientActorId!);
    if (!target) throw new ApiError('NOT_FOUND', 404);
    if (viewer.mode === 'FAN' && !((viewer.role === 'FAN' && target.role === 'STREAMER') || (viewer.role === 'STREAMER' && target.role === 'FAN'))) throw new ApiError('FORBIDDEN', 403);
    if (await this.access.actorBlocked(tx, viewer.room_id, viewer.id, target.id, true)) throw new ApiError('NOT_FOUND', 404);
    const members = [viewer.id, input.recipientActorId!].sort() as [string, string];
    const pair = await this.repository.pair(tx, viewer.room_id, members);
    const streamId = pair ? String(pair.stream_id) : randomUUID();
    // The delegated participant receives NO durable private read/send authority.
    // Their live room grant supplies it; the real recipient retains their reply.
    if (!pair) await this.repository.createPair(tx, viewer.room_id, streamId, members, viewer.temporaryGrantId ? viewer.id : target.delegated ? target.id : undefined);
    // Existing pairs never repair revoked grants, including after a participant rejoins.
    const grants = await this.repository.sendGrants(tx, viewer.room_id, streamId, members);
    if (grants.length !== 2 || !grants.every(g => g.member_id === viewer.id ? Boolean(viewer.temporaryGrantId) || Number(g.can_read) === 1 && Number(g.can_send) === 1 : Boolean(target.delegated) || Number(g.can_read) === 1)) throw new ApiError('FORBIDDEN', 403);
    return streamId;
  }

  async recordEvent(tx: Transaction, row: { id: string; room_id: string; stream_id: string }, version: string, order: bigint, kind: 'MESSAGE_CREATED' | 'MESSAGE_DELETED' | 'MESSAGE_UPDATED') {
    const id = await this.repository.event(tx, row, version, order, kind);
    await this.jobs.enqueue(tx, { purpose: 'REALTIME_HINT', roomId: row.room_id, resourceId: id, dedupeKey: digest(`hint:${id}`) });
    // Body-free fanout intent; recipient discovery stays out of the message tx.
    // NULL room distinguishes it from PUSH delivery intents (which carry a room).
    if (kind === 'MESSAGE_CREATED') await this.jobs.enqueue(tx, { purpose: 'PUSH', resourceId: row.id, dedupeKey: digest(`push-fanout:${row.id}`) });
  }

  // Caller revalidates the current session/account/SOOP on this SAME transaction handle.
  async send(tx: Transaction, roomId: string, userId: string, input: SendInput, key: Buffer, audience: string) {
    // Match bootstrap's binding→room lock order; never acquire the binding
    // after holding the room while bootstrap is waiting to attach inboxes.
    const awaitingOwner = (input.intent === 'ROOM_OWNER' || input.intent === 'SHARED') && await this.repository.pendingOwner(tx, identifier(roomId));
    const owner = await this.access.lockRoomSendOwner(tx, identifier(roomId));
    const room = await this.repository.room(tx, roomId);
    if (!room) throw new ApiError('NOT_FOUND', 404);
    const member = await this.repository.member(tx, roomId, userId);
    if (!member) throw new ApiError('NOT_FOUND', 404);
    if (room.status !== 'ACTIVE') throw new ApiError('NOT_FOUND', 404);
    const viewer = await this.access.requireActiveMember(tx, roomId, userId);
    if (input.membershipScope !== membershipScope(key, audience, userId, roomId, viewer.active_period_id)) throw new ApiError('MEMBERSHIP_SCOPE_MISMATCH', 409);
    // Preserve the exact v1 digest field order and null normalization across membership periods.
    const payload = { clientMessageId: input.clientMessageId, intent: input.intent, recipientActorId: input.recipientActorId, quoteId: input.quoteId, content: input.content };
    const hash = createHmac('sha256', key).update('message-command:v1:').update(JSON.stringify(payload)).digest();
    const receipt = await this.repository.receipt(tx, roomId, String(member.id), input.clientMessageId);
    if (receipt && Number(receipt.deleted) === 1) return { clientMessageId: input.clientMessageId, messageId: String(receipt.message_id), status: 'deleted' as const };
    if (receipt) {
      if (Number(receipt.digest_version) !== 1 || !Buffer.isBuffer(receipt.payload_digest) || receipt.payload_digest.length !== 32 || !timingSafeEqual(hash, receipt.payload_digest)) throw new ApiError('CONFLICT', 409);
      const previous = await this.load(tx, roomId, String(receipt.message_id));
      if (!previous || !await this.readable(tx, viewer, previous)) throw new ApiError('NOT_FOUND', 404);
      return { clientMessageId: input.clientMessageId, messageId: previous.id, status: 'committed' as const, version: String(previous.version) };
    }
    // ROOM_OWNER addresses a real room inbox, not an invented recipient actor.
    // Only the never-bound default catalog admits it before owner onboarding.
    let streamId: string;
    if (input.intent === 'ROOM_OWNER' && viewer.mode === 'FAN' && viewer.role === 'FAN' && !room.owner_member_id) {
      if (!awaitingOwner) throw new ApiError('NOT_FOUND', 404);
      streamId = await this.repository.pendingInbox(tx, roomId, viewer.id);
      const grant = await this.repository.sendGrants(tx, roomId, streamId, [viewer.id, viewer.id]);
      if (grant.length !== 1 || Number(grant[0]!.can_read) !== 1 || Number(grant[0]!.can_send) !== 1) throw new ApiError('FORBIDDEN', 403);
    } else {
      const delegatedTarget = input.intent === 'PRIVATE' && (await this.repository.target(tx, roomId, input.recipientActorId!))?.delegated;
      if (!viewer.temporaryGrantId && !delegatedTarget && !(input.intent === 'SHARED' && !room.owner_member_id && awaitingOwner)) await this.access.requireRoomSendOwner(tx, roomId, room.owner_member_id, owner);
      if (input.intent === 'ROOM_OWNER' && (viewer.mode !== 'FAN' || viewer.role !== 'FAN')) throw new ApiError('FORBIDDEN', 403);
      streamId = await this.sendStream(tx, viewer, input.intent === 'ROOM_OWNER'
        ? { ...input, intent: 'PRIVATE', recipientActorId: room.owner_member_id } : input);
    }
    if (input.quoteId) {
      const quote = await this.load(tx, roomId, input.quoteId);
      if (!quote || !await this.readable(tx, viewer, quote)) throw new ApiError('NOT_FOUND', 404);
      if (quote.stream_kind !== 'ROOM_SHARED' && quote.stream_id !== streamId) {
        // A temporary operator may answer an owner's inbox back to its actual
        // original fan only. This is not forwarding to a different audience.
        if (!viewer.temporaryGrantId || input.intent !== 'PRIVATE' || input.recipientActorId !== quote.sender_member_id || quote.deletion_root_id) throw new ApiError('NOT_FOUND', 404);
        const target = await this.repository.target(tx, roomId, input.recipientActorId);
        if (!target || target.role !== 'FAN') throw new ApiError('NOT_FOUND', 404);
        const peer = await this.access.requireActiveMember(tx, roomId, target.user_id);
        if (!await this.readable(tx, peer, quote) || !await this.repository.quotePair(tx, roomId, streamId, viewer.id, peer.id)) throw new ApiError('NOT_FOUND', 404);
      }
    }
    const id = randomUUID(); const order = await this.roomState.nextOrder(tx, roomId);
    if (input.content.type === 'STICKER') await this.stickers.requireSend(tx, roomId, input.content.stickerId);
    else if (input.content.type !== 'TEXT') {
      for (const assetId of [...input.content.assetIds].sort()) {
        const asset = await this.repository.requireAsset(tx, roomId, userId, input.content.type, assetId);
        if (!asset) throw new ApiError('NOT_FOUND', 404);
        await this.roomMedia.requireRoomMedia(tx, roomId, input.content.type, asset.declaredBytes);
      }
    }
    await this.repository.insertMessage(tx, { id, roomId, streamId, actorId: viewer.id, userId, quoteId: input.quoteId, content: input.content, order });
    if (input.content.type === 'STICKER') await this.stickers.attach(tx, roomId, id, input.content.stickerId);
    await this.repository.insertReceipt(tx, { roomId, actorId: viewer.id, clientMessageId: input.clientMessageId, messageId: id, payloadDigest: hash });
    await this.recordEvent(tx, { id, room_id: roomId, stream_id: streamId }, '1', order, 'MESSAGE_CREATED');
    return { clientMessageId: input.clientMessageId, messageId: id, status: 'committed' as const, version: '1' };
  }

  async authorizeDeletion(tx: Transaction, roomId: string, userId: string, messageId: string, environment: LedgerEnvironment): Promise<DeletionIntent> {
    // Ownership survives leaving/closed rooms; fresh session validation is the caller's responsibility.
    if (!await this.repository.room(tx, identifier(roomId))) throw new ApiError('NOT_FOUND', 404);
    const row = await this.repository.ownedMessage(tx, roomId, identifier(messageId), userId);
    if (!row) throw new ApiError('NOT_FOUND', 404);
    const prior = await this.repository.deletionRequest(tx, userId, messageId);
    return { schemaVersion: 1, environment, actorUserId: userId, scope: 'MESSAGE', roomId, targetId: row.id,
      requestId: prior?.id ?? messageDeletionId(environment, userId, roomId, row.id),
      requestedAt: (prior?.requested_at ?? await tx.now()).toISOString() };
  }

  // Trusted durable-intent port, shared by admission and independent replay. No mutable session/member reauthorization.
  async remove(tx: Transaction, intent: DeletionIntent): Promise<boolean> {
    const { roomId, targetId: messageId, actorUserId: userId, requestId } = intent;
    if (intent.scope !== 'MESSAGE' || !roomId) throw new Error('unsupported_deletion_scope');
    if (!await this.repository.room(tx, roomId)) return false;
    const row = await this.repository.ownedMessage(tx, roomId, messageId, userId);
    if (!row) return false; // Restored target/actor may be absent. The opaque checkpoint remains an obligation.
    const prior = await this.repository.deletionRequest(tx, userId, messageId);
    if (prior) {
      if (prior.id !== requestId || prior.requested_at.toISOString() !== intent.requestedAt) throw new Error('deletion_receipt_conflict');
    }
    await this.repository.blockMessageAndCopies(tx, roomId, messageId, userId, requestId, new Date(intent.requestedAt), Boolean(prior));
    const assets = await this.repository.attachedAssets(tx, roomId, messageId);
    // All domain rows are locked/mutated before the first job lock.
    for (const asset of assets) await this.repository.blockAsset(tx, String(asset.id));
    if (!row.deleted_at) {
      const order = await this.repository.nextDeletionOrder(tx, roomId);
      await this.recordEvent(tx, { id: messageId, room_id: roomId, stream_id: String(row.stream_id) }, (BigInt(row.version as string) + 1n).toString(), order, 'MESSAGE_DELETED');
    }
    for (const asset of assets) await this.jobs.enqueue(tx, { purpose: 'MEDIA', resourceId: String(asset.id), dedupeKey: digest(`media-message-delete:${asset.id}:${requestId}`) });
    await this.jobs.enqueue(tx, { purpose: 'PURGE', roomId, resourceId: requestId, dedupeKey: digest(`purge:${requestId}`) });
    return true;
  }

  // Trusted worker port. Caller must fence its lease and continuation atomically
  // after these domain locks. A permanently moderated row is the durable cursor.
  async invalidateRevokedSticker(tx: Transaction, assetId: string): Promise<string | null> {
    const candidate = await this.repository.stickerInvalidationCandidate(tx, identifier(assetId));
    if (!candidate) return null;
    if (!await this.repository.room(tx, candidate.room_id)) throw new Error('room_unavailable');
    const rows = await this.repository.stickerInvalidationBatch(tx, candidate.room_id, assetId);
    for (const row of rows) {
      if ((await this.repository.moderateSticker(tx, row.room_id, row.id)).count !== 1) throw new Error('sticker_invalidation_conflict');
      // Closed rooms still receive durable deletion events, ready for any later reopening.
      const order = await this.repository.nextDeletionOrder(tx, row.room_id);
      await this.recordEvent(tx, row, (BigInt(row.version) + 1n).toString(), order, 'MESSAGE_DELETED');
    }
    return rows.at(-1)?.id ?? candidate.message_id;
  }
}
