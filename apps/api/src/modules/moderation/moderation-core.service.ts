import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { ApiError } from '../auth/auth-primitives.js';
import { AccessService } from '../access/access.service.js';
import { RoomStateService } from '../rooms/room-state.service.js';
import { MessagesCoreService } from '../messages/messages-core.service.js';
import { ModerationRepository } from './moderation.repository.js';
import type { reportInput } from './moderation.dto.js';
export function reportReceipt(row: { id: string; status: string; created_at: Date }) {
  return { reportId: row.id, status: row.status, createdAt: row.created_at.toISOString() };
}
@Injectable()
export class ModerationCoreService {
  constructor(@Inject(ModerationRepository) private readonly repository: ModerationRepository,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(RoomStateService) private readonly state: RoomStateService,
    @Inject(MessagesCoreService) private readonly messages: MessagesCoreService) {}
  private async lockRoom(tx: Transaction, roomId: string) {
    try { return await this.state.lockRoom(tx, roomId); }
    catch (error) { if (error instanceof Error && error.message === 'room_unavailable') throw new ApiError('NOT_FOUND', 404); throw error; }
  }
  async report(tx: Transaction, userId: string, roomId: string, messageId: string, input: ReturnType<typeof reportInput>, key: Buffer) {
    const hash = createHmac('sha256', key).update('moderation-report:v1:').update(JSON.stringify([roomId, messageId, input.reason, input.detail])).digest();
    // Auth holds the reporter account lock. Replay reconciles an already committed
    // receipt even after deletion/leave, without re-reading or exposing content.
    const prior = await this.repository.receipt(tx, userId, input.idempotencyKey);
    if (prior) {
      if (prior.payload_digest.length !== hash.length || !timingSafeEqual(prior.payload_digest, hash)) throw new ApiError('CONFLICT', 409);
      return reportReceipt(prior);
    }
    await this.lockRoom(tx, roomId);
    const viewer = await this.access.requireActiveMember(tx, roomId, userId);
    const message = await this.messages.load(tx, roomId, messageId);
    if (!message || !await this.messages.readable(tx, viewer, message)) throw new ApiError('NOT_FOUND', 404);
    const now = await tx.now();
    const row = await this.repository.createReport(tx, { id: randomUUID(), reporter_user_id: userId, idempotency_key: input.idempotencyKey,
      payload_digest: hash, room_id: roomId, message_id: messageId, root_message_id: message.deletion_root_id ?? message.id,
      content_owner_user_id: message.content_owner_user_id, reason: input.reason, detail: input.detail,
      detail_expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000), created_at: now });
    return reportReceipt(row);
  }
  async receipt(tx: Transaction, userId: string, id: string, byKey = false) {
    const row = byKey ? await this.repository.receipt(tx, userId, id) : await this.repository.ownReport(tx, userId, id);
    if (!row) throw new ApiError('NOT_FOUND', 404);
    return reportReceipt(row);
  }
  async blocks(tx: Transaction, userId: string, roomId: string, after: string) {
    const rows = await this.repository.ownBlocks(tx, roomId, userId, after);
    return { blocks: rows.slice(0, 50).map(row => ({ actorId: row.target_actor_id, blockedAt: row.created_at.toISOString(), displayName: row.displayName })), next: rows.length > 50 ? rows[49]!.target_actor_id : null };
  }
  async block(tx: Transaction, userId: string, roomId: string, actorId: string, blocked: boolean) {
    await this.lockRoom(tx, roomId);
    const member = await this.repository.member(tx, roomId, userId);
    if (!member || member.id === actorId) throw new ApiError('NOT_FOUND', 404);
    if (blocked) {
      const viewer = await this.access.requireActiveMember(tx, roomId, userId);
      const target = await this.repository.target(tx, roomId, actorId);
      // Same legitimate actor visibility as profiles. In FAN rooms this never
      // turns an anonymous publication into a source fan discovery oracle.
      if (!target || target.status !== 'ACTIVE' || !target.active_period_id || !target.valid_period_id || target.period_left_at !== null || target.account_status !== 'ACTIVE' || target.soop_status !== 'VERIFIED' ||
        (viewer.mode === 'FAN' && viewer.role !== 'STREAMER' && target.role !== 'STREAMER')) throw new ApiError('NOT_FOUND', 404);
    }
    if (await this.repository.setBlock(tx, roomId, member.id, actorId, blocked)) {
      await this.repository.invalidate(tx, roomId, member.id);
      await this.repository.invalidate(tx, roomId, actorId);
    }
    return { actorId, blocked, resetRequired: true as const };
  }
  async bans(tx: Transaction, userId: string, roomId: string, after: string) {
    const room = await this.lockRoom(tx, roomId);
    const viewer = await this.access.requireActiveMember(tx, roomId, userId);
    if (room.owner_member_id !== viewer.id || viewer.role !== 'STREAMER') throw new ApiError('FORBIDDEN', 403);
    const rows = await this.repository.bans(tx, roomId, after);
    return { bans: rows.slice(0, 50).map(row => ({ actorId: row.id })), next: rows.length > 50 ? rows[49]!.id : null };
  }
  async ban(tx: Transaction, userId: string, roomId: string, actorId: string, banned: boolean) {
    const room = await this.lockRoom(tx, roomId);
    const viewer = await this.access.requireActiveMember(tx, roomId, userId);
    if (room.owner_member_id !== viewer.id || viewer.role !== 'STREAMER') throw new ApiError('FORBIDDEN', 403);
    if (actorId === viewer.id) throw new ApiError('FORBIDDEN', 403);
    const target = await this.repository.target(tx, roomId, actorId);
    if (!target) throw new ApiError('NOT_FOUND', 404);
    if ((target.status === 'BANNED') !== banned) {
      await this.repository.ban(tx, roomId, actorId, target.active_period_id, banned);
      await this.repository.audit(tx, userId, banned ? 'MEMBER_BANNED' : 'MEMBER_UNBANNED', { room_id: roomId, target_actor_id: actorId });
    }
    return { actorId, banned, rejoinRequired: !banned };
  }
  async review(tx: Transaction, userId: string, after: string) {
    if (!await this.repository.manager(tx, userId)) throw new ApiError('FORBIDDEN', 403);
    const rows = await this.repository.queue(tx, after);
    const now = await tx.now();
    await this.repository.audit(tx, userId, 'REPORT_QUEUE_VIEWED', {});
    const reports = [];
    for (const row of rows.slice(0, 50)) reports.push({ ...reportReceipt(row), reason: row.reason,
      detail: row.detail_expires_at > now && await this.repository.detailAvailable(tx, row) ? row.detail : null });
    return { reports, next: rows.length > 50 ? rows[49]!.id : null };
  }
  async resolve(tx: Transaction, userId: string, reportId: string, status: string) {
    if (!await this.repository.manager(tx, userId)) throw new ApiError('FORBIDDEN', 403);
    const row = await this.repository.reportForReview(tx, reportId);
    if (!row) throw new ApiError('NOT_FOUND', 404);
    if (row.status !== 'received' && row.status !== status) throw new ApiError('CONFLICT', 409);
    if (row.status === 'received') {
      await this.repository.resolve(tx, reportId, status, await tx.now());
      await this.repository.audit(tx, userId, status === 'resolved' ? 'REPORT_RESOLVED' : 'REPORT_DISMISSED', { report_id: reportId });
    }
    return reportReceipt({ ...row, status });
  }
}
