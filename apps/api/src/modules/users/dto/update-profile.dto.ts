import { ApiError, object } from '../../auth/auth-primitives.js';
import { nickname, validBirthday } from '../../access/access.policy.js';
import { uuid } from '../../../common/validation/identifier.js';

export interface UpdateProfileDto {
  nickname?: string;
  birthday?: { month: number; day: number } | null;
  birthdayVisibleToStreamers?: boolean;
  avatarAssetId?: string | null;
}
export function updateProfileInput(value: unknown): UpdateProfileDto {
  const input = object(value, ['nickname', 'birthday', 'birthdayVisibleToStreamers', 'avatarAssetId']);
  if (!Object.keys(input).length) throw new ApiError('INVALID_REQUEST', 400);
  const dto: UpdateProfileDto = {};
  try {
    if ('nickname' in input) dto.nickname = nickname(input.nickname);
    if ('birthday' in input) {
      if (input.birthday === null) dto.birthday = null;
      else { const birthday = object(input.birthday, ['month', 'day']); dto.birthday = validBirthday(birthday.month, birthday.day); }
    }
    if ('birthdayVisibleToStreamers' in input) {
      if (typeof input.birthdayVisibleToStreamers !== 'boolean') throw new Error('invalid_visibility');
      dto.birthdayVisibleToStreamers = input.birthdayVisibleToStreamers;
    }
    if ('avatarAssetId' in input) {
      if (input.avatarAssetId !== null && typeof input.avatarAssetId !== 'string') throw new Error('invalid_avatar');
      dto.avatarAssetId = input.avatarAssetId === null ? null : uuid(input.avatarAssetId);
    }
  } catch { throw new ApiError('INVALID_REQUEST', 400); }
  return dto;
}
