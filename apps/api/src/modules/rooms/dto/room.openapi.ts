import { afterQuery, array, boolean, contract, decimal, empty, enumeration, integer, nullable, object, text, uuid } from '../../../common/openapi/schema.js';
import { MEDIA_LIMITS } from '../../../common/media/media-policy.js';
export const historyPolicy = enumeration('ALL_AVAILABLE', 'SINCE_JOIN');
const mediaPolicyProperties = { photoEnabled: boolean, videoEnabled: boolean, stickerEnabled: boolean,
  photoMaxBytes: { ...integer, minimum: 1, maximum: MEDIA_LIMITS.photoBytes }, videoMaxBytes: { ...integer, minimum: 1, maximum: MEDIA_LIMITS.videoBytes } };
export const roomMediaPolicy = object(mediaPolicyProperties);
export const provisionRoomRequest = object({ name: { ...text, minLength: 1, maxLength: 80 }, mode: enumeration('FAN', 'GROUP'), ownerUserId: uuid, historyPolicy });
const policy = object({ historyPolicy, policyVersion: integer });
export const roomDocs = {
  list: () => contract({ id: 'listRooms', summary: '입장 가능한 방 조회', query: [afterQuery], response: object({ rooms: array(object({ roomId: uuid, name: text, mode: enumeration('FAN', 'GROUP'), joined: boolean, actorId: uuid }, ['roomId', 'name', 'mode', 'joined'])), next: nullable(uuid) }) }),
  provision: () => contract({ id: 'provisionRoom', summary: '운영자 방 등록', auth: 'write', body: provisionRoomRequest, status: 201, response: object({ roomId: uuid, ownerActorId: uuid }), description: 'manage_rooms 권한이 필요합니다. 방 소유자를 명시하며 최초 사용자에게 자동 권한을 주지 않습니다.', errors: [400, 401, 403, 404, 409, 413] }),
  join: () => contract({ id: 'joinRoom', summary: '방 입장', auth: 'write', params: ['roomId'], body: empty, response: object({ actorId: uuid, historyPolicy, policyVersion: integer, visibleFromOrder: decimal }), description: '입장 시 열람 시작점과 과거 기록 정책을 고정합니다. 재입장은 새 입장 기간으로 계산합니다.', errors: [400, 401, 403, 404, 413] }),
  leave: () => contract({ id: 'leaveRoom', summary: '방 퇴장', auth: 'write', params: ['roomId'], body: empty, status: 204, description: '퇴장은 메시지 삭제 요청이 아닙니다. 응답 본문은 없습니다. 방 소유자는 소유권 이전이 필요하면 409를 받습니다.', errors: [400, 401, 403, 404, 409, 413] }),
  policy: () => contract({ id: 'setRoomHistoryPolicy', summary: '방 과거 기록 정책 변경', auth: 'write', params: ['roomId'], body: object({ historyPolicy }), response: policy, description: '방 소유 스트리머 또는 manage_rooms 운영자가 변경합니다. 기존 입장 기간의 열람 시작점을 소급 확대하지 않습니다.', errors: [400, 401, 403, 404, 413] }),
  mediaPolicy: () => contract({ id: 'getRoomMediaPolicy', summary: '방 미디어 정책 조회', params: ['roomId'], response: roomMediaPolicy }),
  updateMediaPolicy: () => contract({ id: 'updateRoomMediaPolicy', summary: '방 미디어 정책 수정', auth: 'write', params: ['roomId'], body: { ...object(mediaPolicyProperties, []), minProperties: 1 }, response: roomMediaPolicy, description: '방 소유 스트리머 또는 manage_rooms 운영자가 변경합니다. 최소 한 개의 필드가 필요합니다.', errors: [400, 401, 403, 404, 413] }),
};
