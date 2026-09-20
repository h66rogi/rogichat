import { ApiError, object } from '../auth-primitives.js';
export function passwordValue(value: unknown): string {
  if (typeof value !== 'string' || [...value].length < 12 || Buffer.byteLength(value, 'utf8') > 256 || [...value].some(char => char.codePointAt(0)! < 32 || char.codePointAt(0) === 127) || Buffer.from(value, 'utf8').toString('utf8') !== value) throw new ApiError('INVALID_REQUEST', 400);
  return value; // No trimming, normalization, silent truncation or composition rules.
}
export function loginIdValue(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(value)) throw new ApiError('INVALID_REQUEST', 400);
  return value.toLowerCase();
}
function client(value: unknown): 'web' | 'ios' | 'android' {
  if (value !== 'web' && value !== 'ios' && value !== 'android') throw new ApiError('INVALID_REQUEST', 400);
  return value;
}
export function passwordLogin(value: unknown) {
  const body = object(value, ['clientId', 'loginId', 'password', 'termsVersion']);
  if (body.termsVersion !== '2026-09-20') throw new ApiError('INVALID_REQUEST', 400);
  return { clientId: client(body.clientId), loginId: loginIdValue(body.loginId), password: passwordValue(body.password), termsVersion: body.termsVersion };
}
export function passwordChange(value: unknown) {
  const body = object(value, ['clientId', 'currentPassword', 'newPassword']);
  return { clientId: client(body.clientId), currentPassword: passwordValue(body.currentPassword), newPassword: passwordValue(body.newPassword) };
}
