import { createHmac } from 'node:crypto';
import { ApiError } from '../auth/auth-primitives.js';

export function membershipScope(key: Buffer, audience: string, userId: string, roomId: string, periodId: string): string {
  return createHmac('sha256', key).update('membership-scope:v1:').update(JSON.stringify([audience, userId, roomId, periodId])).digest('base64url');
}
export function parseMembershipScope(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value) || Buffer.from(value, 'base64url').toString('base64url') !== value) throw new ApiError('INVALID_REQUEST', 400);
  return value;
}
