import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { ApiError } from '../auth/auth-primitives.js';
import type { Principal } from '../auth/auth-primitives.js';
import type { NotificationPreferencesDto, PushSubscriptionDto, PushSubscriptionInput } from './notification-contract.js';
import { NotificationsRepository } from './notifications.repository.js';

export interface AuthorizedPushSubscription {
  id: string; userId: string; sessionId: string; audience: string;
  endpoint: string; p256dh: string; auth: string;
  provider?: 'WEB' | 'APNS' | 'FCM'; nativeToken?: Buffer;
  generation: bigint; accountGeneration: bigint; preferenceGeneration: bigint;
}
const MAX_GENERATION = 18446744073709551615n;
function next(value: bigint): bigint {
  if (value >= MAX_GENERATION) throw new ApiError('CONFLICT', 409);
  return value + 1n;
}
@Injectable()
export class NotificationsCoreService {
  constructor(@Inject(NotificationsRepository) private readonly repository: NotificationsRepository) {}
  async preferences(tx: Transaction, userId: string): Promise<NotificationPreferencesDto> {
    const row = await this.repository.preferences(tx, userId);
    return { pushEnabled: row?.push_enabled ?? false, generation: String(row?.generation ?? 1n) };
  }
  async requireNativeEnrollment(tx: Transaction, actor: Principal, audience: string, client: 'ios' | 'android'): Promise<void> {
    const binding = await this.repository.binding(tx, actor.userId, actor.sessionId, client);
    if (!binding || binding.audience !== audience || Number(binding.chat_allowed) !== 1) throw new ApiError('UNAUTHENTICATED', 401);
    await this.repository.lockPreferences(tx, actor.userId);
    const hint = await this.repository.nativeEnrollment(tx, actor.userId, actor.sessionId, audience, client, BigInt(binding.membership_generation));
    const row = hint ? await this.repository.lockSubscription(tx, hint.id) : undefined;
    if (!row || row.user_id !== actor.userId || row.session_id !== actor.sessionId || row.audience !== audience ||
      row.provider !== (client === 'ios' ? 'APNS' : 'FCM') || row.native_client_id !== client || row.revoked_at || !row.native_token ||
      BigInt(row.account_generation) !== BigInt(binding.membership_generation)) throw new ApiError('CONFLICT', 409);
  }
  // The caller must hold fresh account/session authorization on this transaction.
  async setPreferences(tx: Transaction, userId: string, enabled: boolean, expectedGeneration?: string): Promise<NotificationPreferencesDto> {
    const prior = await this.repository.lockPreferences(tx, userId);
    const generation = BigInt(prior?.generation ?? 1);
    if (expectedGeneration !== undefined && expectedGeneration !== String(generation)) throw new ApiError('CONFLICT', 409);
    const changed = Boolean(prior?.push_enabled) !== enabled;
    // An idempotent setting retry must not move updated_at past queued messages
    // and accidentally exclude them from the fanout's preference-age fence.
    if (prior && !changed) return { pushEnabled: enabled, generation: String(generation) };
    const row = await this.repository.savePreferences(tx, userId, enabled, changed ? next(generation) : generation);
    return { pushEnabled: row.push_enabled, generation: String(row.generation) };
  }
  async register(tx: Transaction, actor: Principal, audience: string, input: PushSubscriptionInput): Promise<PushSubscriptionDto> {
    const binding = await this.repository.binding(tx, actor.userId, actor.sessionId);
    if (!binding || binding.audience !== audience) throw new ApiError('UNAUTHENTICATED', 401);
    const endpointDigest = new Uint8Array(createHash('sha256').update(input.endpoint).digest());
    const hint = await this.repository.byEndpoint(tx, endpointDigest);
    const prior = hint ? await this.repository.lockSubscription(tx, hint.id) : undefined;
    if (prior) {
      // Never transfer another account's endpoint, even after logout/revocation.
      if (prior.user_id !== actor.userId || prior.audience !== audience || (prior.provider && prior.provider !== 'WEB')) throw new ApiError('NOT_FOUND', 404);
      // Lost-response retry only observes the exact active current binding. It
      // cannot rotate credentials, rebind sessions or revive a tombstone.
      if (!input.generation && prior.session_id === actor.sessionId && !prior.revoked_at &&
          prior.endpoint === input.endpoint && prior.p256dh === input.keys.p256dh && prior.auth_secret === input.keys.auth &&
          BigInt(prior.account_generation) === BigInt(binding.membership_generation)) return { id: prior.id, generation: String(prior.generation) };
      if (!input.generation || input.generation !== String(prior.generation)) throw new ApiError('CONFLICT', 409);
      const generation = next(BigInt(prior.generation));
      const result = await this.repository.replace(tx, prior.id, actor.userId, BigInt(prior.generation), {
        session_id: actor.sessionId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth_secret: input.keys.auth,
        account_generation: BigInt(binding.membership_generation), generation, revoked_at: null,
      });
      if (result.count !== 1) throw new ApiError('CONFLICT', 409);
      return { id: prior.id, generation: String(generation) };
    }
    if (input.generation) throw new ApiError('CONFLICT', 409);
    try {
      const row = await this.repository.create(tx, { id: randomUUID(), user_id: actor.userId, session_id: actor.sessionId,
        audience, endpoint: input.endpoint, endpoint_digest: endpointDigest, p256dh: input.keys.p256dh, auth_secret: input.keys.auth,
        account_generation: BigInt(binding.membership_generation) });
      return { id: row.id, generation: String(row.generation) };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw new ApiError('CONFLICT', 409);
      throw error;
    }
  }
  async remove(tx: Transaction, actor: Principal, audience: string, id: string, generation: string): Promise<void> {
    const prior = await this.repository.lockSubscription(tx, id);
    if (!prior || prior.user_id !== actor.userId || prior.session_id !== actor.sessionId || prior.audience !== audience || (prior.provider && prior.provider !== 'WEB')) throw new ApiError('NOT_FOUND', 404);
    // The exact original removal may be retried after its 204 was lost.
    if (prior.revoked_at && BigInt(prior.generation) === BigInt(generation) + 1n) return;
    if (String(prior.generation) !== generation) throw new ApiError('CONFLICT', 409);
    if (prior.revoked_at) return;
    const result = await this.repository.replace(tx, id, actor.userId, BigInt(generation), { generation: next(BigInt(generation)), revoked_at: await tx.now() });
    if (result.count !== 1) throw new ApiError('CONFLICT', 409);
  }
  // Internal credential-bearing port; caller must compare intent generations and
  // reauthorize message ACL before I/O. It is never an HTTP projection.
  async authorizeSubscription(tx: Transaction, id: string): Promise<AuthorizedPushSubscription | null> {
    if (!tx.writable) throw new Error('notification_authorization_requires_write_transaction');
    const hint = await this.repository.byId(tx, id);
    if (!hint) return null;
    const provider = hint.provider ?? 'WEB';
    const client = provider === 'APNS' ? 'ios' : provider === 'FCM' ? 'android' : undefined;
    if (client && hint.native_client_id !== client) return null;
    const binding = await this.repository.binding(tx, hint.user_id, hint.session_id, client);
    if (!binding || Number(binding.chat_allowed) !== 1) return null;
    const preference = await this.repository.lockPreferences(tx, hint.user_id);
    const row = await this.repository.lockSubscription(tx, id);
    if (!row || row.user_id !== hint.user_id || row.session_id !== hint.session_id || row.revoked_at ||
        (row.provider ?? 'WEB') !== provider || (client && row.native_client_id !== client) ||
        row.audience !== binding.audience || !preference?.push_enabled || BigInt(row.account_generation) !== BigInt(binding.membership_generation)) return null;
    if (provider === 'WEB' ? !row.endpoint || !row.p256dh || !row.auth_secret : !row.native_token) return null;
    return { id: row.id, userId: row.user_id, sessionId: row.session_id, audience: row.audience,
      endpoint: row.endpoint ?? '', p256dh: row.p256dh ?? '', auth: row.auth_secret ?? '', provider,
      ...(row.native_token ? { nativeToken: row.native_token } : {}), generation: BigInt(row.generation),
      accountGeneration: BigInt(row.account_generation), preferenceGeneration: BigInt(preference.generation) };
  }
  revokeSession(tx: Transaction, sessionId: string): Promise<number> { return this.repository.revokeSession(tx, sessionId); }
  invalidateSubscription(tx: Transaction, id: string, generation: bigint): Promise<number> { return this.repository.invalidate(tx, id, generation); }
  // MESSAGE purge holds the current blocked message/room lock. This port only
  // removes its fanout/delivery jobs and intents, never recipient preferences.
  purgeMessage(tx: Transaction, roomId: string, messageId: string, limit: number): Promise<{ deleted: number; done: boolean }> {
    if (!tx.writable) throw new Error('transaction_not_writable');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('invalid_purge_limit');
    return this.repository.purgeMessage(tx, roomId, messageId, limit);
  }
  purgeAccount(tx: Transaction, userId: string, limit: number): Promise<{ deleted: number; done: boolean }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('invalid_purge_limit');
    return this.repository.purgeAccount(tx, userId, limit);
  }
}
