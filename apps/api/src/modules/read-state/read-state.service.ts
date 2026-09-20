import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { AuthService } from '../auth/auth.service.js';
import { requireCommandProof } from '../auth/auth-context.js';
import type { SessionCredentials, CommandCredentials } from '../auth/auth-context.js';
import { ReadStateCoreService } from './read-state-core.service.js';
import type { ReadStateInput } from './dto/read-state.dto.js';

@Injectable()
export class ReadStateService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ReadStateCoreService) private readonly state: ReadStateCoreService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  get(credentials: SessionCredentials, roomId: string) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return this.state.get(tx, roomId, actor.userId, { key: this.config.key, audience: this.config.audience, sessionId: actor.sessionId });
    });
  }

  put(credentials: CommandCredentials, roomId: string, input: ReadStateInput) {
    requireCommandProof(credentials);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return this.state.put(tx, roomId, actor.userId, input, { key: this.config.key, audience: this.config.audience, sessionId: actor.sessionId });
    });
  }
}
