import { exact, token } from '../../features/chat/contract';
import type { ServerMessage } from '../../features/chat/contract';
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(status === 401 ? '로그인이 필요합니다.' : status === 403 ? '접근 권한을 다시 확인해 주세요.' : status === 429 ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.' : status === 400 ? '입력 내용을 확인해 주세요.' : '요청을 완료하지 못했습니다. 다시 시도해 주세요.');
    this.status = status; this.code = code;
  }
}
export interface Session { authenticated: true; soopLinkStatus: 'VERIFIED' | 'REQUIRED'; csrfToken: string; accountPartition: string }
export interface Profile { id: string; nickname: string; avatar: { assetId: string } | null; birthday: { month: number; day: number } | null; birthdayVisibleToStreamers: boolean }
export interface Room { roomId: string; name: string; mode: string; joined: boolean; actorId?: string }
export type Message = ServerMessage;
export class ApiClient {
  readonly origin: string;
  private readonly transport: typeof fetch;
  constructor(origin: string, transport: typeof fetch = fetch) {
    this.origin = origin; this.transport = (input, init) => transport(input, init);
    if (!['https://api.qa.rogi.chat', 'https://api.rogi.chat'].includes(origin)) throw new Error('Unapproved API origin');
  }
  async request<T>(path: string, options: { signal?: AbortSignal; method?: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown; csrf?: string } = {}): Promise<T> {
    if (!path.startsWith('/v1/') || path.includes('..') || path.includes('\\')) throw new Error('Invalid API path');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.method) {
      headers['Content-Type'] = 'application/json';
      if (options.csrf) headers['X-CSRF-Token'] = options.csrf;
      else if (path !== '/v1/auth/soop/start') throw new Error('Missing CSRF token');
    }
    const response = await this.transport(this.origin + path, {
      method: options.method ?? 'GET', credentials: 'include', cache: 'no-store', redirect: 'error', headers,
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      ...(options.method ? { body: JSON.stringify(options.body ?? {}) } : {}),
    });
    if (!response.ok) {
      // Never render or log upstream text, token values, HTML or private response bodies.
      let code = 'REQUEST_FAILED';
      try {
        if (response.headers.get('content-type')?.includes('application/json')) {
          const envelope = exact(await response.json(), ['error']);
          const error = exact(envelope.error, ['code']);
          const allowed: Record<number, readonly string[]> = { 400: ['INVALID_REQUEST'], 401: ['UNAUTHENTICATED'], 403: ['FORBIDDEN', 'SOOP_LINK_REQUIRED'], 404: ['NOT_FOUND'], 409: ['MEMBERSHIP_SCOPE_MISMATCH'], 429: ['RATE_LIMITED'] };
          if (typeof error.code === 'string' && allowed[response.status]?.includes(error.code)) code = error.code;
        }
      } catch { /* Malformed or non-allowlisted bodies remain opaque. */ }
      throw new ApiError(response.status, code);
    }
    if (response.status === 204) return undefined as T;
    if (!response.headers.get('content-type')?.includes('application/json')) throw new ApiError(502, 'INVALID_RESPONSE');
    return response.json() as Promise<T>;
  }
  async session(signal?: AbortSignal): Promise<Session> {
    const value = await this.request<Session>('/v1/auth/session', signal ? { signal } : {});
    if (!value || value.authenticated !== true || typeof value.csrfToken !== 'string' || value.csrfToken.length < 16 || !['VERIFIED', 'REQUIRED'].includes(value.soopLinkStatus)) throw new ApiError(502, 'INVALID_SESSION');
    try { exact(value, ['authenticated', 'soopLinkStatus', 'csrfToken', 'accountPartition']); token(value.accountPartition); } catch { throw new ApiError(502, 'INVALID_SESSION'); }
    return value;
  }
  async profile(signal?: AbortSignal): Promise<Profile> {
    return validateProfile(await this.request<Profile>('/v1/me/profile', signal ? { signal } : {}));
  }
  async authorize(intent: 'login' | 'link', csrf?: string) {
    const result = await this.request<{ authorizeUrl: string }>('/v1/auth/soop/start', { method: 'POST', body: intent === 'login' ? { intent, termsVersion: '2026-09-20' } : { intent }, ...(csrf ? { csrf } : {}) });
    const url = new URL(result.authorizeUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new ApiError(502, 'INVALID_AUTH_URL');
    return url.href;
  }
}

export function validateProfile(value: Profile): Profile {
  if (!value || typeof value.id !== 'string' || !value.id || typeof value.nickname !== 'string' || typeof value.birthdayVisibleToStreamers !== 'boolean' || (value.avatar !== null && (!value.avatar || typeof value.avatar.assetId !== 'string')) || (value.birthday !== null && (!value.birthday || !Number.isInteger(value.birthday.month) || value.birthday.month < 1 || value.birthday.month > 12 || !Number.isInteger(value.birthday.day) || value.birthday.day < 1 || value.birthday.day > 31))) throw new ApiError(502, 'INVALID_PROFILE');
  return value;
}
