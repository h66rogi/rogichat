import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { AuthService } from '../auth/auth.service.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import type { CommandCredentials } from '../auth/auth-context.js';
import { consumeRate } from '../../infrastructure/rate-limit/rate-limit.repository.js';
import type { JobLease } from '../../modules/jobs/jobs.policy.js';
import { RealtimeRepository } from './realtime.repository.js';
import type { EventRef } from './realtime.repository.js';
@Injectable()
export class RealtimeService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(RealtimeRepository) private readonly repository: RealtimeRepository) {}
  admit(credentials: CommandCredentials) {
    return this.transactions.write(async tx => {
      const principal = await this.auth.require(tx, credentials, true);
      const key = createHmac('sha256', this.config.key).update(`socket:account:${principal.userId}`).digest();
      if (!await consumeRate(tx, key, 60, 60)) throw new Error('realtime_denied');
      return principal;
    });
  }
  validSessions(ids: string[], refs?: EventRef[], profiles: string[] = []): Promise<Set<string>> {
    if (!ids.length) return Promise.resolve(new Set());
    return this.transactions.read(tx => this.repository.validSessions(tx, ids, this.config.audience, refs, profiles));
  }
  existing(leases: JobLease[]) { return this.transactions.read(tx => this.repository.existing(tx, leases)); }
}
