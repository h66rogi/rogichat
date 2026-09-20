import { ApiError, type Session } from '../../core/api/client';
import { exact, token, uuid } from '../chat/contract';

export interface DeletionReceipt { requestId: string; status: 'blocked' }
export type PublicationReceipt = { publicationId: string; status: 'preparing' | 'revoked' } | { publicationId: string; status: 'published'; messageId: string };
export function deletionReceipt(value: unknown): DeletionReceipt {
  const data = exact(value, ['requestId', 'status']);
  if (typeof data.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(data.requestId) || data.status !== 'blocked') throw new ApiError(502, 'INVALID_RESPONSE');
  return { requestId: data.requestId, status: 'blocked' };
}
export function publicationReceipt(value: unknown, expected?: string): PublicationReceipt {
  const data = exact(value, ['publicationId', 'status'], ['messageId']);
  const publicationId = uuid(data.publicationId);
  if (expected !== undefined && publicationId !== expected) throw new ApiError(502, 'INVALID_RESPONSE');
  if (data.status === 'published') return { publicationId, status: 'published', messageId: uuid(data.messageId) };
  if (!['preparing', 'revoked'].includes(String(data.status)) || 'messageId' in data) throw new ApiError(502, 'INVALID_RESPONSE');
  return { publicationId, status: data.status as 'preparing' | 'revoked' };
}

/** Small metadata only. Never log or surface an upstream body. */
export class PrivacyClient {
  private readonly transport: typeof fetch;
  readonly origin: string;
  constructor(origin: string, transport: typeof fetch = fetch) {
    if (!['https://api.qa.rogi.chat', 'https://api.rogi.chat'].includes(origin)) throw new Error('Unapproved API origin');
    this.origin = origin; this.transport = (input, init) => transport(input, init);
  }
  private async request(path: string, status: number, signal: AbortSignal, method?: 'POST' | 'DELETE', csrf?: string, body: unknown = {}): Promise<unknown> {
    signal.throwIfAborted();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (method) {
      headers['Content-Type'] = 'application/json';
      if (csrf) headers['X-CSRF-Token'] = token(csrf);
      else if (path !== '/v1/auth/soop/start') throw new Error('Missing CSRF');
    }
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
    const response = await this.transport(this.origin + path, { method: method ?? 'GET', credentials: 'include', cache: 'no-store', redirect: 'error', headers, signal: requestSignal, ...(method ? { body: JSON.stringify(body) } : {}) });
    const reader = response.body?.getReader();
    const cancel = () => { void reader?.cancel().catch(() => {}); };
    requestSignal.addEventListener('abort', cancel, { once: true });
    let value: unknown;
    try {
      requestSignal.throwIfAborted();
      if (!reader || response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') throw new ApiError(response.ok ? 502 : response.status, 'REQUEST_FAILED');
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > 8192)) throw new ApiError(502, 'INVALID_RESPONSE');
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const part = await reader.read(); requestSignal.throwIfAborted();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 8192) throw new ApiError(502, 'INVALID_RESPONSE');
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { throw new ApiError(response.ok ? 502 : response.status, 'INVALID_RESPONSE'); }
    } finally {
      requestSignal.removeEventListener('abort', cancel);
      await reader?.cancel().catch(() => {}); reader?.releaseLock();
    }
    requestSignal.throwIfAborted();
    if (response.status !== status) {
      let code = 'REQUEST_FAILED';
      try {
        const error = exact(exact(value, ['error']).error, ['code']);
        if (response.status === 403 && error.code === 'RECENT_AUTH_REQUIRED') code = 'RECENT_AUTH_REQUIRED';
      } catch { /* Opaque error. */ }
      throw new ApiError(response.status, code);
    }
    return value;
  }
  async session(signal: AbortSignal): Promise<Session> {
    const data = exact(await this.request('/v1/auth/session', 200, signal), ['authenticated', 'soopLinkStatus', 'csrfToken', 'accountPartition']);
    if (data.authenticated !== true || !['VERIFIED', 'REQUIRED'].includes(String(data.soopLinkStatus))) throw new ApiError(502, 'INVALID_SESSION');
    return { authenticated: true, soopLinkStatus: data.soopLinkStatus as Session['soopLinkStatus'], csrfToken: token(data.csrfToken), accountPartition: token(data.accountPartition) };
  }
  async deleteAccount(csrf: string, signal: AbortSignal) { return deletionReceipt(await this.request('/v1/me/account', 200, signal, 'DELETE', csrf)); }
  async publish(room: string, message: string, csrf: string, signal: AbortSignal) { return publicationReceipt(await this.request(`/v1/rooms/${uuid(room)}/messages/${uuid(message)}/publications`, 202, signal, 'POST', csrf)); }
  async publication(room: string, id: string, signal: AbortSignal) { return publicationReceipt(await this.request(`/v1/rooms/${uuid(room)}/publications/${uuid(id)}`, 200, signal), id); }
  async login(signal: AbortSignal): Promise<string> {
    const data = exact(await this.request('/v1/auth/soop/start', 200, signal, 'POST', undefined, { intent: 'login', termsVersion: '2026-09-20' }), ['authorizeUrl']);
    if (typeof data.authorizeUrl !== 'string') throw new ApiError(502, 'INVALID_AUTH_URL');
    const url = new URL(data.authorizeUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new ApiError(502, 'INVALID_AUTH_URL');
    return url.href;
  }
}
