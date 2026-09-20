import { pushCapabilities } from './notifications-docs.openapi.js';
// Feature fragment; the integrator composes the shared OpenAPI document.
const uuid = { type: 'string', format: 'uuid', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' } as const;
const generation = { type: 'string', pattern: '^[1-9][0-9]{0,19}$', description: 'Canonical positive uint64 decimal, maximum 18446744073709551615.' } as const;
const body = (name: string) => ({ required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${name}` } } } });
const response = (name: string) => ({ description: 'Persisted own state', content: { 'application/json': { schema: { $ref: `#/components/schemas/${name}` } } } });
const errors = { '400': { description: 'INVALID_REQUEST' }, '401': { description: 'UNAUTHENTICATED' }, '403': { description: 'FORBIDDEN' } } as const;
export const notificationsOpenApi = {
  schemas: {
    PushCapabilities: pushCapabilities,
    NotificationPreferences: { type: 'object', additionalProperties: false, required: ['pushEnabled', 'generation'], properties: { pushEnabled: { type: 'boolean' }, generation } },
    NotificationPreferencesInput: { type: 'object', additionalProperties: false, required: ['pushEnabled', 'expectedGeneration'], properties: { pushEnabled: { type: 'boolean' }, expectedGeneration: generation } },
    PushSubscription: { type: 'object', additionalProperties: false, required: ['id', 'generation'], properties: { id: uuid, generation } },
    PushSubscriptionInput: { type: 'object', additionalProperties: false, required: ['endpoint', 'keys'], properties: {
      endpoint: { type: 'string', format: 'uri', maxLength: 2048, description: 'HTTPS Web Push provider endpoint; strict destination policy applies.' }, generation,
      keys: { type: 'object', additionalProperties: false, required: ['p256dh', 'auth'], properties: {
        p256dh: { type: 'string', pattern: '^[A-Za-z0-9_-]{86}[AEIMQUYcgkosw048]$', description: 'Canonical base64url uncompressed P-256 curve point.' },
        auth: { type: 'string', pattern: '^[A-Za-z0-9_-]{21}[AQgw]$', description: 'Canonical base64url 16-byte auth secret.' },
      } },
    } },
    SubscriptionGenerationInput: { type: 'object', additionalProperties: false, required: ['generation'], properties: { generation } },
  },
  paths: {
    '/v1/me/push-capabilities': { get: { operationId: 'getPushCapabilities', description: 'Current session/account, verified SOOP and current terms required. No-store; native or unconfigured Web Push returns available false. Enrollment capability is not enqueue or delivery success.', responses: { '200': response('PushCapabilities'), ...errors, '503': { description: 'AUTH_UNAVAILABLE' } } } },
    '/v1/me/notification-preferences': {
      get: { operationId: 'getNotificationPreferences', description: 'Own persisted account preference; missing state means false, generation 1.', responses: { '200': response('NotificationPreferences'), '400': errors['400'], '401': errors['401'] } },
      put: { operationId: 'putNotificationPreferences', description: 'Change own account preference with current GET generation as expectedGeneration; stale writes return CONFLICT. Changes increment its generation. Native enable and unconfigured Web Push return unavailable; disabling always remains available.', requestBody: body('NotificationPreferencesInput'), responses: { '200': response('NotificationPreferences'), ...errors, '409': { description: 'CONFLICT: stale or exhausted generation' }, '503': { description: 'AUTH_UNAVAILABLE' } } },
    },
    '/v1/me/push-subscriptions': {
      post: { operationId: 'registerWebPushSubscription', description: 'WEB sessions only. New endpoints omit generation; rotations and rebindings require current CAS generation. A generation-free retry returns the exact current active same-session binding without mutation only when endpoint/keys and account generation all match. A new session on the same account may rebind; cross-account endpoints return NOT_FOUND even after revoke. On account switch unsubscribe and obtain a new provider endpoint. Responses never echo endpoint or keys.', requestBody: body('PushSubscriptionInput'), responses: { '201': response('PushSubscription'), ...errors, '404': { description: 'NOT_FOUND' }, '409': { description: 'CONFLICT: missing or stale generation, endpoint creation race' }, '503': { description: 'AUTH_UNAVAILABLE' } } },
    },
    '/v1/me/push-subscriptions/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
      delete: { operationId: 'removeWebPushSubscription', description: 'Only current owning WEB session may revoke. Matching generation is mandatory; first revocation increments it and retains a tombstone to prevent stale registration revival. An exact repeat with the original generation succeeds only while that same-session tombstone is exactly one generation ahead; an active replacement rejects the stale removal.', requestBody: body('SubscriptionGenerationInput'), responses: { '204': { description: 'Revoked; empty response' }, ...errors, '404': { description: 'NOT_FOUND: unknown or different session/account binding' }, '409': { description: 'CONFLICT: stale generation' }, '503': { description: 'AUTH_UNAVAILABLE: native push unavailable' } } },
    },
  },
} as const;
