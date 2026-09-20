import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { Sessions, ApiError, opaque } from '../../auth-core.js';
import type { AuthConfig } from '../../auth-config.js';
import type { Principal } from '../../auth-core.js';
import { AuthFlow } from '../../auth-flow.js';
import { Transactions } from '../../transactions.js';
import type { Transaction } from '../../transactions.js';
import type { SessionCredentials } from './auth-context.js';
import { SessionRepository } from './session.repository.js';
import { AUTH_CONFIG } from './auth.tokens.js';

/** Application boundary. Sessions is a compatibility adapter; AuthFlow repository extraction remains pending.
 * No dependency bag, public transaction accessor, request storage, or guard-result cache.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(Sessions) private readonly sessionStore: Sessions,
    @Inject(AuthFlow) private readonly oauth: AuthFlow,
    @Inject(Transactions) private readonly unitOfWork: Transactions,
    @Inject(SessionRepository) private readonly sessionRepository: SessionRepository,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  require(tx: Transaction, credentials: SessionCredentials, requireSoop = false): Promise<Principal> {
    return this.sessionStore.require(tx, credentials.token, credentials.csrf, requireSoop);
  }

  session(credentials: SessionCredentials) {
    return this.unitOfWork.read(async tx => {
      const principal = await this.require(tx, credentials);
      return { authenticated: true, soopLinkStatus: principal.soopLinked ? 'VERIFIED' : 'REQUIRED', csrfToken: this.csrf(credentials.token!) };
    });
  }

  async logout(credentials: SessionCredentials): Promise<void> {
    const proof = opaque(credentials.csrf);
    await this.unitOfWork.write(async tx => {
      const principal = await this.require(tx, { ...credentials, csrf: proof });
      await this.sessionRepository.revoke(tx, principal.sessionId);
    });
  }

  csrf(token: string): string { return this.sessionStore.csrf(token); }
  async charge(kind: 'start' | 'callback', clientIp: string | undefined): Promise<void> {
    // Only the configured ingress adapter supplies clientIp. Never store or log raw addresses.
    const key = createHmac('sha256', this.config.key).update(`${kind}:${clientIp ?? 'unknown'}`).digest();
    // Independent commit deliberately precedes the OAuth use case: failures do not refund rate.
    const allowed = await this.unitOfWork.write(tx => this.sessionRepository.consumeAuthRate(tx, key, kind === 'start' ? 10 : 30));
    if (!allowed) throw new ApiError('RATE_LIMITED', 429);
  }
  start(intent: 'login' | 'link', browser: string, token?: string, csrf?: string) { return this.oauth.start(intent, browser, token, csrf); }
  callback(state: string, code: string, browser: string, token?: string) { return this.oauth.callback(state, code, browser, token); }
  deny(state: string, browser: string): Promise<void> { return this.oauth.deny(state, browser); }
}
