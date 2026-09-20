import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { ApiError } from './auth-primitives.js';
import { SessionService } from './session.service.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import type { Principal } from '../../modules/auth/auth-primitives.js';
import { AuthFlow } from './auth-flow.service.js';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { SessionCredentials } from './auth-context.js';
import { requireCommandProof } from './auth-context.js';
import { SessionRepository } from './session.repository.js';
import { AUTH_CONFIG } from './auth.tokens.js';

/** Application boundary for session and OAuth use cases.
 * No dependency bag, public transaction accessor, request storage, or guard-result cache.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(SessionService) private readonly sessionStore: SessionService,
    @Inject(AuthFlow) private readonly oauth: AuthFlow,
    @Inject(Transactions) private readonly unitOfWork: Transactions,
    @Inject(SessionRepository) private readonly sessionRepository: SessionRepository,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  require(tx: Transaction, credentials: SessionCredentials, requireSoop = false): Promise<Principal> {
    if (credentials.transport === 'NATIVE') {
      requireCommandProof(credentials);
      return this.sessionStore.require(tx, credentials.token, undefined, requireSoop, { transport: 'NATIVE', clientId: credentials.clientId });
    }
    return this.sessionStore.require(tx, credentials.token, credentials.csrf, requireSoop);
  }

  async requireEnrollmentRead(tx: Transaction, credentials: SessionCredentials): Promise<void> {
    if (tx.writable) throw new Error('enrollment_requires_read_snapshot');
    await this.requireEnrollment(tx, credentials);
  }

  async requireEnrollment(tx: Transaction, credentials: SessionCredentials): Promise<Principal> {
    const actor = await this.require(tx, credentials, true);
    const account = await this.sessionRepository.currentTerms(tx, actor.userId);
    if (account?.terms_version !== '2026-09-20') throw new ApiError('TERMS_REQUIRED', 403);
    return actor;
  }

  session(credentials: SessionCredentials) {
    return this.unitOfWork.read(async tx => {
      const principal = await this.require(tx, credentials);
      if (credentials.transport === 'NATIVE') {
        return this.sessionStore.nativeSession(tx, credentials.token, credentials.clientId);
      }
      return { authenticated: true, soopLinkStatus: principal.soopLinked ? 'VERIFIED' : 'REQUIRED',
        onboardingState: principal.chatEnabled ? 'READY' : 'SOOP_LINK_REQUIRED', capabilities: { chat: principal.chatEnabled }, csrfToken: this.csrf(credentials.token!),
        accountPartition: this.sessionStore.accountPartition(principal.userId) };
    });
  }

  async logout(credentials: SessionCredentials): Promise<void> {
    requireCommandProof(credentials);
    await this.unitOfWork.write(async tx => {
      const principal = await this.require(tx, credentials);
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
