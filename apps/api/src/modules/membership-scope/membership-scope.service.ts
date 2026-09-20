import { authorizationKey } from '../../infrastructure/config/authorization-epoch.js';
import { MembershipScopeRepository } from './membership-scope.repository.js';
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { ApiError } from '../auth/auth-primitives.js';
import { membershipScope } from './membership-scope.js';

const maximum = 10000;
@Injectable()
export class MembershipScopeService {
  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig, @Inject(MembershipScopeRepository) private readonly repository: MembershipScopeRepository) {}
  async one(tx: Transaction, userId: string, roomId: string, now: Date) {
    const result = (await this.batch(tx, userId, [roomId], now)).get(roomId);
    if (!result) throw new ApiError('NOT_FOUND', 404);
    return result;
  }
  // Bounded batched queries for the selected room set, never per-room ACL fanout.
  async batch(tx: Transaction, userId: string, roomIds: string[], now: Date) {
    if (roomIds.length > maximum) throw new ServiceUnavailableException();
    if (!roomIds.length) return new Map<string, { membershipScope: string; authorizationRevision: string }>();
    const { members, grants, revoked, delegations } = await this.repository.batch(tx, userId, roomIds, now);
    const byMember = new Map<string, object[]>();
    for (const { member_id, ...grant } of grants) {
      const rows = byMember.get(member_id) ?? [];
      rows.push({ ...grant, can_read: Number(grant.can_read), can_send: Number(grant.can_send), active: Number(grant.valid_from <= now && (grant.expires_at === null || grant.expires_at > now) && grant.revoked_at === null) });
      byMember.set(member_id, rows);
    }
    const byRoom = new Map<string, string[]>();
    for (const row of revoked) { const ids = byRoom.get(row.room_id) ?? []; ids.push(row.id); byRoom.set(row.room_id, ids); }
    return new Map(members.map(m => [m.room_id, {
      membershipScope: membershipScope(authorizationKey(this.config), this.config.audience, userId, m.room_id, m.active_period_id!),
      authorizationRevision: createHmac('sha256', authorizationKey(this.config)).update('authorization-revision:v1:').update(JSON.stringify([this.config.audience,
        [m.id, m.role, m.room.mode, m.active_period_id, String(m.active_period!.visible_from_order), String(m.acl_epoch), m.room.policy_version, String(m.room.content_epoch), String(m.user.membership_generation), byMember.get(m.id) ?? [], byRoom.get(m.room_id) ?? [],
          ...(delegations?.some(g => g.room_id === m.room_id) ? [delegations.filter(g => g.room_id === m.room_id).map(g => [g.id, g.member_id, g.period_id, g.expires_at, g.revoked_at, !g.revoked_at && g.expires_at > now && g.period_id === g.member.active_period_id])] : [])]])).digest('base64url'),
    }]));
  }
}
