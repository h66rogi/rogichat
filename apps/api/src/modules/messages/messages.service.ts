import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { ApiError, opaque } from '../auth/auth-primitives.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { identifier } from '../../common/validation/identifier.js';
import { roomCommandRate } from '../../infrastructure/rate-limit/room-command-rate.js';
import { AuthService } from '../auth/auth.service.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import type { SessionCredentials, CommandCredentials } from '../auth/auth-context.js';
import type { SendInput } from './dto/send-message.dto.js';
import { MessagesCoreService } from './messages-core.service.js';

@Injectable()
export class MessagesService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(MessagesCoreService) private readonly messages: MessagesCoreService) {}

  async send(credentials: CommandCredentials, roomId: string, input: SendInput) {
    identifier(roomId);
    opaque(credentials.csrf);
    // A failed command must not refund its independently committed rate charge.
    const allowed = await this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return roomCommandRate(tx, this.config.key, actor.userId, roomId, 'send');
    });
    if (!allowed) throw new ApiError('RATE_LIMITED', 429);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return this.messages.send(tx, roomId, actor.userId, input, this.config.key);
    });
  }

  get(credentials: SessionCredentials, roomId: string, messageId: string) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return this.messages.get(tx, roomId, actor.userId, messageId);
    });
  }

  remove(credentials: CommandCredentials, roomId: string, messageId: string) {
    opaque(credentials.csrf);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials);
      return this.messages.remove(tx, roomId, actor.userId, messageId);
    });
  }
}
