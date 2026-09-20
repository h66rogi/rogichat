import { ApiError, object } from '../auth/auth-primitives.js';
import { identifier } from '../../common/validation/identifier.js';
export const reportReasons = ['spam', 'harassment', 'sexual', 'violence', 'other'] as const;
export type ReportReason = typeof reportReasons[number];
export function boundedDetail(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length < 1 || [...value].length > 1000 || [...value].some(char => char.codePointAt(0)! < 32 && !['\t', '\n', '\r'].includes(char))) throw new ApiError('INVALID_REQUEST', 400);
  return value;
}
export function reportInput(body: unknown) {
  const input = object(body, ['idempotencyKey', 'reason', 'detail']);
  if (!reportReasons.includes(input.reason as ReportReason)) throw new ApiError('INVALID_REQUEST', 400);
  return { idempotencyKey: identifier(input.idempotencyKey), reason: input.reason as ReportReason, detail: boundedDetail(input.detail) };
}
export function resolutionInput(body: unknown) {
  const input = object(body, ['status']);
  if (input.status !== 'resolved' && input.status !== 'dismissed') throw new ApiError('INVALID_REQUEST', 400);
  return { status: input.status };
}
