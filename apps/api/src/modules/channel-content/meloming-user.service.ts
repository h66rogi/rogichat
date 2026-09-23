import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { nextChannelContentId } from './channel-content-id.js';

/** Durable numeric user keys let the copied Meloming UI compare identities without exposing Rogichat UUIDs. */
@Injectable()
export class MelomingUserService {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly channel: ChannelContentRepository,
  ) {}

  me(credentials: SessionCredentials) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials);
      await this.channel.lockPrimary(tx);
      let alias = await tx.prisma.melomingUserAlias.findUnique({ where: { userId: actor.userId }, select: { id: true } });
      if (!alias) alias = await tx.prisma.melomingUserAlias.create({
        data: { id: await nextChannelContentId(tx.prisma), userId: actor.userId }, select: { id: true },
      });
      const user = await tx.prisma.users.findUnique({ where: { id: actor.userId },
        select: { status: true, created_at: true,
          profile: { select: { nickname: true } },
          soop: { select: { profile_image_url: true } },
          admin: { select: { manage_rooms: true, manage_users: true, manage_stickers: true } },
          creator: { select: { enabled: true } },
        } });
      if (!user || user.status !== 'ACTIVE' || !user.profile) throw new ApiError('UNAUTHENTICATED', 401);
      const session = await tx.prisma.auth_sessions.findUnique({ where: { id: actor.sessionId }, select: { created_at: true } });
      return {
        id: alias.id, email: '', nickname: user.profile.nickname,
        profileImageUrl: user.soop?.profile_image_url ?? null,
        isAdmin: Boolean(user.admin?.manage_rooms || user.admin?.manage_users || user.admin?.manage_stickers),
        isAmbassador: false, isEmailVerified: false,
        isIdentityVerified: false, identityMethod: null,
        isApproved: user.status === 'ACTIVE', isMarketingAllowableCheckNeeded: false,
        isProSubscriber: false, proSubscriptionEndAt: null,
        createdAt: user.created_at.toISOString(), lastLoginAt: session?.created_at.toISOString() ?? null,
      };
    });
  }
}
