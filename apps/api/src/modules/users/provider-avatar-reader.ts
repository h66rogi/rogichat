/** Bounded process-local byte cache. Caller MUST authorize every read before
 * entering this class; cached bytes are never an authorization decision. */
export class ProviderAvatarReader {
  private readonly cache = new Map<string, { value: AvatarBytes; expires: number }>();
  private readonly pending = new Map<string, Promise<AvatarBytes>>();
  private readonly queue: { start: () => void; timer: NodeJS.Timeout }[] = [];
  private active = 0;
  private bytes = 0;
  constructor(private readonly fetcher: (url: string) => Promise<AvatarBytes>, private readonly unavailable: () => Error) {}
  async get(url: string): Promise<AvatarBytes> {
    const now = Date.now();
    for (const [key, cached] of this.cache) if (cached.expires <= now) { this.bytes -= cached.value.bytes.length; this.cache.delete(key); }
    const cached = this.cache.get(url);
    if (cached) { this.cache.delete(url); this.cache.set(url, cached); return cached.value; }
    const existing = this.pending.get(url);
    if (existing) return existing;
    if (this.pending.size >= 36) throw this.unavailable();
    const pending = this.download(url).finally(() => { this.pending.delete(url); });
    this.pending.set(url, pending);
    return pending;
  }
  private acquire(): Promise<void> {
    if (this.active < 4) { this.active++; return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      const entry = { start: resolve, timer: setTimeout(() => {
        const index = this.queue.indexOf(entry); if (index >= 0) this.queue.splice(index, 1);
        reject(this.unavailable());
      }, 4000) };
      this.queue.push(entry);
    });
  }
  private release() {
    const next = this.queue.shift();
    if (next) { clearTimeout(next.timer); next.start(); } else this.active--;
  }
  private async download(url: string) {
    await this.acquire();
    try {
      const value = await this.fetcher(url);
      while (this.cache.size >= 32 || this.bytes + value.bytes.length > 16 * 1024 * 1024) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.bytes -= this.cache.get(oldest)!.value.bytes.length; this.cache.delete(oldest);
      }
      if (value.bytes.length <= 2 * 1024 * 1024) { this.cache.set(url, { value, expires: Date.now() + 30000 }); this.bytes += value.bytes.length; }
      return value;
    } finally { this.release(); }
  }
}
interface AvatarBytes { bytes: Buffer; contentType: string }
