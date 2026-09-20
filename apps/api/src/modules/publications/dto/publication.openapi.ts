import { contract, empty, enumeration, object, uuid } from '../../../common/openapi/schema.js';
const receipt = object({ publicationId: uuid, status: enumeration('preparing', 'published', 'revoked'), messageId: uuid }, ['publicationId', 'status']);
export const publicationDocs = {
  publish: () => contract({ id: 'publishMessage', summary: '스트리머가 메시지 공개본 생성 요청', auth: 'write', params: ['roomId', 'messageId'], body: empty, status: 202, response: receipt,
    description: '방 소유 스트리머 권한이 필요합니다. TEXT 및 PHOTO 원본을 지원하며 VIDEO/STICKER 공개는 아직 지원하지 않습니다. PHOTO는 별도의 비공개 객체를 복사하고 현재 권한·원본 상태를 재검사한 뒤 원자적으로 공개합니다. 202는 처리 접수이며 preparing/published 상태를 조회합니다. 팬의 추가 동의 플래그는 없습니다. 원본 삭제 시 연결 공개본 접근도 회수합니다.', errors: [400, 401, 403, 404, 413, 429] }),
  get: () => contract({ id: 'getPublication', summary: '공개본 처리 상태 조회', params: ['roomId', 'publicationId'], response: receipt, description: '해당 공개 작업을 조회할 수 있는 방 스트리머만 허용합니다. published일 때 messageId를 반환합니다.' }),
};
