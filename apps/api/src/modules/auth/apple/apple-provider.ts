import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import type { AppleClient, AppleConfig } from './apple-config.js';
import { ApiError } from '../auth-primitives.js';

export class AppleGrantRejected extends ApiError { constructor() { super('AUTH_FAILED', 400); } }
export const APPLE_ISSUER = 'https://appleid.apple.com';
export interface AppleProof { subject: string; scope: string; audience: string; issuedAt: number; refreshToken: string }
const failed = () => new ApiError('AUTH_FAILED', 400);
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failed();
  return value as Record<string, unknown>;
}
function jwtPart(part: string | undefined): Record<string, unknown> {
  if (!part || !/^[A-Za-z0-9_-]+$/.test(part)) throw failed();
  try { return record(JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))); } catch { throw failed(); }
}
export function providerSubject(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,191}$/.test(value)) throw failed();
  return value;
}
export function appleGuardSubject(scope: string, subject: string): Buffer {
  return Buffer.from(JSON.stringify(['apple', APPLE_ISSUER, scope, subject]));
}

/** Fixed Apple endpoints, bounded bodies/deadlines, no redirects or credential logging. */
export class AppleProvider {
  private keys: { value: (JsonWebKey & { kid: string })[]; until: number } | undefined;
  constructor(readonly config: AppleConfig | undefined, private readonly request: typeof fetch = fetch) {}
  configured(): AppleConfig { if (!this.config) throw new ApiError('AUTH_UNAVAILABLE', 503); return this.config; }
  private async http(path: '/auth/keys' | '/auth/token' | '/auth/revoke', form?: URLSearchParams): Promise<Record<string, unknown>> {
    const signal = AbortSignal.timeout(8000);
    try {
      const response = await this.request(`${APPLE_ISSUER}${path}`, { method: form ? 'POST' : 'GET', redirect: 'error', signal,
        headers: { accept: 'application/json', ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, ...(form ? { body: form.toString() } : {}) });
      if (path === '/auth/token' && response.status === 400) { await response.body?.cancel(); throw new AppleGrantRejected(); }
      if (!response.ok || (Number(response.headers.get('content-length')) || 0) > 65536) { await response.body?.cancel(); throw failed(); }
      const reader = response.body?.getReader(); if (!reader) throw failed();
      const chunks: Uint8Array[] = []; let length = 0;
      try {
        for (;;) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.length; if (length > 65536) throw failed(); chunks.push(chunk.value); }
      } finally { await reader.cancel(); reader.releaseLock(); }
      signal.throwIfAborted();
      if (path === '/auth/revoke' && length === 0) return {};
      return record(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch (error) { if (error instanceof AppleGrantRejected) throw error; throw new ApiError('AUTH_UNAVAILABLE', 503); }
  }
  private clientSecret(audience: string) {
    const config = this.configured(); const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: config.keyId, typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ iss: config.teamId, iat: now, exp: now + 300, aud: APPLE_ISSUER, sub: audience })).toString('base64url');
    return `${header}.${body}.${sign('sha256', Buffer.from(`${header}.${body}`), { key: createPrivateKey(config.privateKey), dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  }
  private async signed(token: string, audience: string, notification = false) {
    if (typeof token !== 'string' || token.length > 16384) throw failed();
    const parts = token.split('.'); if (parts.length !== 3) throw failed();
    const header = jwtPart(parts[0]); const body = jwtPart(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 128 || header.crit !== undefined || !/^[A-Za-z0-9_-]+$/.test(parts[2]!)) throw failed();
    if (!this.keys || this.keys.until <= Date.now()) {
      const result = await this.http('/auth/keys');
      if (!Array.isArray(result.keys) || !result.keys.length || result.keys.length > 16) throw failed();
      const keys = result.keys.map(record).filter(key => key.kty === 'RSA' && key.alg === 'RS256' && key.use === 'sig' && typeof key.kid === 'string' && typeof key.n === 'string' && typeof key.e === 'string');
      this.keys = { value: keys as (JsonWebKey & { kid: string })[], until: Date.now() + 60000 };
    }
    const matches = this.keys.value.filter(key => key.kid === header.kid);
    if (matches.length !== 1) throw failed();
    let valid: boolean;
    try { valid = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: matches[0]!, format: 'jwk' }), Buffer.from(parts[2]!, 'base64url')); } catch { throw failed(); }
    const now = Math.floor(Date.now() / 1000);
    if (!valid || body.iss !== APPLE_ISSUER || body.aud !== audience || typeof body.iat !== 'number' || !Number.isSafeInteger(body.iat) || body.iat > now + 30 ||
      (!notification && (typeof body.exp !== 'number' || !Number.isSafeInteger(body.exp) || body.exp <= now || body.exp <= body.iat)) ||
      (notification && (body.iat < now - 86400 || (body.exp !== undefined && (typeof body.exp !== 'number' || body.exp <= now))))) throw failed();
    return body;
  }
  authorize(client: AppleClient, state: string, nonce: string) {
    const config = this.configured();
    return `${APPLE_ISSUER}/auth/authorize?${new URLSearchParams({ client_id: config.clients[client].audience, redirect_uri: config.callback,
      response_type: 'code', response_mode: 'form_post', scope: 'name email', state, nonce })}`;
  }
  async exchange(client: AppleClient, code: string, nonce: string, startedAt: Date, nativeIdentityToken?: string, persistToken?: (audience: string, token: string) => Promise<void>): Promise<AppleProof> {
    const config = this.configured(); const audience = config.clients[client].audience;
    if (typeof code !== 'string' || code.length < 1 || code.length > 4096 || !/^[!-~]+$/.test(code)) throw failed();
    const value = await this.http('/auth/token', new URLSearchParams({ client_id: audience, client_secret: this.clientSecret(audience), code,
      grant_type: 'authorization_code', ...(client === 'ios' ? {} : { redirect_uri: config.callback }) }));
    if (typeof value.refresh_token !== 'string' || !value.refresh_token.length || value.refresh_token.length > 8192) throw failed();
    // A response from the fixed TLS token endpoint is enough to preserve a revoke
    // obligation, never enough to admit an identity. Persist before JWT validation.
    if (persistToken) await persistToken(audience, value.refresh_token);
    if (typeof value.id_token !== 'string' || value.token_type !== 'Bearer') throw failed();
    const claims = await this.signed(value.id_token, audience);
    if (claims.nonce !== nonce || (claims.iat as number) < Math.floor(startedAt.getTime() / 1000) - 30) throw failed();
    const subject = providerSubject(claims.sub);
    if (client === 'ios') {
      if (!nativeIdentityToken) throw failed();
      const native = await this.signed(nativeIdentityToken, audience);
      if (native.sub !== subject || native.nonce !== nonce || (native.iat as number) < Math.floor(startedAt.getTime() / 1000) - 30) throw failed();
      if (native.c_hash !== undefined && native.c_hash !== createHash('sha256').update(code).digest().subarray(0, 16).toString('base64url')) throw failed();
    }
    return { subject, scope: config.clients[client].scope, audience, issuedAt: claims.iat as number, refreshToken: value.refresh_token };
  }
  async notification(payload: string) {
    // Decode audience only to select a configured verifier, never as authority.
    const audience = jwtPart(payload.split('.')[1]).aud;
    const client = Object.values(this.configured().clients).find(item => item.audience === audience);
    if (!client) throw failed();
    const claims = await this.signed(payload, client.audience, true);
    let events = claims.events;
    if (typeof events === 'string') { try { events = JSON.parse(events); } catch { throw failed(); } }
    const event = record(events); const subject = providerSubject(event.sub);
    if (typeof claims.jti !== 'string' || !claims.jti.length || claims.jti.length > 191 || typeof event.type !== 'string' || !['email-enabled', 'email-disabled', 'consent-revoked', 'account-deleted'].includes(event.type) ||
      typeof event.event_time !== 'number' || !Number.isSafeInteger(event.event_time) || event.event_time > (claims.iat as number) + 30 || event.event_time < 0) throw failed();
    return { id: createHash('sha256').update(JSON.stringify([APPLE_ISSUER, client.audience, claims.jti])).digest(), scope: client.scope, subject,
      type: event.type, eventTime: new Date(event.event_time * 1000) };
  }
  async revoke(audience: string, token: string) {
    if (!Object.values(this.configured().clients).some(client => client.audience === audience)) throw failed();
    await this.http('/auth/revoke', new URLSearchParams({ client_id: audience, client_secret: this.clientSecret(audience), token, token_type_hint: 'refresh_token' }));
  }
}
