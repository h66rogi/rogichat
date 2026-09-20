import { afterQuery, array, contract, enumeration, nullable, object, text, uuid } from '../../../common/openapi/schema.js';
const item = object({ id: uuid, label: text, assetId: uuid });
const operatorItem = object({ ...item.properties!, status: enumeration('DRAFT', 'ACTIVE', 'RETIRED', 'REVOKED') });
export const stickerDocs = {
  list: () => contract({ id: 'listStickers', summary: '방에서 사용할 스티커 목록', params: ['roomId'], query: [afterQuery], response: object({ items: array(item), nextCursor: nullable(uuid) }), description: '활성 방 구성원과 스티커 허용 정책이 필요합니다. 발송에는 항목 id를 content.stickerId로 사용합니다.' }),
  register: () => contract({ id: 'registerSticker', summary: '운영자 스티커 등록', auth: 'write', body: object({ assetId: uuid, label: { ...text, minLength: 1, maxLength: 64 } }), status: 201, response: operatorItem, errors: [400, 401, 403, 404, 409, 413, 429], description: 'manage_stickers 권한과 본인의 준비된 STICKER asset이 필요합니다. 최초 DRAFT 상태로 등록하고 명시적으로 활성화합니다.' }),
  changeState: () => contract({ id: 'setStickerState', summary: '운영자 스티커 상태 변경', auth: 'write', params: ['stickerId'], body: object({ status: enumeration('ACTIVE', 'RETIRED', 'REVOKED') }), response: operatorItem, errors: [400, 401, 403, 404, 409, 413], description: 'RETIRED는 신규 발송을 중단합니다. REVOKED는 되돌릴 수 없으며 기존 메시지와 asset 접근도 회수합니다.' }),
};
