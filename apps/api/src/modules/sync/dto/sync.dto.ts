import { ApiError, object } from '../../auth/auth-primitives.js';
import { identifier } from '../../../common/validation/identifier.js';
export interface SyncInput { deviceId: string; cacheId: string; cursor?: string; limit: number }
export function syncInput(value: unknown): SyncInput {
  const input = object(value, ['deviceId', 'cacheId', 'cursor', 'limit']);
  const limit = input.limit === undefined ? 50 : typeof input.limit === 'string' && /^(?:[1-9][0-9]?|100)$/.test(input.limit) ? Number(input.limit) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (input.cursor !== undefined && (typeof input.cursor !== 'string' || input.cursor.length > 4096))) throw new ApiError('INVALID_REQUEST', 400);
  return { deviceId: identifier(input.deviceId), cacheId: identifier(input.cacheId), limit, ...(typeof input.cursor === 'string' ? { cursor: input.cursor } : {}) };
}
