import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { identifier } from '../../common/validation/identifier.js';
import { ApiError } from '../auth/auth-primitives.js';
import { AccessService } from '../access/access.service.js';
import { PrivateRecipientsRepository, RECIPIENT_BATCH_SIZE } from './private-recipients.repository.js';

export interface PrivateRecipientDto {
  actorId: string;
  nickname: string;
  avatar: { assetId: string } | null;
}

@Injectable()
export class PrivateRecipientsCoreService {
  constructor(@Inject(AccessService) private readonly access: AccessService,
    @Inject(PrivateRecipientsRepository) private readonly repository: PrivateRecipientsRepository) {}

  async list(tx: Transaction, roomId: string, userId: string, after?: string): Promise<{ recipients: PrivateRecipientDto[]; next: string | null }> {
    const viewer = await this.access.requireActiveMember(tx, identifier(roomId), userId);
    if (viewer.mode !== 'FAN' || (viewer.role !== 'STREAMER' && viewer.role !== 'FAN')) throw new ApiError('FORBIDDEN', 403);
    const blocked = new Set(await this.access.blockedActors(tx, roomId, viewer.id, true));
    const targetRole = viewer.role === 'STREAMER' ? 'FAN' : 'STREAMER';
    let scannedAfter = after === undefined ? '' : identifier(after);
    const now = await tx.now();
    const eligible: PrivateRecipientDto[] = [];
    // Internal candidate windows are not response pages: authorization happens
    // before the eligible 50 + 1 LIMIT. Never expose a skipped actor as a cursor.
    for (let scanned = 0; scanned < 10000; scanned += RECIPIENT_BATCH_SIZE) {
      const candidates = await this.repository.candidates(tx, roomId, targetRole, scannedAfter);
      const pairs = candidates.length ? await this.repository.pairs(tx, roomId, viewer.id, candidates.map(candidate => candidate.id), now) : [];
      const byRecipient = new Map(pairs.map(pair => [pair.left_member_id === viewer.id ? pair.right_member_id : pair.left_member_id, pair]));
      for (const candidate of candidates) {
        if (candidate.id === viewer.id || blocked.has(candidate.id)) continue;
        if (!candidate.active_period || candidate.active_period.member_id !== candidate.id ||
          candidate.active_period.room_id !== roomId || candidate.active_period.left_at !== null) continue;
        const pair = byRecipient.get(candidate.id);
        if (pair) {
          const grants = pair.stream.grants.filter(grant => grant.member_id === viewer.id || grant.member_id === candidate.id);
          if (pair.stream.room_id !== roomId || pair.stream.kind !== 'RESTRICTED' || grants.length !== 2 || !grants.every(grant => grant.member_id === viewer.id ? Boolean(viewer.temporaryGrantId) || grant.can_read && grant.can_send : candidate.delegated || grant.can_read)) continue;
        }
        const profile = candidate.user.profile;
        if (!profile) continue;
        const avatar = profile.avatar;
        eligible.push({ actorId: candidate.id, nickname: profile.nickname,
          avatar: avatar && avatar.owner_user_id === candidate.user_id && avatar.kind === 'AVATAR' && avatar.room_id === null &&
            avatar.state === 'READY' && avatar.deleted_at === null ? { assetId: avatar.id } : null });
        if (eligible.length === 51) return { recipients: eligible.slice(0, 50), next: eligible[49]!.actorId };
      }
      if (candidates.length < RECIPIENT_BATCH_SIZE) return { recipients: eligible, next: null };
      scannedAfter = candidates.at(-1)!.id;
    }
    // Cannot prove exhaustion within the work budget. No false empty/success or
    // inaccessible continuation token; callers may retry after state changes.
    throw new ServiceUnavailableException();
  }
}
