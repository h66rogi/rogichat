/**
 * M11 Web Push enrollment contract, transcribed from the authoritative backend commit
 * 46bca354c96c4ce972ecf5320f6706e20041d161:
 *   - apps/api/src/modules/notifications/notification-contract.ts (request parsers)
 *   - apps/api/src/modules/notifications/dto/notifications-docs.openapi.ts (schemas)
 *   - apps/api/src/modules/notifications/notifications.controller.ts (routes)
 *
 * Nothing here is inferred. Values the server rejects are rejected locally too, so an
 * enrollment attempt fails with an honest reason instead of a generic 400 from the API.
 */

/** Routes are mounted under the `v1/me` controller; no other push route exists. */
export const PUSH_CAPABILITIES_PATH = '/v1/me/push-capabilities';
export const PUSH_PREFERENCES_PATH = '/v1/me/notification-preferences';
export const PUSH_SUBSCRIPTIONS_PATH = '/v1/me/push-subscriptions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GENERATION = /^[1-9][0-9]{0,19}$/;
const MAX_GENERATION = 18446744073709551615n;
/** Canonical unpadded base64url of the 65-byte uncompressed P-256 point (leading 0x04). */
const P256DH = /^B[A-P][A-Za-z0-9_-]{84}[AEIMQUYcgkosw048]$/;
/** Canonical unpadded base64url of the 16-byte auth secret. */
const AUTH = /^[A-Za-z0-9_-]{21}[AQgw]$/;

export interface PushCapabilitiesUnavailable { available: false }
export interface PushCapabilitiesAvailable { available: true; applicationServerKey: string }
export type PushCapabilities = PushCapabilitiesUnavailable | PushCapabilitiesAvailable;
export interface NotificationPreferences { pushEnabled: boolean; generation: string }
export interface PushSubscriptionKeys { p256dh: string; auth: string }
export interface PushSubscriptionInput { endpoint: string; keys: PushSubscriptionKeys; generation?: string }
export interface PushSubscriptionIdentity { id: string; generation: string }

export function isGeneration(value: unknown): value is string {
  return typeof value === 'string' && GENERATION.test(value) && BigInt(value) <= MAX_GENERATION;
}

export function isSubscriptionId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** The subscription path is built from a validated UUID; an unvalidated id never reaches a URL. */
export function subscriptionPath(id: string): string {
  if (!isSubscriptionId(id)) throw new TypeError('Invalid push subscription id');
  return `${PUSH_SUBSCRIPTIONS_PATH}/${id}`;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const digit = (value: number): string => ALPHABET.charAt(value);

/** Unpadded base64url, written out so service worker and page contexts behave identically. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    out += digit(first >> 2);
    out += digit(((first & 0b11) << 4) | ((second ?? 0) >> 4));
    if (second === undefined) break;
    out += digit(((second & 0b1111) << 2) | ((third ?? 0) >> 6));
    if (third === undefined) break;
    out += digit(third & 0b111111);
  }
  return out;
}

/** Returns null for any non-canonical input: bad charset, impossible length or non-zero padding bits. */
export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (value.length % 4 === 1) return null;
  const bytes = new Uint8Array((value.length * 3) >> 2);
  let accumulator = 0;
  let bits = 0;
  let written = 0;
  for (const character of value) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) return null;
    accumulator = (accumulator << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[written++] = (accumulator >> bits) & 0xff;
    }
  }
  // Leftover bits belong to no byte; canonical encodings leave them zero.
  if (bits > 0 && (accumulator & ((1 << bits) - 1)) !== 0) return null;
  return written === bytes.length ? bytes : null;
}

function canonicalKey(value: unknown, pattern: RegExp, bytes: number): value is string {
  if (typeof value !== 'string' || !pattern.test(value)) return false;
  const decoded = fromBase64Url(value);
  return decoded !== null && decoded.length === bytes && toBase64Url(decoded) === value;
}

export function isApplicationServerKey(value: unknown): value is string {
  return canonicalKey(value, P256DH, 65);
}

export function isAuthSecret(value: unknown): value is string {
  return canonicalKey(value, AUTH, 16);
}

/**
 * Mirrors the server endpoint parser: HTTPS only, no credentials, no fragment, port 443 or
 * default. Syntax validation is not SSRF authorization; the server enforces destination policy.
 */
export function isSubscriptionEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048 || /\s/.test(value)) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash && (!url.port || url.port === '443');
}

function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (required.some(key => !Object.hasOwn(record, key))) return null;
  return keys.every(key => required.includes(key) || optional.includes(key)) ? record : null;
}

/** The success union is exactly `{available:false}` or `{available:true,applicationServerKey}`. */
export function parseCapabilities(value: unknown): PushCapabilities | null {
  const unavailable = fields(value, ['available']);
  if (unavailable && unavailable.available === false) return { available: false };
  const available = fields(value, ['available', 'applicationServerKey']);
  if (available && available.available === true && isApplicationServerKey(available.applicationServerKey)) {
    return { available: true, applicationServerKey: available.applicationServerKey as string };
  }
  return null;
}

export function parsePreferences(value: unknown): NotificationPreferences | null {
  const record = fields(value, ['pushEnabled', 'generation']);
  if (!record || typeof record.pushEnabled !== 'boolean' || !isGeneration(record.generation)) return null;
  return { pushEnabled: record.pushEnabled, generation: record.generation };
}

export function parseSubscriptionIdentity(value: unknown): PushSubscriptionIdentity | null {
  const record = fields(value, ['id', 'generation']);
  if (!record || !isSubscriptionId(record.id) || !isGeneration(record.generation)) return null;
  return { id: record.id, generation: record.generation };
}

/** Serializes the POST body; `generation` is present only for a CAS rotation or rebinding. */
export function subscriptionBody(input: PushSubscriptionInput): Record<string, unknown> {
  if (!isSubscriptionEndpoint(input.endpoint) || !isApplicationServerKey(input.keys.p256dh) || !isAuthSecret(input.keys.auth)) {
    throw new TypeError('Invalid push subscription input');
  }
  const body: Record<string, unknown> = { endpoint: input.endpoint, keys: { p256dh: input.keys.p256dh, auth: input.keys.auth } };
  if (input.generation !== undefined) {
    if (!isGeneration(input.generation)) throw new TypeError('Invalid push subscription generation');
    body.generation = input.generation;
  }
  return body;
}

/** True when two register attempts are the identical initial request a lost response may repeat. */
export function sameInitialRegistration(left: PushSubscriptionInput, right: PushSubscriptionInput): boolean {
  return left.generation === undefined && right.generation === undefined &&
    left.endpoint === right.endpoint && left.keys.p256dh === right.keys.p256dh && left.keys.auth === right.keys.auth;
}
