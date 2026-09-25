import { scopeToken } from '../../membership-scope/membership-scope.openapi.js';
import { array, boolean, contract, decimal, empty, enumeration, integer, nullable, object, text, uuid } from '../../../common/openapi/schema.js';
import type { Schema } from '../../../common/openapi/schema.js';
export const avatar = nullable(object({ assetId: uuid }));
const textContent = object({ type: enumeration('TEXT'), text: nullable(text) });
const attachment = object({ assetId: uuid, width: integer, height: integer, variant: text });
export const message: Schema = object({
  id: uuid, version: decimal, createdAt: { type: 'string', format: 'date-time' }, audience: enumeration('SHARED', 'PRIVATE'),
  counterpart: nullable(object({ actorId: uuid })),
  allowedActions: { ...object({ reply: boolean, publish: boolean, delete: boolean }), description: '현재 읽기 트랜잭션의 UI 힌트이며 실행 권한이나 성공을 보장하지 않습니다. reply는 PRIVATE 인용 초안입니다. 같은 메시지 version에서도 변할 수 있으며 모든 변경 요청은 재인가합니다.' },
  author: { oneOf: [object({ kind: enumeration('anonymous') }), object({ kind: enumeration('member'), actorId: uuid, nickname: text, avatar })] },
  content: { oneOf: [textContent, object({ type: enumeration('PHOTO', 'VIDEO'), attachments: array(attachment) }),
    object({ type: enumeration('STICKER'), stickerId: uuid, assetId: uuid, width: integer, height: integer })] },
  reactions: object({ counts: array(object({ emoji: text, count: { ...integer, minimum: 1 } })), mine: nullable(text) }),
  quote: nullable(object({ id: uuid, authorName: text, content: object({ type: enumeration('TEXT'), text }) })),
});
const inputContent: Schema = { oneOf: [
  object({ type: enumeration('TEXT'), text: { type: 'string', minLength: 1, maxLength: 4000, description: 'NFC 정규화 후 비공백, 최대 4,000 코드포인트 및 UTF-8 16,384 bytes. NUL 금지.' } }),
  object({ type: enumeration('PHOTO'), assetIds: { ...array(uuid), minItems: 1, maxItems: 4, uniqueItems: true } }),
  object({ type: enumeration('VIDEO'), assetIds: { ...array(uuid), minItems: 1, maxItems: 1, uniqueItems: true } }),
  object({ type: enumeration('STICKER'), stickerId: uuid }),
] };
const commonInput = { membershipScope: scopeToken, clientMessageId: uuid, quoteId: nullable(uuid), content: inputContent };
export const sendRequest: Schema = { oneOf: [
  object({ ...commonInput, intent: enumeration('SHARED') }, ['membershipScope', 'clientMessageId', 'intent', 'content']),
  object({ ...commonInput, intent: enumeration('ROOM_OWNER') }, ['membershipScope', 'clientMessageId', 'intent', 'content']),
  object({ ...commonInput, intent: enumeration('PRIVATE'), recipientActorId: uuid }, ['membershipScope', 'clientMessageId', 'intent', 'recipientActorId', 'content']),
] };
export const sendReceipt: Schema = { oneOf: [
  object({ clientMessageId: uuid, messageId: uuid, status: enumeration('committed'), version: decimal }),
  object({ clientMessageId: uuid, messageId: uuid, status: enumeration('deleted') }),
] };
export const deletionReceipt = object({ requestId: { ...uuid, pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' }, status: enumeration('blocked') });
export const messageDocs = {
  send: () => contract({ id: 'sendMessage', summary: '메시지 발송', auth: 'write', params: ['roomId'], body: sendRequest, response: sendReceipt,
    description: '활성 방 구성원과 SOOP 연동이 필요합니다. 모든 구성원은 SHARED로 전체 채팅에 보냅니다. 새 클라이언트의 PRIVATE는 스트리머가 메시지를 선택해 답장할 때 recipientActorId와 quoteId를 함께 지정합니다. 이전 클라이언트의 PRIVATE/ROOM_OWNER 명령은 호환을 위해 계속 처리합니다. SHARED/ROOM_OWNER에서는 recipientActorId를 생략합니다. membershipScope는 필수이며 현재 입장 기간과 다르면 409 MEMBERSHIP_SCOPE_MISMATCH입니다. 기존 요청의 scope를 바꾸어 재전송하지 않습니다. 같은 clientMessageId와 같은 내용으로 재시도하며 내용이 다르면 409입니다. committed는 DB 저장 완료이며 전달·읽음 ACK가 아닙니다.', errors: [400, 401, 403, 404, 409, 413, 429] }),
  get: () => contract({ id: 'getMessage', summary: '권한에 맞는 메시지 조회', params: ['roomId', 'messageId'], response: message,
    description: '팬은 공유 메시지와 자신에게 허용된 비공개 메시지만 조회합니다. 공개본의 작성자는 anonymous이며 원본 ID와 작성자 식별자를 노출하지 않습니다. 인용과 첨부도 현재 권한을 검사합니다.' }),
  remove: () => contract({ id: 'deleteMessage', summary: '작성자 메시지 삭제 요청', auth: 'write', params: ['roomId', 'messageId'], body: empty, response: deletionReceipt,
    description: '작성자만 요청할 수 있습니다. blocked는 접근 차단 완료이며 물리 삭제 완료가 아닙니다. 연결된 공개본과 첨부 접근도 회수합니다. 외부 삭제 원장 미설정·기록 실패는 503이며 접수 성공으로 응답하지 않습니다.', errors: [400, 401, 403, 404, 413, 429, 503] }),
};
