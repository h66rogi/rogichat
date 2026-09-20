import { applyDecorators } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { contract, enumeration, integer, nullable, object, text, uuid } from '../../../common/openapi/schema.js';
import { MEDIA_CONTENT_TYPES, MEDIA_LIMITS } from '../../../common/media/media-policy.js';
const intent = { oneOf: (['PHOTO', 'VIDEO', 'AVATAR', 'STICKER'] as const).map(kind => object({
  kind: enumeration(kind), contentType: enumeration(...MEDIA_CONTENT_TYPES[kind]),
  byteLength: { ...integer, minimum: 1, maximum: kind === 'VIDEO' ? MEDIA_LIMITS.videoBytes : kind === 'STICKER' ? MEDIA_LIMITS.stickerBytes : MEDIA_LIMITS.photoBytes },
  roomId: ['PHOTO', 'VIDEO'].includes(kind) ? uuid : { ...nullable(uuid), enum: [null] },
}, ['kind', 'contentType', 'byteLength', ...(['PHOTO', 'VIDEO'].includes(kind) ? ['roomId'] : [])])) };
const receipt = (status: string[]) => object({ assetId: uuid, status: enumeration(...status) });
export const mediaDocs = {
  intent: () => contract({ id: 'createUploadIntent', summary: '미디어 업로드 예약', auth: 'write', body: intent, status: 201, response: receipt(['reserved']), errors: [400, 401, 403, 404, 413, 429],
    description: 'PHOTO/VIDEO는 활성 방과 roomId가 필요합니다. AVATAR/STICKER는 roomId를 생략하거나 null로 보내며 STICKER는 운영자 권한이 필요합니다. 예약 후 바이너리 전송과 처리 상태 조회를 진행합니다. 사용자당 동시 예약·일일 용량 및 서비스 전체 용량 제한이 적용됩니다.' }),
  status: () => contract({ id: 'getUploadStatus', summary: '내 미디어 처리 상태 조회', params: ['assetId'], response: receipt(['reserved', 'uploading', 'processing', 'ready', 'deleting', 'deleted']) }),
  upload: () => applyDecorators(contract({ id: 'uploadMediaContent', summary: '예약된 미디어 바이너리 전송', auth: 'write', params: ['assetId'], status: 202, binary: true, body: { type: 'string', format: 'binary' }, response: receipt(['processing']), errors: [400, 401, 403, 404, 409, 413, 429],
    description: '정확한 application/octet-stream만 허용합니다. JSON/multipart, Content-Encoding 및 query는 금지됩니다. 선언·헤더·실제 바이트 수가 일치해야 합니다. 202는 업로드 접수이며 실제 디코딩·검증 완료는 status=ready로 확인합니다.' }),
    ApiHeader({ name: 'Content-Length', required: false, schema: { ...text, pattern: '^[1-9][0-9]{0,8}$' }, description: '보낼 경우 예약한 byteLength와 일치해야 합니다. 생략해도 실제 바이트 수를 검사합니다.' })),
  access: () => contract({ id: 'createMediaAccess', summary: '권한 검사 후 미디어 접근 URL 발급', auth: 'write', params: ['assetId'], body: object({ variant: text, roomId: uuid, messageId: uuid, actorId: uuid, stickerId: uuid }, ['variant']), response: object({ url: { type: 'string', format: 'uri' }, expiresIn: { ...integer, enum: [60] } }), errors: [400, 401, 403, 404, 413, 429],
    description: '60초 GET signed URL을 반환합니다. 첨부는 roomId+messageId, 아바타는 roomId+actorId와 image variant, 스티커는 roomId+stickerId와 image variant(기존 메시지는 messageId 추가)를 사용합니다. 미연결 asset은 소유자만 미리보기할 수 있습니다. 매 발급에 현재 권한을 검사합니다. URL을 로그/영구 저장하지 마세요.' }),
};
