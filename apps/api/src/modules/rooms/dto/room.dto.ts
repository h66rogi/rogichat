import { ApiError, object } from '../../auth/auth-primitives.js';
import { identifier } from '../../../common/validation/identifier.js';
export type HistoryPolicy = 'ALL_AVAILABLE' | 'SINCE_JOIN';
export function historyPolicy(value: unknown): HistoryPolicy {
  if (value !== 'ALL_AVAILABLE' && value !== 'SINCE_JOIN') throw new ApiError('INVALID_REQUEST', 400);
  return value;
}
export interface ProvisionRoomDto { name: string; mode: 'FAN' | 'GROUP'; ownerUserId: string; historyPolicy: HistoryPolicy }
export function provisionRoomInput(body: unknown): ProvisionRoomDto {
  const input = object(body, ['name', 'mode', 'ownerUserId', 'historyPolicy']);
  if (typeof input.name !== 'string') throw new ApiError('INVALID_REQUEST', 400);
  const name = input.name.normalize('NFC').trim();
  if (![...name].length || [...name].length > 80 || /[\p{Cc}\p{Cf}]/u.test(name) || (input.mode !== 'FAN' && input.mode !== 'GROUP')) throw new ApiError('INVALID_REQUEST', 400);
  return { name, mode: input.mode, ownerUserId: identifier(input.ownerUserId), historyPolicy: historyPolicy(input.historyPolicy) };
}
export function historyPolicyInput(body: unknown): HistoryPolicy { return historyPolicy(object(body, ['historyPolicy']).historyPolicy); }
