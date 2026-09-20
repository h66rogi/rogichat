import { afterQuery, array, boolean, contract, empty, enumeration, nullable, object, text, uuid } from '../../common/openapi/schema.js';
import { reportReasons } from './moderation.dto.js';
const timestamp = { ...text, format: 'date-time' };
const receipt = object({ reportId: uuid, status: enumeration('received', 'resolved', 'dismissed'), createdAt: timestamp });
const reset = object({ actorId: uuid, blocked: boolean, resetRequired: { type: 'boolean', enum: [true] } });
const ban = object({ actorId: uuid, banned: boolean, rejoinRequired: boolean });
const errors = [400, 401, 403, 404, 409, 413, 429];
export const moderationDocs = {
  report: () => contract({ id: 'reportMessage', summary: '현재 열람 가능한 메시지 신고', auth: 'write', params: ['roomId', 'messageId'],
    body: object({ idempotencyKey: uuid, reason: enumeration(...reportReasons), detail: { ...text, minLength: 1, maxLength: 1000 } }, ['idempotencyKey', 'reason']), response: receipt, errors,
    description: '실제 저장된 접수증만 반환합니다. 동일 사용자·키·내용은 같은 접수증을 반환하며 다른 내용은 409입니다. 응답 유실 시 GET /v1/report-receipts/:idempotencyKey 로 복구합니다. 메시지 본문은 복사하지 않고 입력한 상세 내용은 24시간 뒤 조회를 차단하고 정리 작업으로 제거하며 메시지·계정 삭제 작업에도 포함합니다.' }),
  receipt: (byKey = false) => contract({ id: byKey ? 'getReportReceiptByKey' : 'getReportReceipt', summary: '내 신고 접수증 조회', params: [byKey ? 'idempotencyKey' : 'reportId'], response: receipt }),
  blockRooms: () => contract({ id: 'listOwnBlockedRooms', summary: '내 차단이 남은 방 복구 목록',
    query: [{ name: 'cursor', required: false, schema: { ...text, maxLength: 2200 }, description: '이전 nextCursor 불투명 토큰. 계정·세션에 바인딩되며 15분 만료됩니다.' }],
    response: object({ rooms: array(object({ roomId: uuid, displayName: nullable(text) })), nextCursor: nullable(text) }),
    description: '현재 계정이 저장한 차단이 있는 방만 반환합니다. 퇴장·새 로그인·다른 기기에서도 첫 페이지부터 복구할 수 있습니다. 현재 방 이름은 기존 공개/참여 정책상 허용될 때만 표시하며 강퇴·비공개·사용 불가는 null입니다. 방 입장·이력·프로필 권한을 부여하지 않습니다. 내부 탐색을 제한하므로 빈 rooms에도 nextCursor가 있을 수 있으며 null까지 계속해야 합니다. INVALID_CURSOR는 처음부터 다시 조회합니다.' }),
  blocks: () => contract({ id: 'listActorBlocks', summary: '내 방별 차단 목록', params: ['roomId'], query: [afterQuery], response: object({ blocks: array(object({ actorId: uuid, blockedAt: timestamp, displayName: nullable(text) })), next: nullable(uuid) }), description: '퇴장 후에도 자신의 차단 actorId를 복구할 수 있습니다. 기존 자신의 차단에 한해 현재 정책상 허용된 활성 대상 닉네임을 displayName으로 반환하며 이용 불가 시 null입니다. 일반 프로필·생일·아바타·다른 팬 신원은 반환하지 않습니다.' }),
  block: (blocked: boolean) => contract({ id: blocked ? 'blockActor' : 'unblockActor', summary: blocked ? '방에서 개인 차단' : '개인 차단 해제', auth: 'write', params: ['roomId', 'actorId'], ...(blocked ? { body: empty } : {}), response: reset, errors,
    description: '개인 차단은 강퇴·삭제와 다릅니다. 차단자 읽기를 필터하고 양방향 직접 전송과 푸시를 막습니다. 공개본에서 익명 작성자를 추적하지 않습니다. 변경 시 A와 manifest generation이 바뀌므로 방 캐시를 비우고 다시 동기화합니다. 해제는 콘텐츠를 복원 가능한 상태로 하며 철회된 멤버십·grant는 복구하지 않습니다.' }),
  bans: () => contract({ id: 'listRoomBans', summary: '방 소유자의 강퇴 복구 목록', params: ['roomId'], query: [afterQuery], response: object({ bans: array(object({ actorId: uuid })), next: nullable(uuid) }), description: '현재 방 소유 스트리머에게만 강퇴된 actorId를 반환합니다. 일반 팬에게 구성원 목록을 제공하지 않습니다.' }),
  ban: (banned: boolean) => contract({ id: banned ? 'banRoomActor' : 'unbanRoomActor', summary: banned ? '방 소유자의 구성원 강퇴' : '방 구성원 강퇴 해제', auth: 'write', params: ['roomId', 'actorId'], ...(banned ? { body: empty } : {}), response: ban, errors,
    description: '현재 방 소유 스트리머만 실행합니다. 강퇴 시 참여 기간과 grant를 닫습니다. 해제 후 명시적으로 재입장해야 하며 예전 기간·grant는 복구되지 않습니다.' }),
  review: () => contract({ id: 'reviewReports', summary: '운영자 신고 접수 검토', query: [afterQuery], response: object({ reports: array(object({ ...receipt.properties, reason: enumeration(...reportReasons), detail: nullable(text) })), next: nullable(uuid) }), description: '현재 manage_users 권한을 확인하고 조회를 감사 기록합니다. 신고 본문 복사·원본 참조·팬 신원은 제공하지 않습니다.' }),
  resolve: () => contract({ id: 'resolveReport', summary: '운영자 신고 처리 기록', auth: 'write', params: ['reportId'], body: object({ status: enumeration('resolved', 'dismissed') }), response: receipt, errors,
    description: '현재 manage_users 권한과 감사 기록을 적용합니다. 처리 상태는 검토 결과 기록이며 메시지 삭제나 사용자 강퇴를 실행하지 않습니다. 운영 담당자 지정은 별도 구성입니다.' }),
};
