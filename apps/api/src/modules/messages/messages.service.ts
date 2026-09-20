import { authorizationKey } from '../../infrastructure/config/authorization-epoch.js';
import { DeletionLedger, DeletionLedgerError } from '../deletion/deletion-ledger.js';
import { DeletionApplyService } from '../deletion/deletion-apply.service.js';
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { ApiError } from '../auth/auth-primitives.js';
import { requireCommandProof } from '../auth/auth-context.js';
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
    @Inject(MessagesCoreService) private readonly messages: MessagesCoreService,
    @Inject(DeletionLedger) private readonly ledger: DeletionLedger | null,
    @Inject(DeletionApplyService) private readonly deletion: DeletionApplyService) {}

  async send(credentials: CommandCredentials, roomId: string, input: SendInput) {
    identifier(roomId);
    requireCommandProof(credentials);
    // A failed command must not refund its independently committed rate charge.
    const allowed = await this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return roomCommandRate(tx, this.config.key, actor.userId, roomId, 'send');
    });
    if (!allowed) throw new ApiError('RATE_LIMITED', 429);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return this.messages.send(tx, roomId, actor.userId, input, authorizationKey(this.config), this.config.audience);
    });
  }

  get(credentials: SessionCredentials, roomId: string, messageId: string) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return this.messages.get(tx, roomId, actor.userId, messageId);
    });
  }

  async remove(credentials: CommandCredentials, roomId: string, messageId: string) {
    requireCommandProof(credentials);
    const intent = await this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials);
      if (!this.ledger) throw new ServiceUnavailableException();
      return this.messages.authorizeDeletion(tx, roomId, actor.userId, messageId, this.ledger.environment);
    });
    try {
      const receipt = await this.ledger!.ensureIntent(intent);
      const result = await this.deletion.apply(receipt);
      if (result.status !== 'blocked') throw new ServiceUnavailableException();
      return result;
    } catch (error) {
      if (error instanceof DeletionLedgerError) throw new ServiceUnavailableException();
      throw error;
    }
  }
}
