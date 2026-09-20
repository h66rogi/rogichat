import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import type { Transaction, Transactions } from '../../infrastructure/database/transactions.js';
import type { Broker } from './auth-flow.service.js';
import { ApiError, digest, equalDigest, opaque, secret } from './auth-primitives.js';
import type { ErrorCode } from './auth-primitives.js';
import type { NativeClientId, NativeCredentials } from './auth-context.js';
import type { IdentityService, VerifiedIdentity } from './identity.service.js';
import type { SessionService } from './session.service.js';
import type { LoginRepository } from './login.repository.js';
import type { NativeAuthRepository, NativeTransaction } from './native-auth.repository.js';

export interface NativeStart {
  clientId: NativeClientId; intent: 'login' | 'link'; codeChallenge: string; returnState: string;
}
export interface NativeExchange { clientId: NativeClientId; transactionId: string; code: string; codeVerifier: string }
const safeErrors: readonly ErrorCode[] = ['TERMS_REQUIRED', 'RECENT_AUTH_REQUIRED', 'LINK_SESSION_CHANGED', 'SOOP_LINK_CONFLICT', 'AUTH_UNAVAILABLE'];
function safeError(error: unknown): ApiError {
  return error instanceof ApiError && safeErrors.includes(error.code) ? error : new ApiError('NATIVE_CALLBACK_FAILED', 400);
}

export class NativeAuthService {
  constructor(private readonly sessions: SessionService, private readonly transactions: Transactions,
    private readonly config: AuthConfig, private readonly broker: Broker, private readonly repository: NativeAuthRepository,
    private readonly identities: IdentityService, private readonly logins: LoginRepository) {}

  private boundary() {
    const production = this.config.audience === 'rogi-production';
    const origin = production ? 'https://rogi.chat' : 'https://qa.rogi.chat';
    const api = production ? 'https://api.rogi.chat' : 'https://api.qa.rogi.chat';
    if (!['rogi-qa', 'rogi-production'].includes(this.config.audience) || this.config.origin !== origin ||
        this.config.callback !== `${api}/v1/auth/soop/callback` || !this.config.broker) throw new ApiError('AUTH_UNAVAILABLE', 503);
    return { api, completion: `${origin}/mobile/auth/complete` };
  }
  private seal(value: unknown, id: string, purpose: string): Uint8Array<ArrayBuffer> {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.config.key, iv);
    cipher.setAAD(Buffer.from(`${this.config.audience}:${id}:${purpose}`));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return new Uint8Array(Buffer.concat([iv, cipher.getAuthTag(), encrypted]));
  }
  private open(value: Uint8Array, id: string, purpose: string): unknown {
    const data = Buffer.from(value); const cipher = createDecipheriv('aes-256-gcm', this.config.key, data.subarray(0, 12));
    cipher.setAAD(Buffer.from(`${this.config.audience}:${id}:${purpose}`)); cipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8')) as unknown;
  }
  private active(row: NativeTransaction | null, now: Date): asserts row is NativeTransaction {
    if (!row || row.channel !== 'NATIVE' || row.audience !== this.config.audience || row.expires_at <= now ||
        !['ios', 'android'].includes(row.client_id ?? '') || !['login', 'link'].includes(row.intent) ||
        !row.app_challenge || !/^[A-Za-z0-9_-]{43}$/.test(row.app_challenge) ||
        !row.return_state || !/^[A-Za-z0-9_-]{43}$/.test(row.return_state) ||
        (row.intent === 'login' ? row.terms_version !== '2026-09-20' : row.terms_version !== null)) throw new ApiError('NATIVE_CALLBACK_FAILED', 400);
  }
  private async binding(tx: Transaction, row: NativeTransaction, credentials?: NativeCredentials, requireBearer = false) {
    if (row.intent !== 'link') {
      if (credentials || row.user_id || row.session_id || row.bound_generation !== null) throw new ApiError('INVALID_REQUEST', 400);
      return;
    }
    if (!row.session_id || !row.user_id || row.bound_generation === null) throw new ApiError('LINK_SESSION_CHANGED', 401);
    if (requireBearer) {
      if (!credentials || credentials.clientId !== row.client_id) throw new ApiError('LINK_SESSION_CHANGED', 401);
      const current = await this.sessions.require(tx, credentials.token, undefined, false, { transport: 'NATIVE', clientId: credentials.clientId })
        .catch(() => { throw new ApiError('LINK_SESSION_CHANGED', 401); });
      if (current.sessionId !== row.session_id || current.userId !== row.user_id) throw new ApiError('LINK_SESSION_CHANGED', 401);
    }
    const current = await this.sessions.nativeBinding(tx, row.session_id, row.client_id as NativeClientId);
    if (current.userId !== row.user_id || current.generation !== row.bound_generation) throw new ApiError('LINK_SESSION_CHANGED', 401);
  }
  async start(input: NativeStart, credentials?: NativeCredentials) {
    const boundary = this.boundary();
    const id = randomUUID(); const state = secret(); const verifier = secret(); const ticket = secret();
    await this.transactions.write(async tx => {
      let userId: string | undefined; let sessionId: string | undefined; let generation: bigint | undefined;
      if (input.intent === 'link') {
        if (!credentials || credentials.clientId !== input.clientId) throw new ApiError('UNAUTHENTICATED', 401);
        const principal = await this.sessions.require(tx, credentials.token, undefined, false, { transport: 'NATIVE', clientId: input.clientId });
        const binding = await this.sessions.nativeBinding(tx, principal.sessionId, input.clientId);
        userId = binding.userId; sessionId = principal.sessionId; generation = binding.generation;
      } else if (credentials) throw new ApiError('INVALID_REQUEST', 400);
      const now = await tx.now();
      await this.repository.create(tx, { id, channel: 'NATIVE', state_digest: new Uint8Array(digest(state)), browser_digest: new Uint8Array(digest(secret())),
        verifier: this.seal(verifier, id, 'verifier'), intent: input.intent, terms_version: input.intent === 'login' ? '2026-09-20' : null,
        audience: this.config.audience, user_id: userId ?? null, session_id: sessionId ?? null, bound_generation: generation ?? null,
        client_id: input.clientId, app_challenge: input.codeChallenge, return_state: input.returnState,
        launch_digest: new Uint8Array(digest(ticket)), expires_at: new Date(now.getTime() + 600000) });
    });
    try {
      const url = await this.broker.request({ transactionId: id, state, challenge: createHash('sha256').update(verifier).digest('base64url') });
      // Defense at this service boundary as well as HttpBroker: never persist an arbitrary redirect.
      const target = new URL(url);
      if (target.origin !== this.config.broker?.baseUrl || target.protocol !== 'https:' || target.username || target.password || target.hash ||
          target.pathname !== '/v1/platform/oauth/rogichat/authorize' || [...target.searchParams.keys()].join(',') !== 'request') throw new ApiError('AUTH_UNAVAILABLE', 503);
      opaque(target.searchParams.get('request'));
      await this.transactions.write(async tx => {
        const row = await this.repository.lock(tx, { id }, this.config.audience); const now = await tx.now();
        this.active(row, now); await this.binding(tx, row);
        await this.repository.update(tx, id, { launch_payload: this.seal({ state, url }, id, 'launch'), launch_expires: new Date(now.getTime() + 60000) });
      });
      return { transactionId: id, authorizeUrl: `${boundary.api}/v1/auth/native/soop/launch?request=${ticket}`, expiresIn: 600 };
    } catch (error) {
      await this.fail(id);
      if (error instanceof ApiError && safeErrors.includes(error.code)) throw error;
      throw new ApiError('AUTH_UNAVAILABLE', 503);
    }
  }
  async launch(ticket: string, browser: string) {
    this.boundary();
    return this.transactions.write(async tx => {
      const row = await this.repository.lock(tx, { launch: digest(ticket) }, this.config.audience); const now = await tx.now();
      this.active(row, now);
      if (row.status !== 'PENDING' || row.launched_at || !row.launch_expires || row.launch_expires <= now || !row.launch_payload) throw new ApiError('NATIVE_CALLBACK_FAILED', 400);
      await this.binding(tx, row);
      const payload = this.open(row.launch_payload, row.id, 'launch') as { state: string; url: string };
      await this.repository.update(tx, row.id, { browser_digest: new Uint8Array(digest(browser)), launched_at: now, launch_payload: null, launch_digest: null });
      return { state: payload.state, url: payload.url };
    });
  }
  async handles(state: string) {
    return await this.transactions.read(tx => this.repository.channel(tx, digest(state), this.config.audience)) === 'NATIVE';
  }
  async callback(state: string, browser: string, code?: string) {
    const boundary = this.boundary();
    const claim = await this.transactions.write(async tx => {
      const row = await this.repository.lock(tx, { state: digest(state) }, this.config.audience); this.active(row, await tx.now());
      if (row.status !== 'PENDING' || !row.launched_at || !equalDigest(browser, Buffer.from(row.browser_digest))) throw new ApiError('NATIVE_CALLBACK_FAILED', 400);
      await this.binding(tx, row);
      await this.repository.update(tx, row.id, { status: code ? 'PROCESSING' : 'FAILED', ...(code ? {} : { verifier: Buffer.alloc(0) }) });
      return row;
    });
    const handoff = (field: 'code' | 'error', value: string) => `${boundary.completion}?${new URLSearchParams({ [field]: value, state: claim.return_state! })}`;
    if (!code) return handoff('error', 'NATIVE_CALLBACK_FAILED');
    try {
      const verifier = this.open(claim.verifier, claim.id, 'verifier');
      if (typeof verifier !== 'string') throw new ApiError('NATIVE_CALLBACK_FAILED', 400);
      const identity = await this.broker.exchange({ transactionId: claim.id, code, verifier });
      if (identity.schemaVersion !== 1 || identity.provider !== 'soop' || identity.transactionId !== claim.id ||
          identity.clientId !== this.config.broker?.clientId || typeof identity.subject !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(identity.subject) ||
          !Number.isFinite(Date.parse(identity.authenticatedAt)) || Math.abs(Date.now() - Date.parse(identity.authenticatedAt)) > 180000) throw new ApiError('NATIVE_CALLBACK_FAILED', 400);
      const completion = secret();
      await this.transactions.write(async tx => {
        const row = await this.repository.lock(tx, { id: claim.id }, this.config.audience); const now = await tx.now(); this.active(row, now);
        if (row.status !== 'PROCESSING' || row.completion_digest) throw new ApiError('NATIVE_CALLBACK_FAILED', 400);
        await this.identities.check(tx, identity);
        await this.binding(tx, row);
        await this.repository.update(tx, row.id, { verifier: Buffer.alloc(0), identity_payload: this.seal(identity, row.id, 'identity'),
          completion_digest: new Uint8Array(digest(completion)), completion_expires: new Date(now.getTime() + 120000) });
      });
      return handoff('code', completion);
    } catch (error) { await this.fail(claim.id); return handoff('error', safeError(error).code); }
  }
  async exchange(input: NativeExchange, credentials?: NativeCredentials) {
    this.boundary();
    // Only confirmed rollback of a unique identity race is retried. Unknown
    // commit acknowledgement is never replayed and no plaintext credential is saved.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.transactions.write(async tx => {
          const row = await this.repository.lock(tx, { id: input.transactionId }, this.config.audience); const now = await tx.now(); this.active(row, now);
          if (row.client_id !== input.clientId || row.status !== 'PROCESSING' || !row.completion_digest ||
              !row.completion_expires || row.completion_expires <= now || !row.identity_payload ||
              !equalDigest(input.code, Buffer.from(row.completion_digest)) ||
              createHash('sha256').update(input.codeVerifier).digest('base64url') !== row.app_challenge) throw new ApiError('NATIVE_CALLBACK_FAILED', 400);
          const identity = this.open(row.identity_payload, row.id, 'identity') as VerifiedIdentity;
          await this.identities.check(tx, identity);
          await this.binding(tx, row, credentials, true);
          let userId: string;
          try { userId = await this.identities.resolve(tx, identity, row.intent === 'link' ? row.user_id! : undefined); }
          catch (error) { if (error instanceof ApiError && error.code === 'CONFLICT') throw new ApiError('SOOP_LINK_CONFLICT', 409); throw error; }
          if (row.intent === 'login' && row.terms_version === '2026-09-20') await this.logins.terms(tx, userId, row.terms_version);
          const issued = await this.sessions.issueNative(tx, userId, input.clientId);
          if (row.session_id) await this.logins.revokeSession(tx, row.session_id);
          const session = await this.sessions.nativeSession(tx, issued.token, input.clientId);
          await this.repository.update(tx, row.id, { status: 'SUCCEEDED', completion_digest: null, identity_payload: null });
          return { tokenType: 'Bearer', accessToken: issued.token, expiresAt: session.expiresAt, session };
        });
      } catch (error) {
        if (attempt === 0 && this.transactions.rollbackConfirmed(error) && error && typeof error === 'object' && 'code' in error && ['ER_DUP_ENTRY', 'P2002'].includes(String(error.code))) continue;
        // Invalid proofs leave the completion usable by its rightful app. If a
        // commit ACK is unknown, the committed row (if any) is already consumed.
        throw safeError(error);
      }
    }
  }
  private fail(id: string) { return this.transactions.write(tx => this.repository.fail(tx, id)); }
}
