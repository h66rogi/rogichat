import { contract, nullable, object, uuid } from '../../common/openapi/schema.js';
import type { Schema } from '../../common/openapi/schema.js';

export const readContext: Schema = {
  type: 'string', minLength: 43, maxLength: 43, pattern: '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$',
  description: 'Opaque canonical base64url context bound to the current session, account, room and membership period. Never decode or synthesize it.',
};
export const readStateInput = object({ messageId: uuid, readContext });
export const ownReadState = object({ messageId: nullable(uuid) });
export const ownReadStates = object({ readContext, items: { type: 'array', maxItems: 100, items: object({ messageId: uuid }) } });
export const readStateDocs = {
  get: () => contract({ id: 'getOwnReadState', summary: 'Read own saved display progress', params: ['roomId'], response: ownReadStates,
    description: 'Recent bounded snapshot of at most 100 saved positions, reauthorized and filtered to currently readable message UUIDs in the current membership period. Hidden positions are omitted; omission does not mean unread. No pagination or internal order/stream identifiers are exposed. Returns the opaque readContext required for updates.', errors: [400, 401, 403, 404] }),
  put: () => contract({ id: 'putOwnReadState', summary: 'Report a newly displayed message', auth: 'write', params: ['roomId'], body: readStateInput, response: ownReadState,
    description: 'Report a newly displayed authorized message with the current GET readContext. Same-period progress advances monotonically; a saved message that is now hidden projects messageId null. Stale context returns 409 CONFLICT: discard queued updates, GET a fresh context, then report only newly displayed messages. No internal order/stream identifiers are exposed.', errors: [400, 401, 403, 404, 409] }),
};
