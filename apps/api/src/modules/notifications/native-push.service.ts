import { Inject, Injectable } from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AuthService } from '../auth/auth.service.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { requireCommandProof } from '../auth/auth-context.js';
import type { SessionCredentials, NativeCredentials } from '../auth/auth-context.js';
import { ApiError, object } from '../auth/auth-primitives.js';
import { identifier } from '../../common/validation/identifier.js';
import { subscriptionGeneration } from './notification-contract.js';
import { NativePushRepository } from './native-push.repository.js';
import { NativePushTransport } from './native-push-transport.js';
import { nativeBindingSecret, nativeBindingDigest, nativeTokenDigest, parseNativePush, sealNativeToken } from './native-push-contract.js';
import type { NativeBindingRow } from './native-push.repository.js';

const native = (value: SessionCredentials): NativeCredentials => {
  if (value.transport !== 'NATIVE') throw new ApiError('INVALID_REQUEST', 400);
  requireCommandProof(value); return value;
};
const next = (generation: string) => {
  const value = BigInt(generation); if (value >= 18446744073709551615n) throw new ApiError('CONFLICT', 409); return value + 1n;
};
function prove(row: NativeBindingRow, secret: string, client: string, audience: string) {
  if (!row.binding_digest || row.binding_digest.length !== 32 || !timingSafeEqual(row.binding_digest, nativeBindingDigest(secret)) ||
    row.native_client_id !== client || row.audience !== audience || row.provider !== (client === 'ios' ? 'APNS' : 'FCM')) throw new ApiError('NOT_FOUND', 404);
}
@Injectable()
export class NativePushService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly authConfig: AuthConfig,
    @Inject(NativePushRepository) private readonly repository: NativePushRepository,
    @Inject(NativePushTransport) private readonly transport: NativePushTransport) {}
  capabilities(value: SessionCredentials) {
    const credentials = native(value), provider = credentials.clientId === 'ios' ? 'APNS' as const : 'FCM' as const;
    return this.transactions.read(async tx => {
      await this.auth.requireEnrollmentRead(tx, credentials);
      return { available: this.transport.available(provider), provider };
    });
  }
  async register(value: SessionCredentials, body: unknown) {
    const credentials = native(value), input = parseNativePush(body);
    if (input.provider !== (credentials.clientId === 'ios' ? 'APNS' : 'FCM')) throw new ApiError('INVALID_REQUEST', 400);
    return this.transactions.write(async tx => {
      const actor = await this.auth.requireEnrollment(tx, credentials);
      this.transport.assertAvailable(input.provider);
      const config = this.transport.config!;
      if (config.audience !== this.authConfig.audience) throw new ApiError('AUTH_UNAVAILABLE', 503);
      const binding = await this.repository.session(tx, actor.userId, actor.sessionId, credentials.clientId, config.audience);
      if (!binding) throw new ApiError('UNAUTHENTICATED', 401);
      const hint = await this.repository.hint(tx, input.installationId);
      if (hint && hint.user_id !== actor.userId) await this.repository.lockPreviousAccount(tx, hint.user_id);
      const prior = await this.repository.lock(tx, input.installationId);
      if (prior && prior.user_id !== actor.userId && prior.user_id !== hint?.user_id) throw new ApiError('CONFLICT', 409);
      const endpointDigest = nativeTokenDigest(config.audience, credentials.clientId, input.provider, input.token);
      if (prior) {
        prove(prior, input.bindingSecret, credentials.clientId, config.audience);
        if (!input.generation && prior.user_id === actor.userId && prior.session_id === actor.sessionId && !prior.revoked_at &&
          prior.endpoint_digest.equals(endpointDigest) && prior.account_generation === binding.membership_generation) return { id: prior.id, generation: prior.generation };
        if (input.generation !== prior.generation) throw new ApiError('CONFLICT', 409);
      } else if (input.generation) throw new ApiError('CONFLICT', 409);
      if (await this.repository.count(tx, actor.userId, prior?.id) >= 20) throw new ApiError('RATE_LIMITED', 429);
      const id = prior?.id ?? randomUUID(), generation = prior ? next(prior.generation) : 1n;
      const data = { user_id: actor.userId, session_id: actor.sessionId, audience: config.audience, provider: input.provider,
        native_client_id: credentials.clientId, installation_id: input.installationId, binding_digest: new Uint8Array(nativeBindingDigest(input.bindingSecret)),
        endpoint_digest: new Uint8Array(endpointDigest), native_token: new Uint8Array(sealNativeToken(input.token, config.encryptionKey, `${config.audience}:${id}:${generation}`)),
        account_generation: BigInt(binding.membership_generation), generation, revoked_at: null };
      try {
        if (prior) {
          if ((await this.repository.update(tx, id, BigInt(prior.generation), data)).count !== 1) throw new ApiError('CONFLICT', 409);
        } else await this.repository.create(tx, { id, ...data });
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw new ApiError('CONFLICT', 409);
        throw error;
      }
      return { id, generation: String(generation) };
    });
  }
  resolve(value: SessionCredentials, body: unknown) {
    const credentials = native(value), input = object(body, ['installationId', 'bindingSecret']);
    const installation = identifier(input.installationId), secret = nativeBindingSecret(input.bindingSecret);
    return this.transactions.write(async tx => {
      await this.auth.require(tx, credentials);
      // Opaque registration state only, even after account change. Possession
      // of the independent installation secret is required; no owner is exposed.
      const row = await this.repository.lock(tx, installation);
      if (!row) return { binding: null };
      prove(row, secret, credentials.clientId, this.authConfig.audience);
      return { binding: { id: row.id, generation: row.generation, revoked: row.revoked_at !== null } };
    });
  }
  remove(value: SessionCredentials, id: string, body: unknown) {
    const credentials = native(value), input = object(body, ['generation', 'bindingSecret']);
    identifier(id); const generation = subscriptionGeneration(input.generation), secret = nativeBindingSecret(input.bindingSecret);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials);
      const hint = await this.repository.byId(tx, id);
      if (!hint?.installation_id || hint.user_id !== actor.userId) throw new ApiError('NOT_FOUND', 404);
      const row = await this.repository.lock(tx, hint.installation_id);
      if (!row || row.id !== id || row.user_id !== actor.userId || row.session_id !== actor.sessionId) throw new ApiError('NOT_FOUND', 404);
      prove(row, secret, credentials.clientId, this.authConfig.audience);
      if (row.revoked_at && BigInt(row.generation) === BigInt(generation) + 1n) return;
      if (row.generation !== generation) throw new ApiError('CONFLICT', 409);
      if (row.revoked_at) return;
      if ((await this.repository.update(tx, id, BigInt(generation), { generation: next(generation), revoked_at: await tx.now(), native_token: null })).count !== 1) throw new ApiError('CONFLICT', 409);
    });
  }
}
