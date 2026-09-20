import { current, MediaError, uuid, type Sticker } from './contracts';
import type { MediaClient } from './client';

export interface CatalogState { phase: 'empty' | 'loading' | 'ready' | 'error'; items: readonly Sticker[]; next: string | null; selected: Sticker | null }
const empty = (): CatalogState => ({ phase: 'empty', items: [], next: null, selected: null });
/** One server page (at most 50 references), one explicit selection, no invented catalog or prefetch. */
export class StickerCatalog {
  private state = empty(); private generation = 0;
  private readonly listeners = new Set<() => void>();
  private operation: AbortController | undefined;
  private readonly client: MediaClient;
  private readonly roomId: string;
  get lifetime() { return this.client.lifetime; }
  constructor(client: MediaClient, roomId: string) {
    this.client = client; this.roomId = uuid(roomId);
    client.lifetime.signal.addEventListener('abort', this.clear, { once: true });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(state: CatalogState) { this.state = state; this.listeners.forEach(listener => listener()); }
  clear = () => { this.generation++; this.operation?.abort(); this.operation = undefined; this.set(empty()); };
  dispose = () => { this.clear(); this.client.lifetime.signal.removeEventListener('abort', this.clear); this.listeners.clear(); };
  load = async (after?: string): Promise<void> => {
    this.clear(); const generation = this.generation;
    const operation = new AbortController(); this.operation = operation;
    this.set({ ...empty(), phase: 'loading' });
    try {
      current(this.lifetime);
      const page = await this.client.stickers(this.roomId, after, operation.signal);
      if (after && page.nextCursor === after) throw new MediaError('INVALID_RESPONSE');
      current(this.lifetime); operation.signal.throwIfAborted();
      if (generation !== this.generation) return;
      this.set({ phase: 'ready', items: page.items, next: page.nextCursor, selected: null });
    } catch {
      if (generation !== this.generation) return;
      this.set({ ...empty(), phase: 'error' });
    }
  };
  select(id: string): void {
    current(this.lifetime);
    const selected = this.state.phase === 'ready' ? this.state.items.find(item => item.id === id) : undefined;
    if (!selected) throw new MediaError('INVALID_STICKER');
    this.set({ ...this.state, selected });
  }
  readySticker(roomId: string): string {
    current(this.lifetime);
    if (roomId !== this.roomId || this.state.phase !== 'ready' || !this.state.selected) throw new MediaError('INVALID_STICKER');
    return this.state.selected.id;
  }
}
