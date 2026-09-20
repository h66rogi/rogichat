import { current, imageReferenceKey } from './contracts';
import type { ImageContext } from './contracts';
import type { MediaClient } from './client';

export type ImageState = Readonly<{ phase: 'empty' | 'loading' | 'ready' | 'expired' | 'unavailable'; objectUrl?: string; referenceKey?: string }>;
const empty: ImageState = Object.freeze({ phase: 'empty' });
/** Owns the one in-memory blob URL; never exposes a signed URL to UI or persistence. */
export class MediaImageResource {
  get lifetime() { return this.client.lifetime; }
  private state: ImageState = empty;
  private readonly listeners = new Set<() => void>();
  private operation: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private readonly client: MediaClient;
  constructor(client: MediaClient) {
    this.client = client;
    client.lifetime.signal.addEventListener('abort', this.clear, { once: true });
  }
  getSnapshot = (): ImageState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(state: ImageState): void { this.state = Object.freeze(state); this.listeners.forEach(listener => listener()); }
  clear = (): void => {
    ++this.generation; this.operation?.abort(); this.operation = undefined;
    clearTimeout(this.timer); this.timer = undefined;
    if (this.state.objectUrl) URL.revokeObjectURL(this.state.objectUrl);
    this.set(empty);
  };
  dispose = (): void => { this.clear(); this.client.lifetime.signal.removeEventListener('abort', this.clear); this.listeners.clear(); };
  async load(assetId: string, context: ImageContext): Promise<void> {
    this.clear();
    const generation = this.generation;
    this.operation = new AbortController();
    const signal = this.operation.signal;
    try {
      current(this.client.lifetime); this.set({ phase: 'loading' });
      const lease = await this.client.image(assetId, context, signal);
      current(this.client.lifetime); signal.throwIfAborted();
      if (generation !== this.generation) return;
      const remaining = lease.expiresAt - Date.now();
      if (remaining <= 0) { this.set({ phase: 'expired' }); return; }
      const objectUrl = URL.createObjectURL(lease.blob);
      this.set({ phase: 'ready', objectUrl, referenceKey: imageReferenceKey(assetId, context) });
      this.timer = setTimeout(() => {
        if (generation !== this.generation) return;
        this.clear(); this.set({ phase: 'expired' });
      }, remaining);
    } catch {
      if (generation !== this.generation) return;
      if (signal.aborted || this.client.lifetime.signal.aborted || !this.client.lifetime.isCurrent()) { this.clear(); return; }
      this.set({ phase: 'unavailable' });
    }
  }
}
