import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { AuthService } from '../auth/auth.service.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import type { SessionCredentials, CommandCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { requireCommandProof } from '../auth/auth-context.js';
import { identifier } from '../../common/validation/identifier.js';
import { roomCommandRate } from '../../infrastructure/rate-limit/room-command-rate.js';
import { ReactionsCoreService } from './reactions-core.service.js';

@Injectable()
export class ReactionsService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(ReactionsCoreService) private readonly core: ReactionsCoreService) {}
  async set(credentials: CommandCredentials, roomId: string, messageId: string, emoji: string | null) {
    identifier(roomId); identifier(messageId); requireCommandProof(credentials);
    const allowed = await this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return roomCommandRate(tx, this.config.key, actor.userId, roomId, 'reaction');
    });
    if (!allowed) throw new ApiError('RATE_LIMITED', 429);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return this.core.setReaction(tx, roomId, actor.userId, messageId, emoji);
    });
  }
  get(credentials: SessionCredentials, roomId: string, id: string) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return this.core.readReactions(tx, roomId, actor.userId, id);
    });
  }
}
