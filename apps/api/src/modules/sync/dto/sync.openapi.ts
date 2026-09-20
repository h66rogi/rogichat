import { array, boolean, contract, decimal, enumeration, integer, nullable, object, text, uuid } from '../../../common/openapi/schema.js';
import type { Schema } from '../../../common/openapi/schema.js';
import { message } from '../../messages/dto/message.openapi.js';
import { actorProfile } from '../../users/dto/profile.openapi.js';
const cursor = { ...text, maxLength: 4096, description: '불투명 커서. 세션·기기·캐시·방·권한에 바인딩되므로 해석/다른 용도로 재사용하지 않습니다.' };
const base = { schemaVersion: { ...integer, enum: [1] }, resetRequired: boolean };
const paged = { ...base, generation: nullable(text), complete: boolean, nextCursor: nullable(cursor) };
const query = (mode: 'optional' | 'required' | 'absent') => [
  { name: 'deviceId', required: true, schema: uuid }, { name: 'cacheId', required: true, schema: uuid },
  { name: 'limit', required: false, schema: { ...integer, minimum: 1, maximum: 100, default: 50 } },
  ...(mode === 'absent' ? [] : [{ name: 'cursor', required: mode === 'required', schema: cursor }]),
];
const description = '현재 권한으로 필터링한 데이터만 반환합니다. resetRequired=true이면 기존 커서를 버리고 snapshot/manifest부터 재동기화합니다. 페이지 누락을 삭제로 해석하지 마세요. Socket.IO는 힌트만 제공하므로 재접속·주기적 REST 동기화가 필요합니다.';
const response = (properties: Record<string, Schema>) => object(properties);
export const syncDocs = {
  manifest: () => contract({ id: 'getSyncManifest', summary: '내 방 멤버십 동기화', query: query('optional'), description, response: response({ ...paged, rooms: array(object({ roomId: uuid, name: text, mode: enumeration('FAN', 'GROUP'), actorId: uuid, role: enumeration('FAN', 'MEMBER', 'STREAMER') })) }) }),
  snapshot: () => contract({ id: 'getRoomSnapshot', summary: '방 최신 메시지와 복구 커서 조회', params: ['roomId'], query: query('absent'), description: `${description} snapshot에는 cursor를 보내지 않습니다. nextCursor는 events용, historyCursor는 history용입니다.`, response: response({ ...base, messages: array(message), nextCursor: cursor, historyCursor: nullable(cursor) }) }),
  events: () => contract({ id: 'getRoomEvents', summary: '방 변경분 조회', params: ['roomId'], query: query('required'), description, response: response({ ...base, events: array({ oneOf: [object({ type: enumeration('message.deleted'), messageId: uuid, version: decimal }), object({ type: enumeration('message.upsert'), message })] }), hasMore: boolean, nextCursor: nullable(cursor) }) }),
  history: () => contract({ id: 'getRoomHistory', summary: '방 과거 메시지 페이지 조회', params: ['roomId'], query: query('required'), description, response: response({ ...base, messages: array(message), nextCursor: nullable(cursor) }) }),
  profiles: () => contract({ id: 'syncRoomProfiles', summary: '방 프로필 동기화', params: ['roomId'], query: query('optional'), description: `${description} 생일 필드는 허용된 viewer에게만 포함됩니다.`, response: response({ ...paged, profiles: array(actorProfile) }) }),
};
