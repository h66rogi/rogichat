import { boolean, contract, object, uuid } from '../../../common/openapi/schema.js';
import type { Schema } from '../../../common/openapi/schema.js';

// Match decimal strings without converting uint64 values to lossy JS numbers.
const maximum = '18446744073709551615';
const boundedPrefixes = [...maximum].flatMap((digit, index) => {
  const lower = index === 0 ? 1 : 0;
  return Number(digit) > lower ? [`${maximum.slice(0, index)}[${lower}-${Number(digit) - 1}][0-9]{${maximum.length - index - 1}}`] : [];
});
export const positiveUint64: Schema = {
  type: 'string', pattern: `^(?:[1-9][0-9]{0,18}|${boundedPrefixes.join('|')}|${maximum})$`,
  description: 'Canonical positive uint64 decimal string, from 1 through 18446744073709551615.',
};
export const notificationPreferences = object({ pushEnabled: boolean, generation: positiveUint64 });
export const notificationPreferencesInput = object({ pushEnabled: boolean, expectedGeneration: positiveUint64 });
export const pushSubscription = object({ id: uuid, generation: positiveUint64 });
export const pushSubscriptionInput = object({
  endpoint: { type: 'string', format: 'uri', maxLength: 2048, pattern: '^https://[^\\s]+$', description: 'HTTPS endpoint; runtime additionally rejects credentials, fragments and non-443 ports. Provider allowlist, public DNS and pinned destination checks also apply.' },
  keys: object({
    p256dh: { type: 'string', pattern: '^B[A-P][A-Za-z0-9_-]{84}[AEIMQUYcgkosw048]$', description: 'Canonical base64url 65-byte uncompressed P-256 point; registration also validates the curve point.' },
    auth: { type: 'string', pattern: '^[A-Za-z0-9_-]{21}[AQgw]$', description: 'Canonical base64url 16-byte auth secret.' },
  }),
  generation: positiveUint64,
}, ['endpoint', 'keys']);
export const subscriptionGenerationInput = object({ generation: positiveUint64 });

export const pushCapabilities: Schema = { oneOf: [
  object({ available: { type: 'boolean', enum: [false] } }),
  object({ available: { type: 'boolean', enum: [true] }, applicationServerKey: { type: 'string', pattern: '^B[A-P][A-Za-z0-9_-]{84}[AEIMQUYcgkosw048]$' } }),
] };

export const notificationsDocs = {
  capabilities: () => contract({ id: 'getPushCapabilities', summary: 'Read own push enrollment capability', response: pushCapabilities,
    description: 'Authenticated current session/account, verified SOOP and current terms required. WEB with configured Web Push returns only available true and canonical public applicationServerKey; otherwise available false (including native). No-store. Capability is not enqueue, delivery or notification receipt success.', errors: [400, 401, 403] }),
  preferences: () => contract({ id: 'getNotificationPreferences', summary: 'Read own notification preferences', response: notificationPreferences,
    description: 'Own persisted account preference; absent state is pushEnabled false, generation 1. Web and native sessions may read.', errors: [400, 401] }),
  setPreferences: () => contract({ id: 'putNotificationPreferences', summary: 'Change own notification preferences', auth: 'write', body: notificationPreferencesInput, response: notificationPreferences,
    description: 'Supply current GET generation as required expectedGeneration; stale or exhausted generation returns 409 CONFLICT. Changes increment generation. Native enable returns 503 AUTH_UNAVAILABLE, as does web enable when Web Push is unconfigured. Disabling remains available to web and native sessions without Push configuration.', errors: [400, 401, 403, 409] }),
  register: () => contract({ id: 'registerWebPushSubscription', summary: 'Register own Web Push subscription', auth: 'write', body: pushSubscriptionInput, response: pushSubscription, status: 201,
    description: 'Successful registration requires a WEB session and configured Web Push; native or unconfigured Web Push returns 503 AUTH_UNAVAILABLE. New endpoints omit generation; rotations and same-account session rebindings require current generation. A generation-free retry succeeds without mutation only for an exact active same-session endpoint/keys/account-generation match. Cross-account endpoints return 404 NOT_FOUND even after revoke: unsubscribe and obtain a new provider endpoint on account switch. Missing/stale generation or endpoint creation race returns 409 CONFLICT. Response never echoes endpoint or keys.', errors: [400, 401, 403, 404, 409] }),
  remove: () => contract({ id: 'removeWebPushSubscription', summary: 'Revoke own Web Push subscription', auth: 'write', params: ['id'], body: subscriptionGenerationInput, status: 204,
    description: 'Only the current owning WEB session may revoke with matching generation; another session/account or unknown binding returns 404 NOT_FOUND. Native returns 503 AUTH_UNAVAILABLE. Web revocation remains available without Web Push configuration. First revocation increments generation and retains a tombstone. An exact retry with the original generation succeeds only while the same-session tombstone is exactly one generation ahead; an active replacement or stale generation returns 409 CONFLICT.', errors: [400, 401, 403, 404, 409] }),
};
