import { ApiError, object } from '../auth/auth-primitives.js';
import { identifier } from '../../common/validation/identifier.js';
export function grantReason(value: unknown) {
  if (typeof value !== 'string' || value.trim().length < 1 || [...value].length > 200 || [...value].some(char => char.codePointAt(0)! < 32 || char.codePointAt(0) === 127)) throw new ApiError('INVALID_REQUEST', 400);
  return value;
}
export function issueGrant(value: unknown) {
  const input = object(value, ['requestId', 'durationSeconds', 'reason']);
  if (!Number.isInteger(input.durationSeconds) || Number(input.durationSeconds) < 60 || Number(input.durationSeconds) > 3600) throw new ApiError('INVALID_REQUEST', 400);
  return { requestId: identifier(input.requestId), durationSeconds: Number(input.durationSeconds), reason: grantReason(input.reason) };
}
export function revokeGrant(value: unknown) { return grantReason(object(value, ['reason']).reason); }
