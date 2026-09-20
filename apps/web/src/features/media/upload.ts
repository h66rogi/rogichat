import { current, MediaError, uploadInput } from './contracts';
import type { ImageKind, Receipt, UploadInput } from './contracts';
import type { MediaClient } from './client';

export type UploadState = Readonly<{
  phase: 'empty' | 'reserving' | 'uploading' | 'checking' | 'pending' | 'ready' | 'failed' | 'uncertain';
  receipt?: Receipt;
}>;
const empty: UploadState = Object.freeze({ phase: 'empty' });
function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(new MediaError('REVOKED')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}
/** One immutable reservation attempt. Status retries never reserve or resend bytes. */
export class MediaUpload {
  get lifetime() { return this.client.lifetime; }
  private state: UploadState = empty;
  private readonly listeners = new Set<() => void>();
  private operation: AbortController | undefined;
  private generation = 0;
  private busy = false;
  private intent: UploadInput | undefined;
  private readonly client: MediaClient;
  private readonly interval: number;
  private readonly attempts: number;
  constructor(client: MediaClient, polling = { intervalMs: 2000, attempts: 30 }) {
    if (!Number.isInteger(polling.attempts) || polling.attempts < 1 || polling.attempts > 30 || !Number.isFinite(polling.intervalMs) || polling.intervalMs < 0 || polling.intervalMs > 10_000) throw new MediaError('INVALID_POLLING');
    this.client = client; this.interval = polling.intervalMs; this.attempts = polling.attempts;
    client.lifetime.signal.addEventListener('abort', this.clear, { once: true });
  }
  getSnapshot = (): UploadState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(state: UploadState): void { this.state = Object.freeze(state); this.listeners.forEach(listener => listener()); }
  clear = (): void => {
    ++this.generation; this.operation?.abort(); this.operation = undefined; this.busy = false; this.intent = undefined; this.set(empty);
  };
  dispose = (): void => { this.clear(); this.client.lifetime.signal.removeEventListener('abort', this.clear); this.listeners.clear(); };
  private active(generation: number, signal: AbortSignal): void {
    current(this.client.lifetime); signal.throwIfAborted();
    if (generation !== this.generation) throw new MediaError('REVOKED');
  }
  private async poll(assetId: string, generation: number, signal: AbortSignal): Promise<void> {
    for (let count = 0; count < this.attempts; count++) {
      this.active(generation, signal);
      const result = await this.client.status(assetId, signal);
      this.active(generation, signal);
      if (result.status === 'ready') { this.set({ phase: 'ready', receipt: result }); return; }
      if (result.status === 'deleted' || result.status === 'deleting') { this.set({ phase: 'failed', receipt: result }); return; }
      this.set({ phase: 'checking', receipt: result });
      if (count + 1 < this.attempts) await pause(this.interval, signal);
    }
    this.active(generation, signal);
    this.set({ phase: 'pending', ...(this.state.receipt ? { receipt: this.state.receipt } : {}) });
  }
  async start(kind: ImageKind, file: Blob, roomId?: string): Promise<void> {
    current(this.client.lifetime);
    if (this.busy || this.state.phase !== 'empty') throw new MediaError('EXPLICIT_CLEAR_REQUIRED');
    this.intent = uploadInput(kind, file, roomId);
    const generation = ++this.generation;
    this.operation = new AbortController();
    const signal = AbortSignal.any([this.operation.signal, this.client.lifetime.signal]);
    this.busy = true; this.set({ phase: 'reserving' });
    let result: Receipt | undefined;
    try {
      result = await this.client.reserve(kind, file, roomId, signal);
      this.active(generation, signal); this.set({ phase: 'uploading', receipt: result });
      result = await this.client.upload(result.assetId, file, signal);
      this.active(generation, signal); this.set({ phase: 'checking', receipt: result });
      await this.poll(result.assetId, generation, signal);
    } catch (error) {
      if (generation !== this.generation) return;
      if (signal.aborted || !this.client.lifetime.isCurrent()) { this.clear(); return; }
      // 401/403/404 remove private references. Other failures are uncertain, never replayed.
      if (error instanceof MediaError && [401, 403, 404].includes(error.status)) { this.set({ phase: 'failed' }); return; }
      this.set({ phase: 'uncertain', ...(result ? { receipt: result } : {}) });
    } finally { if (generation === this.generation) this.busy = false; }
    // No file is kept in instance state or browser storage after this operation.
  }
  async refresh(): Promise<void> {
    current(this.client.lifetime);
    if (this.busy || !this.state.receipt || !['pending', 'uncertain', 'ready'].includes(this.state.phase)) throw new MediaError('INVALID_STATE');
    const assetId = this.state.receipt.assetId;
    const generation = ++this.generation;
    this.operation = new AbortController();
    const signal = AbortSignal.any([this.operation.signal, this.client.lifetime.signal]);
    this.busy = true; this.set({ phase: 'checking', receipt: this.state.receipt });
    try { await this.poll(assetId, generation, signal); }
    catch (error) {
      if (generation !== this.generation) return;
      if (signal.aborted || !this.client.lifetime.isCurrent()) { this.clear(); return; }
      this.set(error instanceof MediaError && [401, 403, 404].includes(error.status)
        ? { phase: 'failed' } : { phase: 'uncertain', ...(this.state.receipt ? { receipt: this.state.receipt } : {}) });
    } finally { if (generation === this.generation) this.busy = false; }
  }
  readyAsset(kind?: ImageKind, roomId?: string): string {
    current(this.client.lifetime);
    if (kind && (this.intent?.kind !== kind || this.intent.roomId !== roomId)) throw new MediaError('INVALID_CONTEXT');
    if (this.state.phase !== 'ready' || this.state.receipt?.status !== 'ready') throw new MediaError('NOT_READY');
    return this.state.receipt.assetId;
  }
}
