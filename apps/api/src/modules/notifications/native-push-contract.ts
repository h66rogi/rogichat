import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ApiError, object } from '../auth/auth-primitives.js';
import { identifier } from '../../common/validation/identifier.js';
import { parseSubscriptionGeneration } from './notification-contract.js';
export type NativePushProvider = 'APNS' | 'FCM';
export interface NativePushInput { provider: NativePushProvider; token: string; installationId: string; bindingSecret: string; generation?: string }
export function nativeBindingSecret(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value) || Buffer.from(value, 'base64url').toString('base64url') !== value) throw new ApiError('INVALID_REQUEST', 400);
  return value;
}
export function nativeDeviceToken(provider: NativePushProvider, value: unknown): string {
  if (typeof value !== 'string' || (provider === 'APNS' ? !/^(?:[a-f0-9]{2}){16,128}$/.test(value) : !/^[A-Za-z0-9_:.-]{16,4096}$/.test(value))) throw new ApiError('INVALID_REQUEST', 400);
  return value;
}
export function parseNativePush(value: unknown): NativePushInput {
  const input = object(value, ['provider', 'token', 'installationId', 'bindingSecret', 'generation']);
  if (input.provider !== 'APNS' && input.provider !== 'FCM') throw new ApiError('INVALID_REQUEST', 400);
  return { provider: input.provider, token: nativeDeviceToken(input.provider, input.token), installationId: identifier(input.installationId),
    bindingSecret: nativeBindingSecret(input.bindingSecret), ...(input.generation === undefined ? {} : parseSubscriptionGeneration({ generation: input.generation })) };
}
export const nativeBindingDigest = (value: string): Buffer => createHash('sha256').update('rogi:native-push-binding:v1:').update(value).digest();
export const nativeTokenDigest = (audience: string, client: string, provider: string, token: string): Buffer =>
  createHash('sha256').update(JSON.stringify(['native-push:v1', audience, client, provider, token])).digest();
export function sealNativeToken(token: string, key: Buffer, context: string): Buffer {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(context)); const bytes = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), bytes]);
}
export function openNativeToken(bytes: Uint8Array, key: Buffer, context: string): string {
  const data = Buffer.from(bytes);
  if (data.length < 44 || data.length > 4124) throw new Error('invalid_native_push_token');
  try {
    const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(data.subarray(12, 28));
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]));
  } catch { throw new Error('invalid_native_push_token'); }
}
