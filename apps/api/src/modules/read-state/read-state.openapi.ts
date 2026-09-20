// Feature-local OpenAPI fragment; the integrator owns global document composition.
// Runtime types/parser are re-exported from the schema owner's shared contract.
const identifier = { type: 'string', format: 'uuid', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' } as const;
const message = { ...identifier, nullable: true } as const;
const context = { type: 'string', minLength: 43, maxLength: 43, pattern: '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$',
  description: 'Opaque current-session/account/room/membership-period context. Discard queued updates on CONFLICT and obtain a fresh context before reporting newly displayed messages.' } as const;
const item = { type: 'object', additionalProperties: false, required: ['messageId'], properties: { messageId: message } } as const;
export const readStateOpenApi = {
  schemas: {
    ReadStateInput: { type: 'object', additionalProperties: false, required: ['messageId', 'readContext'],
      properties: { messageId: identifier, readContext: context } },
    OwnReadState: item,
    OwnReadStates: { type: 'object', additionalProperties: false, required: ['readContext', 'items'],
      properties: { readContext: context, items: { type: 'array', maxItems: 100, items: item } } },
  },
  paths: {
    '/v1/rooms/{roomId}/read-state': {
      parameters: [{ name: 'roomId', in: 'path', required: true, schema: identifier }],
      get: { operationId: 'getOwnReadState', description: 'Recent bounded snapshot of at most 100 saved stream positions, reauthorized and filtered to readable message UUIDs. Omission does not mean unread. No pagination.',
        responses: { '200': { description: 'Own current-period display progress and context', content: { 'application/json': { schema: { $ref: '#/components/schemas/OwnReadStates' } } } },
          '400': { description: 'INVALID_REQUEST' }, '401': { description: 'UNAUTHENTICATED' }, '403': { description: 'SOOP_LINK_REQUIRED' }, '404': { description: 'NOT_FOUND' } } },
      put: { operationId: 'putOwnReadState', description: 'Report a newly displayed authorized message; same-period state advances monotonically. A saved message that is now hidden projects null.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ReadStateInput' } } } },
        responses: { '200': { description: 'Currently readable saved position', content: { 'application/json': { schema: { $ref: '#/components/schemas/OwnReadState' } } } },
          '400': { description: 'INVALID_REQUEST' }, '401': { description: 'UNAUTHENTICATED' },
          '403': { description: 'FORBIDDEN or SOOP_LINK_REQUIRED' }, '404': { description: 'NOT_FOUND' }, '409': { description: 'CONFLICT: stale read context' } } },
    },
  },
} as const;
