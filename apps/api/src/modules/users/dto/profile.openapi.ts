import { afterQuery, array, boolean, contract, enumeration, integer, nullable, object, text, uuid } from '../../../common/openapi/schema.js';
import { avatar } from '../../messages/dto/message.openapi.js';
export const birthday = object({ month: { ...integer, minimum: 1, maximum: 12 }, day: { ...integer, minimum: 1, maximum: 31 } });
export const actorProfile = object({ actorId: uuid, nickname: text, avatar, role: enumeration('FAN', 'MEMBER', 'STREAMER'), birthday }, ['actorId', 'nickname', 'avatar', 'role']);
export const revisedProfile = object({ ...actorProfile.properties!, revision: text }, [...actorProfile.required!, 'revision']);
const self = object({ id: uuid, nickname: text, avatar, birthday: nullable(birthday), birthdayVisibleToStreamers: boolean });
export const updateProfileRequest = { ...object({ nickname: { type: 'string' as const, minLength: 1, maxLength: 40, description: 'NFC 정규화·trim 후 길이 검사. 제어/포맷 문자 금지.' }, birthday: nullable(birthday), birthdayVisibleToStreamers: boolean, avatarAssetId: nullable(uuid) }, []), minProperties: 1 };
export const profileDocs = {
  me: () => contract({ id: 'getSelfProfile', summary: '내 프로필 조회', response: self }),
  update: () => contract({ id: 'updateSelfProfile', summary: '내 프로필 수정', auth: 'write', body: updateProfileRequest, response: self,
    description: '생일은 유효한 월·일이어야 합니다(윤년 2월 29일 허용). null은 삭제입니다. 생일 공개 설정은 참여한 모든 방의 스트리머에게 적용됩니다. 아바타는 본인의 준비된 AVATAR asset만 사용합니다.', errors: [400, 401, 403, 404, 413] }),
  profile: () => contract({ id: 'getActorProfile', summary: '방 참여자 공개 프로필 조회', params: ['roomId', 'actorId'], response: object({ replace: { ...boolean, enum: [true] }, profile: revisedProfile }),
    description: 'viewer별 projection 전체를 교체합니다. 비공개 생일 필드는 null이 아니라 생략됩니다. FAN 방에서 다른 팬의 프로필을 임의 열람할 수 없습니다.' }),
  revisions: () => contract({ id: 'listProfileRevisions', summary: '보이는 프로필 revision 조회', params: ['roomId'], query: [afterQuery],
    response: object({ schemaVersion: { ...integer, enum: [1] }, partial: { ...boolean, enum: [true] }, profiles: array(object({ actorId: uuid, revision: text })), next: nullable(uuid) }),
    description: '방 스트리머 전용 부분 페이지입니다. 목록에 없는 프로필을 삭제된 것으로 판단하지 않습니다. revision은 viewer별 공개 필드 기준입니다.' }),
};
