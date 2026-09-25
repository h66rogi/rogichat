import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { Transactions } from '../../../infrastructure/database/transactions.js';
import type { Transaction } from '../../../infrastructure/database/transactions.js';
import type { AuthConfig } from '../../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth.tokens.js';
import { AuthService } from '../auth.service.js';
import { SessionService } from '../session.service.js';
import { ApiError } from '../auth-primitives.js';
import { requireCommandProof } from '../auth-context.js';
import type { SessionCredentials } from '../auth-context.js';
import { PasswordRepository } from './password.repository.js';
import { PasswordHasher } from './password-hasher.js';
import type { passwordLogin, passwordChange } from './password.dto.js';

@Injectable()
export class PasswordService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(PasswordRepository) private readonly repository: PasswordRepository,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}
  private async charge(login: string) {
    const key = createHmac('sha256', this.config.key).update('password-login:v1:').update(login).digest();
    if (!await this.transactions.write(tx => this.repository.rate(tx, key))) throw new ApiError('RATE_LIMITED', 429);
  }
  private async issue(tx: Transaction, userId: string, clientId: 'web' | 'ios' | 'android') {
    if (clientId === 'web') return { transport: 'WEB' as const, ...await this.sessions.issue(tx, userId) };
    const issued = await this.sessions.issueNative(tx, userId, clientId);
    return { transport: 'NATIVE' as const, tokenType: 'Bearer' as const, accessToken: issued.token,
      expiresAt: issued.expiresAt, session: await this.sessions.nativeSession(tx, issued.token, clientId) };
  }
  async login(input: ReturnType<typeof passwordLogin>, credentials?: SessionCredentials) {
    if (credentials) requireCommandProof(credentials);
    await this.charge(input.loginId);
    const candidate = await this.transactions.read(tx => this.repository.byLogin(tx, input.loginId));
    const valid = await this.hasher.verify(input.password, candidate?.password_hash);
    if (!valid || !candidate || candidate.disabled_at) throw new ApiError('AUTH_FAILED', 401);
    return this.transactions.write(async tx => {
      // Optional prior session is validated inside this same command, never merged.
      if (credentials) await this.auth.require(tx, credentials);
      const current = await this.repository.lock(tx, candidate.user_id);
      if (!current || current.disabled_at || current.password_hash !== candidate.password_hash || BigInt(current.revision) !== candidate.revision) throw new ApiError('AUTH_FAILED', 401);
      await this.repository.audit(tx, current.user_id, 'PASSWORD_LOGIN');
      return this.issue(tx, current.user_id, input.clientId);
    });
  }
  async change(input: ReturnType<typeof passwordChange>, credentials: SessionCredentials) {
    requireCommandProof(credentials);
    const candidate = await this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials);
      return this.repository.byUser(tx, actor.userId);
    });
    await this.charge(`change:${candidate?.user_id ?? 'absent'}`);
    if (!await this.hasher.verify(input.currentPassword, candidate?.password_hash) || !candidate || candidate.disabled_at) throw new ApiError('AUTH_FAILED', 401);
    const next = await this.hasher.hash(input.newPassword);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials);
      const current = await this.repository.lock(tx, actor.userId);
      if (!current || current.user_id !== candidate.user_id || current.disabled_at || current.password_hash !== candidate.password_hash ||
        !await this.repository.replace(tx, actor.userId, next, candidate.revision)) throw new ApiError('AUTH_FAILED', 401);
      return this.issue(tx, actor.userId, input.clientId);
    });
  }
}
