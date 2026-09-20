import { contract, object, enumeration, boolean, uuid } from '../../../common/openapi/schema.js';
import type { Schema } from '../../../common/openapi/schema.js';
import { positiveUint64, pushSubscription } from './notifications-docs.openapi.js';
const provider = enumeration('APNS', 'FCM');
const bindingSecret: Schema = { type: 'string', pattern: '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$', description: 'OS secure storage holds an independently random 32-byte installation secret across account changes; never log or put in a URL.' };
export const nativePushResolveInput = object({ installationId: uuid, bindingSecret });
export const nativePushResolveOutput: Schema = object({ binding: { oneOf: [
  { type: 'object', nullable: true, enum: [null] }, object({ id: uuid, generation: positiveUint64, revoked: boolean }),
] } });
export const nativePushRegisterInput: Schema = { oneOf: [
  object({ provider: enumeration('APNS'), token: { type: 'string', pattern: '^(?:[a-f0-9]{2}){16,128}$' }, installationId: uuid, bindingSecret, generation: positiveUint64 }, ['provider', 'token', 'installationId', 'bindingSecret']),
  object({ provider: enumeration('FCM'), token: { type: 'string', pattern: '^[A-Za-z0-9_:.-]{16,4096}$' }, installationId: uuid, bindingSecret, generation: positiveUint64 }, ['provider', 'token', 'installationId', 'bindingSecret']),
] };
export const nativePushRemoveInput = object({ generation: positiveUint64, bindingSecret });
const security = [{ nativeBearer: [], nativeClient: [] }];
const admission = 'Native Bearer and X-Rogi-Client required; Origin, cookies and CSRF headers are forbidden. ios uses APNS; android uses FCM. No token, installation secret or account identifier is echoed. ';
export const nativePushDocs = {
  capabilities: () => contract({ id: 'getNativePushCapabilities', summary: 'Read native push provider availability', security,
    response: object({ available: boolean, provider }), description: admission + 'Current verified SOOP and terms required. Configuration presence is not provider delivery proof.' }),
  register: () => contract({ id: 'registerNativePushSubscription', summary: 'Bind an installation to the current native account', security,
    body: nativePushRegisterInput, response: pushSubscription, status: 201, errors: [400, 401, 403, 404, 409, 429],
    description: admission + 'Persist installation UUID and secret before first request. Initial registration omits generation; exact active same-session/token/account-generation retry is observational. Rotation/rebind requires current generation. Possession of the same installation secret allows explicit cross-account rebind; it increments generation and never transfers preferences or old message intents. Maximum 20 active native bindings per account.' }),
  resolve: () => contract({ id: 'resolveNativePushBinding', summary: 'Recover opaque installation binding state', security,
    body: nativePushResolveInput, response: nativePushResolveOutput,
    description: admission + 'Returns binding null when absent, otherwise id/current generation/revoked only after proving the installation secret. Authenticated account may differ after an explicit account switch; no previous account/session/provider token is returned. On conflict resolve again; never increment or guess a generation locally. Available without provider credentials.' }),
  remove: () => contract({ id: 'removeNativePushSubscription', summary: 'Revoke current native session binding', security, params: ['id'],
    body: nativePushRemoveInput, status: 204, errors: [400, 401, 403, 404, 409],
    description: admission + 'Current owning session and secret plus generation are required. Revocation increments generation and clears encrypted token. Exact lost-ACK retries are accepted only for the same-session revoked next-generation tombstone. A stale logout request cannot revoke a replacement. Resolve after timeout; transport timeout is not successful revocation. Available without provider credentials.' }),
};
