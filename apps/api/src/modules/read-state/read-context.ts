import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../auth/auth-primitives.js';
import type { ActiveMember } from '../access/access.types.js';

export interface ReadContextBinding { key: Buffer; audience: string; sessionId: string }

// Only a MAC leaves the server, never a base64-encoded internal identity payload.
export function readContext(viewer: ActiveMember, binding: ReadContextBinding): string {
  return createHmac('sha256', binding.key).update('rogichat:own-read-context:v1\0')
    .update(JSON.stringify([binding.audience, binding.sessionId, viewer.user_id, viewer.room_id, viewer.active_period_id]))
    .digest('base64url');
}

export function requireReadContext(value: string, viewer: ActiveMember, binding: ReadContextBinding): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value) || Buffer.from(value, 'base64url').toString('base64url') !== value) {
    throw new ApiError('INVALID_REQUEST', 400);
  }
  if (!timingSafeEqual(Buffer.from(value, 'base64url'), Buffer.from(readContext(viewer, binding), 'base64url'))) {
    throw new ApiError('CONFLICT', 409);
  }
}
