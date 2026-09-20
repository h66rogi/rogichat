import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpException } from '@nestjs/common';

export type ErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'SOOP_LINK_REQUIRED' | 'INVALID_REQUEST' | 'INVALID_CURSOR' | 'AUTH_FAILED' | 'AUTH_UNAVAILABLE' | 'RATE_LIMITED' | 'CONFLICT' | 'NOT_FOUND' |
  'MEMBERSHIP_SCOPE_MISMATCH' | 'TERMS_REQUIRED' | 'RECENT_AUTH_REQUIRED' | 'LINK_SESSION_CHANGED' | 'SOOP_LINK_CONFLICT' | 'NATIVE_CALLBACK_FAILED' |
  'MEDIA_CAPACITY' | 'MEDIA_STATE' | 'MEDIA_UPLOAD_FAILED' | 'INVALID_MEDIA_INTENT' | 'MEDIA_FORBIDDEN' | 'MEDIA_SIGNATURE_MISMATCH' | 'INVALID_MEDIA_METADATA';
export class ApiError extends HttpException {
  constructor(readonly code: ErrorCode, status: number) { super({ error: { code } }, status); }
}
export const digest = (value: string): Buffer => createHash('sha256').update(value).digest();
export const secret = (): string => randomBytes(32).toString('base64url');
export function opaque(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new ApiError('INVALID_REQUEST', 400);
  return value;
}
export function equalDigest(value: string, expected: Buffer): boolean {
  return expected.length === 32 && timingSafeEqual(digest(value), expected);
}
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new ApiError('INVALID_REQUEST', 400);
  return value as Record<string, unknown>;
}

export interface Principal {
  userId: string;
  sessionId: string;
  soopLinked: boolean;
}
