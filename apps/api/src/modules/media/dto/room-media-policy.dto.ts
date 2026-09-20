import { ApiError } from '../../auth/auth-primitives.js';
import { MEDIA_LIMITS } from '../../../common/media/media-policy.js';
export interface RoomMediaPolicy {
  photoEnabled: boolean; videoEnabled: boolean; stickerEnabled: boolean;
  photoMaxBytes: number; videoMaxBytes: number;
}
export const fields = ['photoEnabled', 'videoEnabled', 'stickerEnabled', 'photoMaxBytes', 'videoMaxBytes'] as const;
export function partialPolicy(body: unknown): Partial<RoomMediaPolicy> {
  if (!body || typeof body !== 'object' || Array.isArray(body) || ![Object.prototype, null].includes(Object.getPrototypeOf(body))) throw new ApiError('INVALID_REQUEST', 400);
  const keys = Reflect.ownKeys(body);
  if (!keys.length || keys.some(key => typeof key !== 'string' || !fields.includes(key as typeof fields[number]))) throw new ApiError('INVALID_REQUEST', 400);
  const value = body as Record<string, unknown>;
  for (const key of ['photoEnabled', 'videoEnabled', 'stickerEnabled']) {
    if (Object.hasOwn(value, key) && typeof value[key] !== 'boolean') throw new ApiError('INVALID_REQUEST', 400);
  }
  for (const [key, cap] of [['photoMaxBytes', MEDIA_LIMITS.photoBytes], ['videoMaxBytes', MEDIA_LIMITS.videoBytes]] as const) {
    if (Object.hasOwn(value, key) && (typeof value[key] !== 'number' || !Number.isSafeInteger(value[key]) || value[key] < 1 || value[key] > cap)) throw new ApiError('INVALID_REQUEST', 400);
  }
  return value as Partial<RoomMediaPolicy>;
}
