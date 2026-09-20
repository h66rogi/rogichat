import { current, MediaError } from './contracts';
import { videoReferenceKey } from './video-client';
import type { VideoClient, VideoContext, VideoLease } from './video-client';

export type VideoState = Readonly<{ phase: 'empty' | 'loading' | 'ready' | 'expired' | 'unavailable' | 'unsupported'; referenceKey?: string }>;
export type VideoElement = Pick<HTMLVideoElement, 'src' | 'poster' | 'currentTime' | 'duration' | 'paused' | 'playbackRate' | 'canPlayType' | 'pause' | 'play' | 'load' | 'removeAttribute' | 'addEventListener' | 'removeEventListener'>;
/** One visible reference, one expiring Blob pair, no signed URL in UI state. */
export class MediaVideoResource {
  get lifetime() { return this.client.lifetime; }
  private state: VideoState = Object.freeze({ phase: 'empty' });
  private readonly listeners = new Set<() => void>();
  private element: VideoElement | undefined;
  private operation: AbortController | undefined;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private leases: VideoLease[] = [];
  private urls: string[] = [];
  private metadata: (() => void) | undefined;
  private saved = { position: 0, resume: false, rate: 1 };
  private readonly client: VideoClient;
  constructor(client: VideoClient) {
    this.client = client;
    this.lifetime.signal.addEventListener('abort', this.clear, { once: true });
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.visibility);
  }
  getSnapshot = (): VideoState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(state: VideoState): void { this.state = Object.freeze(state); this.listeners.forEach(listener => listener()); }
  attach(element: VideoElement): void { this.element = element; }
  detach(): void { this.clear(); this.element = undefined; }
  private release(): void {
    ++this.generation; this.operation?.abort(); this.operation = undefined;
    clearTimeout(this.timer); this.timer = undefined;
    if (this.element) {
      if (this.metadata) this.element.removeEventListener('loadedmetadata', this.metadata);
      this.element.pause(); this.element.removeAttribute('src'); this.element.removeAttribute('poster'); this.element.load();
    }
    this.metadata = undefined;
    this.urls.forEach(url => URL.revokeObjectURL(url)); this.urls = [];
    this.leases.forEach(lease => lease.release()); this.leases = [];
  }
  clear = (): void => { this.release(); this.saved = { position: 0, resume: false, rate: 1 }; this.set({ phase: 'empty' }); };
  dispose = (): void => {
    this.detach(); this.lifetime.signal.removeEventListener('abort', this.clear); this.listeners.clear();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibility);
  };
  private remember(): void {
    const element = this.element;
    if (element && this.state.phase === 'ready') this.saved = {
      position: Number.isFinite(element.currentTime) ? Math.max(0, element.currentTime) : 0,
      resume: !element.paused, rate: element.playbackRate,
    };
  }
  /** Offscreen/background cleanup retains only position, never URLs or media bytes. */
  suspend = (): void => {
    if (this.state.phase !== 'ready' && this.state.phase !== 'loading') return;
    this.remember(); this.saved.resume = false;
    const referenceKey = this.state.referenceKey;
    this.release(); this.set({ phase: 'expired', ...(referenceKey ? { referenceKey } : {}) });
  };
  private visibility = (): void => { if (document.visibilityState === 'hidden') this.suspend(); };
  playbackFailed = (): void => {
    this.remember(); const referenceKey = this.state.referenceKey;
    this.release(); this.set({ phase: 'unavailable', ...(referenceKey ? { referenceKey } : {}) });
  };
  async load(assetId: string, context: VideoContext, revision: string, restore = false): Promise<void> {
    const key = videoReferenceKey(assetId, context, revision);
    if (!restore || this.state.referenceKey !== key) this.saved = { position: 0, resume: false, rate: 1 };
    this.release();
    const generation = this.generation;
    const operation = new AbortController(); this.operation = operation;
    const valid = () => {
      current(this.lifetime); operation.signal.throwIfAborted();
      if (generation !== this.generation) throw new MediaError('REVOKED');
    };
    try {
      valid();
      const element = this.element;
      if (!element || !element.canPlayType('video/mp4; codecs="avc1.42E01E"') || !element.canPlayType('audio/mp4; codecs="mp4a.40.2"')) {
        this.set({ phase: 'unsupported', referenceKey: key }); return;
      }
      this.set({ phase: 'loading', referenceKey: key });
      // Sequential loads share one session budget. Hold the earlier expiry of both leases.
      for (const variant of ['poster', 'video'] as const) {
        const lease = await this.client.load(assetId, context, variant, operation.signal);
        try { valid(); } catch (error) { lease.release(); throw error; }
        this.leases.push(lease);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          if (generation === this.generation) this.playbackFailed();
        }, Math.max(0, Math.min(...this.leases.map(item => item.expiresAt)) - Date.now()));
      }
      valid();
      const expiresAt = Math.min(...this.leases.map(lease => lease.expiresAt));
      if (expiresAt <= Date.now()) throw new MediaError('EXPIRED');
      for (const lease of this.leases) this.urls.push(URL.createObjectURL(lease.blob));
      this.metadata = () => {
        try {
          valid();
          if (Date.now() >= expiresAt) { this.playbackFailed(); return; }
          if (Number.isFinite(element.duration)) element.currentTime = Math.min(this.saved.position, Math.max(0, element.duration));
          element.playbackRate = this.saved.rate;
          if (this.saved.resume) void element.play().catch(() => { /* Browser may require a new user gesture. Native controls remain available. */ });
        } catch { if (generation === this.generation) this.clear(); }
      };
      element.addEventListener('loadedmetadata', this.metadata, { once: true });
      element.poster = this.urls[0]!; element.src = this.urls[1]!; element.load();
      this.set({ phase: 'ready', referenceKey: key });
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        if (generation !== this.generation) return;
        this.remember();
        // Revoke first; fresh access POST rechecks room/message ACL and session.
        if (this.saved.resume && (typeof document === 'undefined' || document.visibilityState === 'visible')) {
          void this.load(assetId, context, revision, true);
        } else this.suspend();
      }, expiresAt - Date.now());
    } catch {
      if (generation !== this.generation) return;
      this.release();
      if (this.lifetime.signal.aborted || !this.lifetime.isCurrent()) this.set({ phase: 'empty' });
      else this.set({ phase: 'unavailable', referenceKey: key });
    }
  }
}
