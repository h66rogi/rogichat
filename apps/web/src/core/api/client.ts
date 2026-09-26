import { exact } from '../../features/chat/contract';
import { parseSession, type Session } from './session-contract';
export type { Session } from './session-contract';
import type { ServerMessage } from '../../features/chat/contract';
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(status === 401 ? '로그인이 필요합니다.' : status === 403 ? '접근 권한을 다시 확인해 주세요.' : status === 429 ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.' : status === 400 ? '입력 내용을 확인해 주세요.' : '요청을 완료하지 못했습니다. 다시 시도해 주세요.');
    this.status = status; this.code = code;
  }
}
export interface Profile { providerAvatarUrl?: string | null; soop?: { displayId: string } | null; id: string; nickname: string; avatar: { assetId: string } | null; birthday: { month: number; day: number } | null; birthdayVisibleToStreamers: boolean }
export interface Room { isDefault?: boolean; availability?: 'OWNER_PENDING' | 'READY'; roomId: string; name: string; mode: string; joined: boolean; actorId?: string; role?: 'FAN' | 'STREAMER' | 'MEMBER' }
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
      else if (!['/v1/auth/soop/start', '/v1/auth/password/login'].includes(path)) throw new Error('Missing CSRF token');
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
          const allowed: Record<number, readonly string[]> = { 400: ['INVALID_REQUEST'], 401: ['UNAUTHENTICATED'], 403: ['FORBIDDEN', 'SOOP_LINK_REQUIRED'], 404: ['NOT_FOUND'], 409: ['MEMBERSHIP_SCOPE_MISMATCH', 'CONFLICT'], 429: ['RATE_LIMITED'] };
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
    const value = await this.request<unknown>('/v1/auth/session', signal ? { signal } : {});
    try { return parseSession(value); } catch { throw new ApiError(502, 'INVALID_SESSION'); }
  }
  async profile(signal?: AbortSignal): Promise<Profile> {
    return validateProfile(await this.request<Profile>('/v1/me/profile', signal ? { signal } : {}));
  }
  async authorize(intent: 'login' | 'link', csrf?: string) {
    const result = await this.request<{ authorizeUrl: string }>('/v1/auth/soop/start', { method: 'POST', body: { intent }, ...(csrf ? { csrf } : {}) });
    const url = new URL(result.authorizeUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new ApiError(502, 'INVALID_AUTH_URL');
    return url.href;
  }
}

export function validateProfile(value: Profile): Profile {
  if (!value || typeof value.id !== 'string' || !value.id || typeof value.nickname !== 'string' || typeof value.birthdayVisibleToStreamers !== 'boolean' || (value.avatar !== null && (!value.avatar || typeof value.avatar.assetId !== 'string')) || (value.birthday !== null && (!value.birthday || !Number.isInteger(value.birthday.month) || value.birthday.month < 1 || value.birthday.month > 12 || !Number.isInteger(value.birthday.day) || value.birthday.day < 1 || value.birthday.day > 31))) throw new ApiError(502, 'INVALID_PROFILE');
  if (value.soop !== undefined && value.soop !== null && (typeof value.soop !== 'object' || Array.isArray(value.soop) || Object.keys(value.soop).some(key => key !== 'displayId') || typeof value.soop.displayId !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(value.soop.displayId))) throw new ApiError(502, 'INVALID_PROFILE');
  if (value.providerAvatarUrl !== undefined && value.providerAvatarUrl !== null && !isProviderAvatarUrl(value.providerAvatarUrl)) throw new ApiError(502, 'INVALID_PROFILE');
  return value;
}

/** Defense in depth for rendering only. Identity verification belongs to the API. */
export function isProviderAvatarUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  const match = /^https:\/\/(?:stimg|profile\.img)\.sooplive\.(?:com|co\.kr)\/LOGO\/([A-Za-z0-9_-]{1,2})\/([A-Za-z0-9_-]{1,128})\/(m\/)?([A-Za-z0-9_-]{1,128})\.(jpg|webp)(?:\?t=[0-9]{1,16})?$/.exec(value);
  return !!match && match[0] === value && match[1] === match[2]?.slice(0, 2) && match[2] === match[4] && (!match[3] || match[5] === 'webp');
}
