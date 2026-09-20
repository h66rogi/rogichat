import type { IdentityService } from './identity.service.js';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { LoginRepository } from './login.repository.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { ApiError, digest, opaque, secret, equalDigest } from '../../modules/auth/auth-primitives.js';
import type { SessionService } from './session.service.js';
import type { VerifiedIdentity } from './identity.service.js';
import type { Transactions } from '../../infrastructure/database/transactions.js';

export interface Broker {
  request(input: { transactionId: string; state: string; challenge: string }): Promise<string>;
  exchange(input: { transactionId: string; code: string; verifier: string }): Promise<VerifiedIdentity>;
}
function encrypt(value: string, key: Buffer): Buffer {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}
function decrypt(value: Buffer, key: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
}

export class AuthFlow {
  constructor(private readonly sessions: SessionService, private readonly transactions: Transactions, readonly config: AuthConfig, private readonly broker: Broker, private readonly repository: LoginRepository, private readonly identities: IdentityService) {}
  async start(intent: 'login' | 'link', browser: string, token?: string, csrf?: string): Promise<{ url: string; state: string }> {
    opaque(browser);
    const id = randomUUID(); const state = secret(); const verifier = secret();
    await this.transactions.write(async tx => {
      const principal = intent === 'link' ? await this.sessions.require(tx, token, csrf ?? '') : undefined;
      const bound = principal ? await this.repository.webBinding(tx, principal.sessionId) : undefined;
      if (principal && !bound) throw new ApiError('RECENT_AUTH_REQUIRED', 403);
      if (bound && bound.terms !== '2026-09-20') throw new ApiError('TERMS_REQUIRED', 403);
      await this.repository.insert(tx, { id, stateDigest: digest(state), browserDigest: digest(browser), verifier: encrypt(verifier, this.config.key), intent, audience: this.config.audience, userId: principal?.userId, sessionId: principal?.sessionId, ...(bound ? { boundGeneration: BigInt(bound.generation) } : {}) });
    });
    try {
      return { url: await this.broker.request({ transactionId: id, state, challenge: createHash('sha256').update(verifier).digest('base64url') }), state };
    } catch {
      await this.fail(id);
      throw new ApiError('AUTH_UNAVAILABLE', 503);
    }
  }
  async callback(state: string, code: string, browser: string, token?: string): Promise<{ token: string; csrf: string }> {
    opaque(state); opaque(code); opaque(browser);
    const claim = await this.transactions.write(async tx => {
      const row = await this.repository.pending(tx, digest(state), this.config.audience);
      if (!row || !equalDigest(browser, row.browser_digest)) throw new ApiError('AUTH_FAILED', 400);
      if (row.intent === 'link') {
        const principal = await this.sessions.require(tx, token);
        if (principal.userId !== row.user_id || principal.sessionId !== row.session_id || row.bound_generation === null || (await this.repository.webBinding(tx, principal.sessionId))?.generation !== row.bound_generation) throw new ApiError('AUTH_FAILED', 400);
      }
      await this.repository.claim(tx, row.id);
      return row;
    });
    try {
      const identity = await this.broker.exchange({ transactionId: claim.id, code, verifier: decrypt(claim.verifier, this.config.key) });
      if (identity.schemaVersion !== 1 || identity.provider !== 'soop' || identity.transactionId !== claim.id || identity.clientId !== this.config.broker?.clientId || !Number.isFinite(Date.parse(identity.authenticatedAt)) || Math.abs(Date.now() - Date.parse(identity.authenticatedAt)) > 180000) throw new ApiError('AUTH_FAILED', 400);
      // A concurrent first login can race on unique subject; retry just this final DB transaction.
      for (let attempt = 0; ; attempt++) {
        try {
          return await this.transactions.write(async tx => {
            const active = await this.repository.processing(tx, claim.id);
            if (!active) throw new ApiError('AUTH_FAILED', 400);
            await this.identities.check(tx, identity);
            let linkUser: string | undefined;
            if (claim.intent === 'link') {
              const principal = await this.sessions.require(tx, token);
              if (principal.userId !== claim.user_id || principal.sessionId !== claim.session_id || claim.bound_generation === null || (await this.repository.webBinding(tx, principal.sessionId))?.generation !== claim.bound_generation) throw new ApiError('AUTH_FAILED', 400);
              linkUser = principal.userId;
            }
            const userId = await this.identities.resolve(tx, identity, linkUser);
            if (claim.terms_version) await this.repository.terms(tx, userId, claim.terms_version);
            const session = await this.sessions.issue(tx, userId);
            if (claim.session_id) await this.repository.revokeSession(tx, claim.session_id);
            await this.repository.finish(tx, claim.id, 'SUCCEEDED');
            return session;
          });
        } catch (error) {
          if (attempt > 0 || !this.transactions.rollbackConfirmed(error) || !error || typeof error !== 'object' || !('code' in error) || !['ER_DUP_ENTRY', 'P2002'].includes(String(error.code))) throw error;
        }
      }
    } catch (error) {
      await this.fail(claim.id);
      if (error instanceof ApiError && error.code === 'CONFLICT') throw new ApiError('SOOP_LINK_CONFLICT', 409);
      throw new ApiError('AUTH_FAILED', 400);
    }
  }
  async deny(state: string, browser: string): Promise<void> {
    opaque(state); opaque(browser);
    await this.transactions.write(async tx => {
      const row = await this.repository.pending(tx, digest(state), this.config.audience);
      if (!row || !equalDigest(browser, row.browser_digest)) throw new ApiError('AUTH_FAILED', 400);
      await this.repository.finish(tx, row.id, 'FAILED');
    });
  }
  private async fail(id: string): Promise<void> {
    await this.transactions.write(tx => this.repository.fail(tx, id));
  }
}
