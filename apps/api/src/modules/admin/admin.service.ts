import { Inject, Injectable } from '@nestjs/common';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import type { SessionCredentials } from '../auth/auth-context.js';
import { requireCommandProof } from '../auth/auth-context.js';
import { AccessService } from '../access/access.service.js';
import { AdminRepository } from './admin.repository.js';
import { issueGrant, revokeGrant } from './admin.dto.js';
import { identifier } from '../../common/validation/identifier.js';
const hash = (value: string) => createHash('sha256').update(value).digest();
const receipt = (row: { id: string; room_id: string; expires_at: Date; revoked_at: Date | null }) => ({ grantId: row.id, roomId: row.room_id, expiresAt: row.expires_at.toISOString(), revokedAt: row.revoked_at?.toISOString() ?? null });
@Injectable()
export class AdminService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService, @Inject(AccessService) private readonly access: AccessService,
    @Inject(AdminRepository) private readonly repository: AdminRepository) {}
  private async operator(tx: Transaction, credentials: SessionCredentials) {
    const actor = await this.auth.require(tx, credentials, true);
    if (!(await this.repository.capabilities(tx, actor.userId)).manage_test_access) throw new ApiError('FORBIDDEN', 403);
    return actor;
  }
  capabilities(credentials: SessionCredentials) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials);
      const capabilities = await this.repository.capabilities(tx, actor.userId);
      return { chat: actor.chatEnabled, admin: { enabled: capabilities.enabled, manageTestAccess: actor.chatEnabled && capabilities.manage_test_access, manageReviewers: false }, password: { enabled: Boolean(await this.repository.password(tx, actor.userId)) } };
    });
  }
  roomCapabilities(credentials: SessionCredentials, roomId: string) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const member = await this.access.requireActiveMember(tx, identifier(roomId), actor.userId);
      const streamer = member.role === 'STREAMER';
      return { effectiveRole: member.role, canSendShared: member.mode === 'GROUP' || streamer, canSendToOwner: member.mode === 'FAN' && member.role === 'FAN', canReadFanInbox: member.mode === 'FAN' && streamer, canPublish: streamer, canModerate: streamer,
        temporaryStreamer: member.temporaryGrantId ? { grantId: member.temporaryGrantId, expiresAt: member.temporaryExpiresAt!.toISOString() } : null };
    });
  }
  issue(credentials: SessionCredentials, roomId: string, body: unknown) {
    requireCommandProof(credentials); const input = issueGrant(body); identifier(roomId);
    return this.transactions.write(async tx => {
      const actor = await this.operator(tx, credentials);
      const room = await this.repository.lockRoom(tx, roomId);
      if (!room || room.status !== 'ACTIVE') throw new ApiError('NOT_FOUND', 404);
      if (room.mode !== 'FAN') throw new ApiError('FORBIDDEN', 403);
      const member = await this.access.requireActiveMember(tx, roomId, actor.userId);
      const payload = hash(JSON.stringify([roomId, input.durationSeconds, input.reason]));
      const previous = await this.repository.receipt(tx, member.id, input.requestId);
      if (previous) {
        if (!timingSafeEqual(Buffer.from(previous.payload_digest), payload)) throw new ApiError('CONFLICT', 409);
        return receipt(previous);
      }
      if (member.role !== 'FAN' || member.temporaryGrantId) throw new ApiError('CONFLICT', 409);
      const now = await tx.now();
      const row = await this.repository.create(tx, { id: randomUUID(), room_id: roomId, member_id: member.id, period_id: member.active_period_id, request_id: input.requestId, payload_digest: payload, created_at: now, expires_at: new Date(now.getTime() + input.durationSeconds * 1000) });
      await this.repository.invalidate(tx, member.id, actor.userId);
      await this.repository.audit(tx, actor.userId, roomId, row.id, 'ROOM_TEST_GRANTED', hash(input.reason));
      return receipt(row);
    });
  }
  list(credentials: SessionCredentials, roomId: string, after?: string) {
    identifier(roomId); const edge = after === undefined ? '' : identifier(after);
    return this.transactions.read(async tx => {
      const actor = await this.operator(tx, credentials);
      const rows = await this.repository.list(tx, roomId, actor.userId, edge);
      return { grants: rows.slice(0, 50).map(row => ({ ...receipt(row), createdAt: row.created_at.toISOString() })), next: rows.length > 50 ? rows[49]!.id : null };
    });
  }
  revoke(credentials: SessionCredentials, roomId: string, grantId: string, body: unknown) {
    requireCommandProof(credentials); identifier(roomId); identifier(grantId); const reason = revokeGrant(body);
    return this.transactions.write(async tx => {
      const actor = await this.operator(tx, credentials);
      await this.repository.lockRoom(tx, roomId);
      const grant = await this.repository.find(tx, roomId, actor.userId, grantId);
      if (!grant) throw new ApiError('NOT_FOUND', 404);
      if ((await this.repository.revoke(tx, roomId, actor.userId, grantId)).count) {
        await this.repository.invalidate(tx, grant.member_id, actor.userId);
        await this.repository.audit(tx, actor.userId, roomId, grantId, 'ROOM_TEST_REVOKED', hash(reason));
      }
    });
  }
}
