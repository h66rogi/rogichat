import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { consumeRate } from '../../infrastructure/rate-limit/rate-limit.repository.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { AuthService } from '../auth/auth.service.js';
import type { CommandCredentials, SessionCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { StickersCoreService } from './stickers-core.service.js';

@Injectable()
export class StickersService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(StickersCoreService) private readonly stickers: StickersCoreService) {}

  list(credentials: SessionCredentials, roomId: string, after?: string) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return this.stickers.list(tx, roomId, actor.userId, after);
    });
  }
  private async admit(credentials: CommandCredentials): Promise<void> {
    const allowed = await this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const key = createHmac('sha256', this.config.key).update(`sticker-admin:${actor.userId}`).digest();
      return consumeRate(tx, key, 20, 60);
    });
    if (!allowed) throw new ApiError('RATE_LIMITED', 429);
  }
  async register(credentials: CommandCredentials, body: unknown) {
    await this.admit(credentials);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return this.stickers.register(tx, actor.userId, body);
    });
  }
  async changeState(credentials: CommandCredentials, stickerId: string, body: unknown) {
    await this.admit(credentials);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return this.stickers.changeState(tx, actor.userId, stickerId, body);
    });
  }
}
