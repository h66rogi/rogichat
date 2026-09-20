import { brokerAuthorizeUrl } from './broker-authorize-url.js';
import { ApiError, object } from '../../modules/auth/auth-primitives.js';
import type { VerifiedIdentity } from '../../modules/auth/identity.service.js';
import type { Broker } from './auth-flow.service.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';

// Contract checked against the broker Controller/contract/service, not a guessed OAuth endpoint.
export class HttpBroker implements Broker {
  constructor(private readonly config: AuthConfig) {}
  async request(input: { transactionId: string; state: string; challenge: string }): Promise<string> {
    const result = object(await this.post('requests', { ...this.binding(input.transactionId), return_state: input.state, code_challenge: input.challenge, code_challenge_method: 'S256' }), ['authorize_url', 'expires_in']);
    if (typeof result.authorize_url !== 'string' || result.expires_in !== 600) throw new ApiError('AUTH_UNAVAILABLE', 503);
    return brokerAuthorizeUrl(this.config, result.authorize_url);
  }
  async exchange(input: { transactionId: string; code: string; verifier: string }): Promise<VerifiedIdentity> {
    const response = object(await this.post('exchange', { ...this.binding(input.transactionId), code: input.code, code_verifier: input.verifier }), ['schemaVersion', 'provider', 'subject', 'clientId', 'transactionId', 'authenticatedAt', 'nickname']);
    if (response.schemaVersion !== 1 || response.provider !== 'soop' || typeof response.subject !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(response.subject) || typeof response.clientId !== 'string' || response.clientId !== this.config.broker?.clientId || response.transactionId !== input.transactionId || typeof response.authenticatedAt !== 'string') throw new ApiError('AUTH_FAILED', 400);
    return { schemaVersion: 1, provider: 'soop', subject: response.subject, clientId: response.clientId, transactionId: response.transactionId, authenticatedAt: response.authenticatedAt };
  }
  private binding(transactionId: string) {
    if (!this.config.broker || !['rogi-qa', 'rogi-production'].includes(this.config.audience)) throw new ApiError('AUTH_UNAVAILABLE', 503);
    return { client_id: this.config.broker.clientId, environment: this.config.audience === 'rogi-qa' ? 'qa' : 'prod', redirect_uri: this.config.callback, transaction_id: transactionId };
  }
  private async post(endpoint: 'requests' | 'exchange', body: object): Promise<unknown> {
    const registration = this.config.broker;
    if (!registration) throw new ApiError('AUTH_UNAVAILABLE', 503);
    try {
      const response = await fetch(`${registration.baseUrl}/v1/platform/oauth/rogichat/${endpoint}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Basic ${Buffer.from(`${registration.clientId}:${registration.clientSecret}`).toString('base64')}` },
        body: JSON.stringify(body),
      });
      if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json') || Number(response.headers.get('content-length') ?? 0) > 8192) {
        await response.body?.cancel(); throw new ApiError('AUTH_UNAVAILABLE', 503);
      }
      if (!response.body) throw new ApiError('AUTH_UNAVAILABLE', 503);
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
      try {
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          length += part.value.length;
          if (length > 8192) throw new ApiError('AUTH_UNAVAILABLE', 503);
          chunks.push(part.value);
        }
      } finally { await reader.cancel(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch { throw new ApiError('AUTH_UNAVAILABLE', 503); }
  }
}
