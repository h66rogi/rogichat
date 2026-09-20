import { ApiError } from '../../modules/auth/auth-primitives.js';

export function uuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new Error('invalid_uuid');
  return value;
}
export function identifier(value: unknown): string {
  try { if (typeof value !== 'string') throw new Error(); return uuid(value); }
  catch { throw new ApiError('INVALID_REQUEST', 400); }
}
