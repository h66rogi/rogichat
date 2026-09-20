import { current, MediaError, record, uuid } from './contracts';
import type { MediaClientOptions } from './client';

export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const POSTER_MAX_BYTES = 2 * 1024 * 1024;
const RANGE_BYTES = 1024 * 1024;
export type VideoContext =
  | { readonly roomId: string; readonly messageId: string }
  | { readonly roomId?: never; readonly messageId?: never };
// Structural interface to the session owner's shared MediaByteBudget. Never a local pool.
export interface VideoByteBudget { reserve(bytes: number): () => void }
export interface VideoLease { readonly blob: Blob; readonly expiresAt: number; release(): void }
export interface VideoClientOptions extends MediaClientOptions {
  readonly budget: VideoByteBudget;
  readonly verifySession: (signal: AbortSignal) => Promise<void>;
}
export function videoReferenceKey(assetId: string, context: VideoContext, revision: string): string {
  return JSON.stringify([assetId, context.roomId, context.messageId, revision]);
}

/** Ordinary fast-start MP4, assembled only within a hard limit; not an MSE stream. */
export class VideoClient {
  readonly lifetime;
  private readonly options: VideoClientOptions;
  private readonly origins: ReadonlySet<string>;
  private readonly transport: typeof fetch;
  constructor(options: VideoClientOptions) {
    if (!['https://api.qa.rogi.chat', 'https://api.rogi.chat'].includes(options.apiOrigin)) throw new MediaError('INVALID_ORIGIN');
    this.origins = new Set(options.storageOrigins.map(origin => {
      const url = new URL(origin);
      if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || origin === options.apiOrigin) throw new MediaError('INVALID_ORIGIN');
      return origin;
    }));
    this.options = options; this.lifetime = options.lifetime;
    const transport = options.transport ?? fetch;
    this.transport = (input, init) => transport(input, init);
  }
  private check(signal: AbortSignal, expiresAt = Infinity): void {
    current(this.lifetime); signal.throwIfAborted();
    if (Date.now() >= expiresAt) throw new MediaError('EXPIRED');
  }
  private async bytes(response: Response, limit: number, signal: AbortSignal, expiresAt: number): Promise<Uint8Array<ArrayBuffer>> {
    const reader = response.body?.getReader();
    if (!reader) throw new MediaError('INVALID_RESPONSE');
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      this.check(signal, expiresAt);
      const buffer = new Uint8Array(limit);
      let size = 0;
      for (;;) {
        const part = await reader.read(); this.check(signal, expiresAt);
        if (part.done) break;
        if (part.value.byteLength > limit - size) throw new MediaError('INVALID_RESPONSE');
        buffer.set(part.value, size); size += part.value.byteLength;
      }
      return buffer.subarray(0, size);
    } finally {
      signal.removeEventListener('abort', cancel);
      await reader.cancel().catch(() => {}); reader.releaseLock();
    }
  }
  async load(assetId: string, context: VideoContext, variant: 'video' | 'poster', signal: AbortSignal): Promise<VideoLease> {
    const row = record(context, ['roomId', 'messageId']);
    // Exact empty context is the backend's owner-only, unattached READY preview.
    // Partial references must never silently degrade into owner-preview access.
    const body = row.roomId === undefined && row.messageId === undefined ? { variant } :
      { variant, roomId: uuid(row.roomId), messageId: uuid(row.messageId) };
    uuid(assetId);
    if (!['video', 'poster'].includes(variant) || !this.origins.size) throw new MediaError('MEDIA_UNAVAILABLE');
    const csrf = this.options.csrf();
    if (!/^[A-Za-z0-9_-]{43}$/.test(csrf)) throw new MediaError('INVALID_CSRF');
    const expiresAt = Date.now() + 60_000;
    const operation = AbortSignal.any([this.lifetime.signal, signal, AbortSignal.timeout(60_000)]);
    this.check(operation);
    const releases: Array<() => void> = [];
    let released = false;
    const release = () => { if (!released) { released = true; releases.forEach(fn => fn()); } };
    // Scratch: range buffer, transport chunk, Blob copy/transfer and JSON headroom.
    // Final Blob is composed of immutable Blob parts, never a full-file ArrayBuffer.
    releases.push(this.options.budget.reserve(4 * RANGE_BYTES + 64 * 1024));
    try {
      await this.options.verifySession(operation); this.check(operation, expiresAt);
      const response = await this.transport(`${this.options.apiOrigin}/v1/media/assets/${assetId}/access`, {
        method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'error', signal: operation,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body),
      });
      if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') {
        await response.body?.cancel();
        if (response.status === 401) this.options.onUnauthorized?.();
        throw new MediaError('REQUEST_FAILED', response.status);
      }
      const access = record(JSON.parse(new TextDecoder().decode(await this.bytes(response, 8192, operation, expiresAt))) as unknown, ['url', 'expiresIn']);
      if (typeof access.url !== 'string' || access.expiresIn !== 60) throw new MediaError('INVALID_RESPONSE');
      const url = new URL(access.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || !this.origins.has(url.origin)) throw new MediaError('INVALID_RESPONSE');
      await this.options.verifySession(operation); this.check(operation, expiresAt);
      const type = variant === 'video' ? 'video/mp4' : 'image/webp';
      const cap = variant === 'video' ? VIDEO_MAX_BYTES : POSTER_MAX_BYTES;
      const parts: Blob[] = [];
      let total: number | undefined;
      let etag: string | undefined;
      let offset = 0;
      // Probe one byte first so total capacity is reserved before downloading the file.
      while (total === undefined || offset < total) {
        this.check(operation, expiresAt);
        const end = total === undefined ? 0 : Math.min(offset + RANGE_BYTES, total) - 1;
        const part = await this.transport(url.href, { method: 'GET', credentials: 'omit', mode: 'cors',
          cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: operation,
          headers: { Range: `bytes=${offset}-${end}` } });
        try {
          this.check(operation, expiresAt);
          const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(part.headers.get('content-range') ?? '');
          const length = end - offset + 1;
          const declared = part.headers.get('content-length');
          const encoding = part.headers.get('content-encoding');
          const identity = part.headers.get('etag');
          if (part.status !== 206 || part.headers.get('content-type')?.split(';')[0]?.trim() !== type ||
              (encoding !== null && encoding !== 'identity') || !range || Number(range[1]) !== offset || Number(range[2]) !== end ||
              !Number.isSafeInteger(Number(range[3])) || Number(range[3]) <= end ||
              (declared !== null && (!/^\d+$/.test(declared) || Number(declared) !== length))) throw new MediaError('INVALID_RANGE');
          if (!identity || !/^"[\x21\x23-\x7e]{1,256}"$/.test(identity) || (etag !== undefined && identity !== etag)) throw new MediaError('INVALID_RANGE');
          etag = identity;
          const size = Number(range[3]);
          if (size > cap) throw new MediaError('VIDEO_TOO_LARGE');
          if (total === undefined) { total = size; releases.push(this.options.budget.reserve(total)); }
          else if (size !== total) throw new MediaError('INVALID_RANGE');
          const bytes = await this.bytes(part, length, operation, expiresAt);
          if (bytes.byteLength !== length) throw new MediaError('INVALID_RANGE');
          parts.push(new Blob([bytes])); offset = end + 1;
        } finally { if (!part.body?.locked) await part.body?.cancel().catch(() => {}); }
      }
      await this.options.verifySession(operation); this.check(operation, expiresAt);
      return { blob: new Blob(parts, { type }), expiresAt, release };
    } catch (error) { release(); throw error; }
  }
}
