import { contract, object, text, uuid, boolean, integer, nullable, enumeration, array, afterQuery } from '../../common/openapi/schema.js';
const timestamp = { ...text, format: 'date-time' };
const reason = { ...text, minLength: 1, maxLength: 200 };
const grant = { grantId: uuid, roomId: uuid, expiresAt: timestamp, revokedAt: nullable(timestamp) };
export const adminDocs = {
  me: () => contract({ id: 'getOwnCapabilities', summary: '현재 본인 계정 기능 권한', response: object({ chat: boolean, admin: object({ enabled: boolean, manageTestAccess: boolean, manageReviewers: boolean }), password: object({ enabled: boolean }) }) }),
  room: () => contract({ id: 'getRoomCapabilities', summary: '현재 방 기능 권한', params: ['roomId'], response: object({ effectiveRole: enumeration('FAN', 'MEMBER', 'STREAMER'), canSendShared: boolean, canSendToOwner: boolean, canReadFanInbox: boolean, canPublish: boolean, canModerate: boolean, temporaryStreamer: nullable(object({ grantId: uuid, expiresAt: timestamp })) }), description: '현재 입장 중인 방만 조회합니다. 임시 권한은 방·멤버십 기간에 바인딩되며 소유자나 실제 계정 역할을 변경하지 않습니다.' }),
  issue: () => contract({ id: 'issueRoomTestGrant', summary: '본인에게 기간 제한 테스트 스트리머 권한 부여', auth: 'write', params: ['roomId'], status: 201,
    body: object({ requestId: uuid, durationSeconds: { ...integer, minimum: 60, maximum: 3600 }, reason }), response: object(grant), errors: [400, 401, 403, 404, 409], description: '서버의 manageTestAccess 권한과 현재 FAN 방 입장이 필수입니다. 타인을 지정할 수 없습니다. 동일 요청 ID와 내용은 동일 영수증을 반환하며 만료·회수된 권한을 갱신하지 않습니다. 중복 활성 위임은 409입니다.' }),
  list: () => contract({ id: 'listOwnRoomTestGrants', summary: '본인 테스트 권한 발급 이력', params: ['roomId'], query: [afterQuery], response: object({ grants: array(object({ ...grant, createdAt: timestamp })), next: nullable(uuid) }) }),
  revoke: () => contract({ id: 'revokeOwnRoomTestGrant', summary: '본인 테스트 권한 회수', auth: 'write', params: ['roomId', 'grantId'], body: object({ reason }), status: 204, description: '동일 권한 반복 회수는 멱등입니다. 실제 방장·다른 사람 계정이나 소유권은 변경하지 않습니다.' }),
};
