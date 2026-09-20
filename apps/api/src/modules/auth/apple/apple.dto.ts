import { object, opaque, ApiError } from '../auth-primitives.js';
import { uuid } from '../../../common/validation/identifier.js';
import type { AppleClient } from './apple-config.js';

export interface AppleStartDto { clientId: AppleClient; intent: 'login' | 'link'; codeChallenge: string; returnState: string; termsVersion?: '2026-09-20' }
export interface AppleStartResponse { transactionId: string; state: string; nonce: string; authorizeUrl: string | null; expiresIn: 600 }
export interface AppleExchangeDto { clientId: AppleClient; transactionId: string; code: string; codeVerifier: string }
export interface AppleNativeCompleteDto { transactionId: string; state: string; authorizationCode: string; identityToken: string; codeVerifier: string }
export function appleClient(value: unknown): AppleClient {
  if (value !== 'ios' && value !== 'android' && value !== 'web') throw new ApiError('INVALID_REQUEST', 400);
  return value;
}
function verifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(value)) throw new ApiError('INVALID_REQUEST', 400);
  return value;
}
function bounded(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.length || value.length > max || !/^[!-~]+$/.test(value)) throw new ApiError('INVALID_REQUEST', 400);
  return value;
}
export function appleStart(value: unknown): AppleStartDto {
  const body = object(value, ['clientId', 'intent', 'codeChallenge', 'returnState', 'termsVersion']);
  if (body.intent !== 'login' && body.intent !== 'link') throw new ApiError('INVALID_REQUEST', 400);
  if (body.intent === 'login' ? body.termsVersion !== '2026-09-20' : body.termsVersion !== undefined) throw new ApiError('TERMS_REQUIRED', 403);
  return { clientId: appleClient(body.clientId), intent: body.intent, codeChallenge: opaque(body.codeChallenge), returnState: opaque(body.returnState), ...(body.intent === 'login' ? { termsVersion: '2026-09-20' as const } : {}) };
}
export function appleExchange(value: unknown): AppleExchangeDto {
  const body = object(value, ['clientId', 'transactionId', 'code', 'codeVerifier']);
  return { clientId: appleClient(body.clientId), transactionId: uuid(bounded(body.transactionId, 36)), code: opaque(body.code), codeVerifier: verifier(body.codeVerifier) };
}
export function appleNativeComplete(value: unknown): AppleNativeCompleteDto {
  const body = object(value, ['transactionId', 'state', 'authorizationCode', 'identityToken', 'codeVerifier']);
  return { transactionId: uuid(bounded(body.transactionId, 36)), state: opaque(body.state), authorizationCode: bounded(body.authorizationCode, 4096), identityToken: bounded(body.identityToken, 16384), codeVerifier: verifier(body.codeVerifier) };
}
