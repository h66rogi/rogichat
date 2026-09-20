import { contract, decimal, enumeration, object, uuid } from '../../../common/openapi/schema.js';
export const messageCommandReceipt = { oneOf: [
  object({ clientMessageId: uuid, status: enumeration('committed'), messageId: uuid, version: decimal }),
  object({ clientMessageId: uuid, status: enumeration('deleted') }),
] };
export const messageCommandDocs = {
  get: () => contract({ id: 'getOwnMessageCommand', summary: '본인 발송 명령의 영속 처리 결과 조회',
    params: ['roomId', 'clientMessageId'], response: messageCommandReceipt, errors: [400, 401, 403, 404],
    description: '활성 방 구성원·SOOP 연동과 현재 메시지 열람 권한을 같은 조회 트랜잭션에서 확인합니다. 다른 발신자의 명령은 조회할 수 없습니다. committed의 version은 현재 열람 가능한 메시지 버전이며 전달·읽음 확인이 아닙니다. deleted는 본인의 영속 삭제 기록이며 messageId·본문을 포함하지 않는 최종 상태입니다. 퇴장·닫힌 방·없는 명령·열람 불가 상태는 모두 404입니다. 재입장은 새 입장 정책에 따라 조회 권한을 다시 판단하며 예전 grant를 복원하지 않습니다. 404는 미저장 증명이나 새 명령 ID 발급 허가가 아닙니다. 재시도 가능 여부를 다시 확인한 뒤 기존 ID와 동일한 본문으로 발송 API를 사용해야 합니다. 계정·세션·참여 상태 변경 후 도착한 오래된 응답은 클라이언트가 버려야 합니다.' }),
};
