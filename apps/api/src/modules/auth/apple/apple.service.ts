import { createHash, randomUUID } from 'node:crypto';
import type { AuthConfig } from '../../../infrastructure/config/auth-config.js';
import type { Transaction, Transactions } from '../../../infrastructure/database/transactions.js';
import type { SessionCredentials } from '../auth-context.js';
import { requireCommandProof } from '../auth-context.js';
import { ApiError, digest, equalDigest, secret } from '../auth-primitives.js';
import type { SessionService } from '../session.service.js';
import type { LoginRepository } from '../login.repository.js';
import type { IdentityGuardService } from '../identity-guard.service.js';
import type { AppleRepository, AppleTransaction } from './apple.repository.js';
import type { AppleExchangeDto, AppleNativeCompleteDto, AppleStartDto, AppleStartResponse } from './apple.dto.js';
import { AppleGrantRejected, appleGuardSubject } from './apple-provider.js';
import type { AppleProvider, AppleProof } from './apple-provider.js';
import { AppleSeal } from './apple-seal.js';

export class AppleService {
  private readonly seal: AppleSeal;
  constructor(private readonly config: AuthConfig, private readonly transactions: Transactions, private readonly repository: AppleRepository,
    private readonly provider: AppleProvider, private readonly sessions: SessionService, private readonly logins: LoginRepository,
    private readonly guards: IdentityGuardService) { this.seal = new AppleSeal(config.key, config.audience); }
  private active(row: AppleTransaction | null, now: Date): asserts row is AppleTransaction {
    if (!row || row.audience !== this.config.audience || row.expires_at <= now || !['ios', 'android', 'web'].includes(row.client_id) || !['login', 'link'].includes(row.intent)) throw new ApiError('AUTH_FAILED', 400);
  }
  private async principal(tx: Transaction, credentials: SessionCredentials, client: string) {
    requireCommandProof(credentials);
    if (client === 'web') {
      if (credentials.transport === 'NATIVE') throw new ApiError('INVALID_REQUEST', 400);
      return this.sessions.require(tx, credentials.token, credentials.csrf);
    }
    if (credentials.transport !== 'NATIVE' || credentials.clientId !== client) throw new ApiError('INVALID_REQUEST', 400);
    return this.sessions.require(tx, credentials.token, undefined, false, { transport: 'NATIVE', clientId: credentials.clientId });
  }
  private async binding(tx: Transaction, row: AppleTransaction, credentials?: SessionCredentials, requirePossession = false) {
    if (row.intent === 'login') {
      if (row.user_id || row.session_id || row.bound_generation !== null || credentials?.token) throw new ApiError('AUTH_FAILED', 400);
      return;
    }
    if (!row.user_id || !row.session_id || row.bound_generation === null) throw new ApiError('LINK_SESSION_CHANGED', 401);
    if (requirePossession) {
      if (!credentials) throw new ApiError('LINK_SESSION_CHANGED', 401);
      const actor = await this.principal(tx, credentials, row.client_id);
      if (actor.userId !== row.user_id || actor.sessionId !== row.session_id) throw new ApiError('LINK_SESSION_CHANGED', 401);
    }
    const bound = await this.repository.session(tx, row.session_id, this.config.audience, row.client_id);
    if (!bound || bound.user_id !== row.user_id || BigInt(bound.membership_generation) !== row.bound_generation) throw new ApiError('LINK_SESSION_CHANGED', 401);
    if ((await tx.now()).getTime() - bound.created_at.getTime() > 900000) throw new ApiError('RECENT_AUTH_REQUIRED', 403);
  }
  async start(input: AppleStartDto, credentials?: SessionCredentials): Promise<AppleStartResponse> {
    this.provider.configured();
    const id = randomUUID(); const state = secret(); const nonce = secret();
    await this.transactions.write(async tx => {
      let userId: string | null = null; let sessionId: string | null = null; let generation: bigint | null = null;
      if (input.intent === 'link') {
        if (!credentials) throw new ApiError('UNAUTHENTICATED', 401);
        const actor = await this.principal(tx, credentials, input.clientId);
        const bound = await this.repository.session(tx, actor.sessionId, this.config.audience, input.clientId);
        if (!bound) throw new ApiError('LINK_SESSION_CHANGED', 401);
        if ((await tx.now()).getTime() - bound.created_at.getTime() > 900000) throw new ApiError('RECENT_AUTH_REQUIRED', 403);
        userId = actor.userId; sessionId = actor.sessionId; generation = BigInt(bound.membership_generation);
      } else if (credentials?.token) throw new ApiError('INVALID_REQUEST', 400);
      const now = await tx.now();
      await this.repository.create(tx, { id, audience: this.config.audience, client_id: input.clientId, intent: input.intent,
        state_digest: new Uint8Array(digest(state)), nonce, code_challenge: input.codeChallenge, return_state: input.returnState,
        user_id: userId, session_id: sessionId, bound_generation: generation, terms_version: null,
        created_at: now, expires_at: new Date(now.getTime() + 600000) });
    });
    return { transactionId: id, state, nonce, authorizeUrl: input.clientId === 'ios' ? null : this.provider.authorize(input.clientId, state, nonce), expiresIn: 600 };
  }
  async nativeComplete(input: AppleNativeCompleteDto, credentials?: SessionCredentials) {
    const row = await this.claim({ id: input.transactionId }, input.authorizationCode, input.state, input.codeVerifier, credentials);
    if (row.client_id !== 'ios') { await this.fail(row.id); throw new ApiError('AUTH_FAILED', 400); }
    return { code: await this.complete(row, input.authorizationCode, input.identityToken) };
  }
  private async claim(key: { id: string } | { state: Buffer }, code?: string, state?: string, verifier?: string, credentials?: SessionCredentials) {
    this.provider.configured();
    return this.transactions.write(async tx => {
      const row = await this.repository.lock(tx, this.config.audience, key); this.active(row, await tx.now());
      if (row.status !== 'PENDING' || (state !== undefined && !equalDigest(state, Buffer.from(row.state_digest))) ||
        (verifier !== undefined && createHash('sha256').update(verifier).digest('base64url') !== row.code_challenge) ||
        (verifier === undefined && row.client_id === 'ios')) throw new ApiError('AUTH_FAILED', 400);
      await this.binding(tx, row, credentials, verifier !== undefined);
      if (code) await this.repository.prepareCredential(tx, row.id, this.provider.configured().clients[row.client_id as 'ios' | 'android' | 'web'].audience, row.expires_at, row.user_id);
      await this.repository.update(tx, row.id, { status: code ? 'PROCESSING' : 'FAILED', ...(code ? { code_digest: new Uint8Array(digest(code)) } : {}) });
      return row;
    });
  }
  async callback(state: string, code?: string) {
    const row = await this.claim({ state: digest(state) }, code);
    const path = row.client_id === 'web' ? '/auth/apple/complete' : '/mobile/auth/complete';
    const target = `${this.config.origin}${path}`;
    if (!code) return `${target}?${new URLSearchParams({ error: 'AUTH_FAILED', state: row.return_state })}`;
    try { return `${target}?${new URLSearchParams({ code: await this.complete(row, code), state: row.return_state })}`; }
    catch { return `${target}?${new URLSearchParams({ error: 'AUTH_FAILED', state: row.return_state })}`; }
  }
  private async complete(claim: AppleTransaction, code: string, nativeIdentityToken?: string) {
    let proof: AppleProof | undefined;
    try {
      proof = await this.provider.exchange(claim.client_id as 'ios' | 'android' | 'web', code, claim.nonce, claim.created_at, nativeIdentityToken,
        (audience, token) => this.transactions.write(tx => this.repository.saveCredential(tx, { id: claim.id, transactionId: claim.id, audience,
          token: this.seal.seal(token, claim.id, 'refresh'), expires: claim.expires_at })));
      const completion = secret(); const identity = { subject: proof.subject, scope: proof.scope, audience: proof.audience, issuedAt: proof.issuedAt };
      await this.transactions.write(async tx => {
        const row = await this.repository.lock(tx, this.config.audience, { id: claim.id }); const now = await tx.now(); this.active(row, now);
        if (row.status !== 'PROCESSING' || row.completion_digest) throw new ApiError('AUTH_FAILED', 400);
        await this.guards.checkApple(tx, appleGuardSubject(proof!.scope, proof!.subject), this.config.identityGuardKey);
        await this.binding(tx, row);
        await this.repository.update(tx, row.id, { proof: this.seal.seal(identity, row.id, 'proof'), completion_digest: new Uint8Array(digest(completion)), completion_expires: new Date(now.getTime() + 120000) });
      });
      return completion;
    } catch (error) {
      if (error instanceof AppleGrantRejected) await this.transactions.write(tx => this.repository.noToken(tx, claim.id));
      await this.fail(claim.id);
      // If persistence itself failed, try revocation now; a provider outage remains
      // explicit and is never treated as successful identity/session issuance.
      if (proof) await this.provider.revoke(proof.audience, proof.refreshToken).catch(() => undefined);
      throw error;
    }
  }
  async exchange(input: AppleExchangeDto, credentials?: SessionCredentials) {
    this.provider.configured();
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.transactions.write(async tx => {
          const row = await this.repository.lock(tx, this.config.audience, { id: input.transactionId }); const now = await tx.now(); this.active(row, now);
          if (row.client_id !== input.clientId || row.status !== 'PROCESSING' || !row.proof || !row.completion_digest || !row.completion_expires || row.completion_expires <= now ||
            !equalDigest(input.code, Buffer.from(row.completion_digest)) || createHash('sha256').update(input.codeVerifier).digest('base64url') !== row.code_challenge) throw new ApiError('AUTH_FAILED', 400);
          const proof = this.seal.open(row.proof, row.id, 'proof') as Omit<AppleProof, 'refreshToken'>;
          const client = this.provider.configured().clients[input.clientId];
          if (proof.audience !== client.audience || proof.scope !== client.scope) throw new ApiError('AUTH_FAILED', 400);
          await this.guards.checkApple(tx, appleGuardSubject(proof.scope, proof.subject), this.config.identityGuardKey);
          const revokedAt = await this.repository.event(tx, proof.scope, proof.subject);
          if (proof.issuedAt * 1000 <= revokedAt.getTime()) throw new ApiError('AUTH_FAILED', 400);
          const existing = await this.repository.identity(tx, proof.scope, proof.subject);
          await this.binding(tx, row, credentials, true);
          if (row.intent === 'link' && existing && existing.user_id !== row.user_id) throw new ApiError('APPLE_LINK_CONFLICT', 409);
          let userId = existing?.user_id ?? row.user_id;
          if (userId && (await this.repository.account(tx, userId))?.status !== 'ACTIVE') throw new ApiError('AUTH_FAILED', 400);
          if (!userId) { await this.guards.requireRegistration(tx); userId = await this.repository.register(tx); }
          const identityId = await this.repository.connect(tx, existing, userId, proof.scope, proof.subject, new Date(proof.issuedAt * 1000));
          await this.repository.activateCredential(tx, row.id, identityId, userId);
          if (row.session_id) await this.logins.revokeSession(tx, row.session_id);
          await this.repository.update(tx, row.id, { status: 'SUCCEEDED', user_id: userId, proof: null, completion_digest: null });
          if (input.clientId === 'web') return { transport: 'WEB' as const, ...await this.sessions.issue(tx, userId) };
          const issued = await this.sessions.issueNative(tx, userId, input.clientId);
          return { transport: 'NATIVE' as const, tokenType: 'Bearer' as const, accessToken: issued.token, expiresAt: issued.expiresAt, session: await this.sessions.nativeSession(tx, issued.token, input.clientId) };
        });
      } catch (error) {
        if (attempt === 0 && this.transactions.rollbackConfirmed(error) && error && typeof error === 'object' && 'code' in error && ['P2002', 'ER_DUP_ENTRY'].includes(String(error.code))) continue;
        throw error;
      }
    }
  }
  private fail(id: string) { return this.transactions.write(tx => this.repository.fail(tx, id)); }
}
