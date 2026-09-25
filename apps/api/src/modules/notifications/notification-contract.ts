import { ApiError } from '../auth/auth-primitives.js';
import { identifier } from '../../common/validation/identifier.js';

// Transport data only: wake the client, then authenticated sync projects current ACL.
// Never add room/message/member IDs, fan identity, content, URLs or cursor values.
export const WAKE_ONLY_PUSH = Object.freeze({ type: 'sync_required', version: 1 } as const);
export type WakeOnlyPush = typeof WAKE_ONLY_PUSH;
export interface NotificationPreferencesDto { pushEnabled: boolean; generation: string }
export interface PushSubscriptionDto { id: string; generation: string }
// Resolve stored order back to a currently readable message. No internal offsets/keys.
export interface OwnReadStateDto { messageId: string | null }
export interface OwnReadStatesDto { readContext: string; items: OwnReadStateDto[]; firstUnreadMessageId: string | null }
export interface NotificationPreferencesInput { pushEnabled: boolean; expectedGeneration: string }
export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  generation?: string;
}
export interface SubscriptionGenerationInput { generation: string }
export interface ReadStateInput { messageId: string; readContext: string }

function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST', 400);
  const result = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(result, key)) || Object.keys(result).some(key => !required.includes(key) && !optional.includes(key))) throw new ApiError('INVALID_REQUEST', 400);
  return result;
}

export function subscriptionGeneration(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value) || BigInt(value) > 18446744073709551615n) throw new ApiError('INVALID_REQUEST', 400);
  return value;
}

function key(value: unknown, bytes: number): string {
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new ApiError('INVALID_REQUEST', 400);
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== bytes || decoded.toString('base64url') !== value || (bytes === 65 && decoded[0] !== 4)) throw new ApiError('INVALID_REQUEST', 400);
  return value;
}

export function parseNotificationPreferences(value: unknown): NotificationPreferencesInput {
  const input = object(value, ['pushEnabled', 'expectedGeneration']);
  if (typeof input.pushEnabled !== 'boolean') throw new ApiError('INVALID_REQUEST', 400);
  return { pushEnabled: input.pushEnabled, expectedGeneration: subscriptionGeneration(input.expectedGeneration) };
}

export function parsePushSubscription(value: unknown): PushSubscriptionInput {
  const input = object(value, ['endpoint', 'keys'], ['generation']);
  const keys = object(input.keys, ['p256dh', 'auth']);
  if (typeof input.endpoint !== 'string' || input.endpoint.length > 2048 || /\s/.test(input.endpoint)) throw new ApiError('INVALID_REQUEST', 400);
  let url: URL;
  try { url = new URL(input.endpoint); } catch { throw new ApiError('INVALID_REQUEST', 400); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) throw new ApiError('INVALID_REQUEST', 400);
  // Syntax validation is not SSRF authorization. Registration AND sender must
  // separately enforce provider allowlist/public DNS, pinned destination and no redirects.
  const result: PushSubscriptionInput = { endpoint: url.href, keys: { p256dh: key(keys.p256dh, 65), auth: key(keys.auth, 16) } };
  if (Object.hasOwn(input, 'generation')) result.generation = subscriptionGeneration(input.generation);
  return result;
}

export function parseSubscriptionGeneration(value: unknown): SubscriptionGenerationInput {
  const input = object(value, ['generation']);
  return { generation: subscriptionGeneration(input.generation) };
}

export function parseReadState(value: unknown): ReadStateInput {
  const input = object(value, ['messageId', 'readContext']);
  if (typeof input.readContext !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.readContext) || Buffer.from(input.readContext, 'base64url').toString('base64url') !== input.readContext) throw new ApiError('INVALID_REQUEST', 400);
  return { messageId: identifier(input.messageId), readContext: input.readContext };
}
