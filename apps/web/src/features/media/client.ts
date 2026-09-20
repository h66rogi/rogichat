import { current, imageContext, MediaError, receipt, record, stickerPage, uploadInput, uuid } from './contracts';
import type { ImageContext, ImageKind, MediaLifetime, Receipt, StickerPage } from './contracts';

// Covers the 50-item catalog, including escaped Unicode labels, with headroom.
const MAX_METADATA_BYTES = 64 * 1024;

export interface MediaClientOptions {
  readonly apiOrigin: string;
  // Deployment configuration, never inferred from a response. Empty means unavailable.
  readonly storageOrigins: readonly string[];
  readonly csrf: () => string;
  readonly lifetime: MediaLifetime;
  readonly transport?: typeof fetch;
}
export interface ImageLease { readonly blob: Blob; readonly expiresAt: number }
export class MediaClient {
  readonly lifetime: MediaLifetime;
  private readonly origin: string;
  private readonly origins: ReadonlySet<string>;
  private readonly csrf: () => string;
  private readonly transport: typeof fetch;
  constructor(options: MediaClientOptions) {
    if (!['https://api.qa.rogi.chat', 'https://api.rogi.chat'].includes(options.apiOrigin)) throw new MediaError('INVALID_ORIGIN');
    this.origin = options.apiOrigin;
    this.origins = new Set(options.storageOrigins.map(value => {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password || value === this.origin) throw new MediaError('INVALID_ORIGIN');
      return value;
    }));
    this.csrf = options.csrf; this.lifetime = options.lifetime;
    const transport = options.transport ?? fetch;
    this.transport = (input, init) => transport(input, init);
  }
  private async request(path: string, expectedStatus: number, signal: AbortSignal, body?: unknown, binary?: Blob): Promise<unknown> {
    current(this.lifetime); signal.throwIfAborted();
    const write = body !== undefined || binary !== undefined;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (write) {
      const csrf = this.csrf();
      if (!/^[A-Za-z0-9_-]{43}$/.test(csrf)) throw new MediaError('INVALID_CSRF');
      headers['X-CSRF-Token'] = csrf;
      headers['Content-Type'] = binary ? 'application/octet-stream' : 'application/json';
    }
    const requestSignal = AbortSignal.any([this.lifetime.signal, signal, AbortSignal.timeout(binary ? 300_000 : 15_000)]);
    const response = await this.transport(this.origin + path, {
      method: write ? 'POST' : 'GET', credentials: 'include', cache: 'no-store', redirect: 'error',
      headers, signal: requestSignal, ...(write ? { body: binary ?? JSON.stringify(body) } : {}),
    });
    const reader = response.body?.getReader();
    const cancel = () => { void reader?.cancel().catch(() => {}); };
    requestSignal.addEventListener('abort', cancel, { once: true });
    let value: unknown;
    try {
      current(this.lifetime); requestSignal.throwIfAborted();
      if (response.status !== expectedStatus) throw new MediaError('REQUEST_FAILED', response.status);
      if (!reader || response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') throw new MediaError('INVALID_RESPONSE');
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_METADATA_BYTES)) throw new MediaError('INVALID_RESPONSE');
      const decoder = new TextDecoder();
      let size = 0;
      let text = '';
      for (;;) {
        const part = await reader.read();
        current(this.lifetime); requestSignal.throwIfAborted();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_METADATA_BYTES) throw new MediaError('INVALID_RESPONSE');
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
      try { value = JSON.parse(text) as unknown; }
      catch { throw new MediaError('INVALID_RESPONSE'); }
    } finally {
      requestSignal.removeEventListener('abort', cancel);
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
    }
    current(this.lifetime); requestSignal.throwIfAborted();
    return value;
  }
  async reserve(kind: ImageKind, file: Blob, roomId: string | undefined, signal: AbortSignal): Promise<Receipt> {
    const result = receipt(await this.request('/v1/media/upload-intents', 201, signal, uploadInput(kind, file, roomId)));
    if (result.status !== 'reserved') throw new MediaError('INVALID_RESPONSE');
    return result;
  }
  async upload(assetId: string, file: Blob, signal: AbortSignal): Promise<Receipt> {
    const result = receipt(await this.request(`/v1/media/upload-intents/${uuid(assetId)}/content`, 202, signal, undefined, file), assetId);
    if (result.status !== 'processing') throw new MediaError('INVALID_RESPONSE');
    return result;
  }
  async status(assetId: string, signal: AbortSignal): Promise<Receipt> {
    return receipt(await this.request(`/v1/media/upload-intents/${uuid(assetId)}`, 200, signal), assetId);
  }
  async stickers(roomId: string, after: string | undefined, signal: AbortSignal): Promise<StickerPage> {
    return stickerPage(await this.request(`/v1/rooms/${uuid(roomId)}/stickers${after === undefined ? '' : `?after=${uuid(after)}`}`, 200, signal));
  }
  async image(assetId: string, context: ImageContext, signal: AbortSignal): Promise<ImageLease> {
    // Start expiry before admission: a delayed response must never extend the URL lifetime.
    const expiresAt = Date.now() + 60_000;
    if (!this.origins.size) throw new MediaError('MEDIA_UNAVAILABLE');
    const access = record(await this.request(`/v1/media/assets/${uuid(assetId)}/access`, 200, signal, imageContext(context)), ['url', 'expiresIn']);
    if (typeof access.url !== 'string' || access.expiresIn !== 60) throw new MediaError('INVALID_RESPONSE');
    let url: URL;
    try { url = new URL(access.url); } catch { throw new MediaError('INVALID_RESPONSE'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || !this.origins.has(url.origin)) throw new MediaError('INVALID_RESPONSE');
    current(this.lifetime); signal.throwIfAborted();
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) throw new MediaError('EXPIRED');
    const transferSignal = AbortSignal.any([this.lifetime.signal, signal, AbortSignal.timeout(Math.min(remaining, 30_000))]);
    // A distinct GET: never copy API headers, CSRF, cookies or caller fetch options.
    const response = await this.transport(url.href, { method: 'GET', credentials: 'omit', mode: 'cors',
      cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: transferSignal });
    current(this.lifetime); transferSignal.throwIfAborted();
    if (response.status !== 200 || !response.body) throw new MediaError('MEDIA_UNAVAILABLE', response.status);
    const type = response.headers.get('content-type')?.split(';')[0]?.trim();
    if (!type || !['image/jpeg', 'image/png', 'image/webp'].includes(type)) { await response.body.cancel(); throw new MediaError('INVALID_RESPONSE'); }
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        current(this.lifetime); transferSignal.throwIfAborted();
        if (Date.now() >= expiresAt) throw new MediaError('EXPIRED');
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 10 * 1024 * 1024) throw new MediaError('INVALID_RESPONSE');
        chunks.push(new Uint8Array(part.value));
      }
      if (!size) throw new MediaError('INVALID_RESPONSE');
      return { blob: new Blob(chunks, { type }), expiresAt };
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}
