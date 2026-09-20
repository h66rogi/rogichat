import { array, contract, empty, integer, nullable, object, text } from '../../../common/openapi/schema.js';
const reactions = object({ counts: array(object({ emoji: text, count: { ...integer, minimum: 1 } })), mine: nullable(text) });
const params = ['roomId', 'messageId'];
export const reactionDocs = {
  get: () => contract({ id: 'getReactions', summary: '메시지 반응 집계 조회', params, response: reactions, description: '메시지 열람 권한이 필요하며 반응자 목록은 반환하지 않습니다.' }),
  set: () => contract({ id: 'setMyReaction', summary: '내 반응 설정·교체', auth: 'write', params, body: object({ emoji: { ...nullable(text), minLength: 1, maxLength: 64, description: '서버가 허용한 단일 emoji 시퀀스. 사용자당 메시지별 1개.' } }), response: reactions, errors: [400, 401, 403, 404, 413, 429] }),
  remove: () => contract({ id: 'removeMyReaction', summary: '내 반응 삭제', auth: 'write', params, body: empty, bodyRequired: false, response: reactions, errors: [400, 401, 403, 404, 413, 429] }),
};
