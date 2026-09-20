import { array, boolean, contract, decimal, enumeration, integer, nullable, object, text, uuid } from '../../../common/openapi/schema.js';
import { scopeFields } from '../../membership-scope/membership-scope.openapi.js';
import { message } from '../../messages/dto/message.openapi.js';
import { actorProfile } from '../../users/dto/profile.openapi.js';
const cursor = { ...text, maxLength: 4096, description: '불투명 세션·기기·캐시·방·권한 커서.' };
const base = { schemaVersion: { ...integer, enum: [2] }, resetRequired: { type: 'boolean' as const, enum: [false] } };
const reset = { schemaVersion: { ...integer, enum: [2] }, resetRequired: { type: 'boolean' as const, enum: [true] } };
const nil = { ...nullable(text), enum: [null] };
const resetScopes = { membershipScope: nil, authorizationRevision: nil };
const paged = { ...base, generation: text, complete: boolean, nextCursor: nullable(cursor) };
const resetPaged = { ...reset, generation: nil, complete: { type: 'boolean' as const, enum: [false] }, nextCursor: nil };
const empty = { ...array(object({})), maxItems: 0 };
const query = (mode: 'optional' | 'required' | 'absent') => [
  { name: 'deviceId', required: true, schema: uuid }, { name: 'cacheId', required: true, schema: uuid },
  { name: 'limit', required: false, schema: { ...integer, minimum: 1, maximum: 100, default: 50 } },
  ...(mode === 'absent' ? [] : [{ name: 'cursor', required: mode === 'required', schema: cursor }]),
];
const description = '현재 권한 데이터만 반환합니다. resetRequired=true이면 캐시와 커서를 버리고 재동기화합니다. 멤버십은 같은 generation manifest의 complete=true 이후에만 교체합니다. 페이지 누락을 삭제로 해석하지 않습니다.';
export const syncDocs = {
  manifest: () => contract({ id: 'getSyncManifest', summary: '내 방 멤버십 동기화', query: query('optional'), description, response: { oneOf: [object({ ...paged, rooms: array(object({ roomId: uuid, name: text, mode: enumeration('FAN', 'GROUP'), actorId: uuid, role: enumeration('FAN', 'MEMBER', 'STREAMER'), ...scopeFields })) }), object({ ...resetPaged, rooms: empty })] } }),
  snapshot: () => contract({ id: 'getRoomSnapshot', summary: '방 최신 메시지와 복구 커서 조회', params: ['roomId'], query: query('absent'), description: `${description} snapshot에는 cursor를 보내지 않습니다. nextCursor는 events용, historyCursor는 history용입니다.`, response: object({ ...base, ...scopeFields, messages: array(message), nextCursor: cursor, historyCursor: nullable(cursor) }) }),
  events: () => contract({ id: 'getRoomEvents', summary: '방 변경분 조회', params: ['roomId'], query: query('required'), description, response: { oneOf: [object({ ...base, ...scopeFields, events: array({ oneOf: [object({ type: enumeration('message.deleted'), messageId: uuid, version: decimal }), object({ type: enumeration('message.upsert'), message })] }), hasMore: boolean, nextCursor: cursor }), object({ ...reset, ...resetScopes, events: empty, hasMore: { type: 'boolean', enum: [false] }, nextCursor: nil })] } }),
  history: () => contract({ id: 'getRoomHistory', summary: '방 과거 메시지 페이지 조회', params: ['roomId'], query: query('required'), description, response: { oneOf: [object({ ...base, ...scopeFields, messages: array(message), nextCursor: nullable(cursor) }), object({ ...reset, ...resetScopes, messages: empty, nextCursor: nil })] } }),
  profiles: () => contract({ id: 'syncRoomProfiles', summary: '방 프로필 동기화', params: ['roomId'], query: query('optional'), description: `${description} 생일은 허용된 viewer에게만 포함됩니다.`, response: { oneOf: [object({ ...paged, ...scopeFields, profiles: array(actorProfile) }), object({ ...resetPaged, ...resetScopes, profiles: empty })] } }),
};
