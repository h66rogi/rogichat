import { ApiError, type Session } from '../../core/api/client';
import { exact } from '../chat/contract';
import type { PrivacyClient } from './client';

export const DELETION_PENDING = 'rogichat.account-deletion.v1';
export const ACCOUNT_DELETION_PENDING = DELETION_PENDING;
export const PRIVACY_CHANGED = 'rogichat-privacy-changed';
export type DeletionPhase = 'unknown' | 'reauth' | 'blocked';
export interface DeletionMarker { version: 1; operation: string; account: string; phase: DeletionPhase; auth?: string }
export interface MarkerStore { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
/** Accessing window.localStorage itself can throw; defer it into guarded operations. */
export const browserPrivacyStore: MarkerStore = {
  getItem: key => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: key => window.localStorage.removeItem(key),
};
export function isAccountDeletionPending(store: MarkerStore): boolean {
  try { return store.getItem(DELETION_PENDING) !== null; } catch { return true; }
}
export async function accountBinding(origin: string, accountPartition: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`account-deletion:v1:${origin}:${accountPartition}`));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function readDeletion(store: MarkerStore): DeletionMarker | null {
  const raw = store.getItem(DELETION_PENDING);
  if (raw === null) return null;
  const data = exact(JSON.parse(raw), ['version', 'operation', 'account', 'phase'], ['auth']);
  if (data.version !== 1 || typeof data.operation !== 'string' || !/^[0-9a-f-]{36}$/.test(data.operation) || typeof data.account !== 'string' || !/^[a-f0-9]{64}$/.test(data.account) || !['unknown', 'reauth', 'blocked'].includes(String(data.phase))) throw new Error('INVALID_MARKER');
  if ('auth' in data && (typeof data.auth !== 'string' || !/^[a-f0-9]{64}$/.test(data.auth))) throw new Error('INVALID_MARKER');
  return data as unknown as DeletionMarker;
}
export function updateDeletion(store: MarkerStore, marker: DeletionMarker, phase: DeletionPhase): boolean {
  if (readDeletion(store)?.operation !== marker.operation) return false;
  store.setItem(DELETION_PENDING, JSON.stringify({ ...marker, phase })); return true;
}
export function clearDeletion(store: MarkerStore, operation: string): boolean {
  if (readDeletion(store)?.operation !== operation) return false;
  store.removeItem(DELETION_PENDING); return true;
}
export type DeletionState = 'idle' | 'checking' | 'sending' | 'reauth' | 'unknown' | 'unavailable' | 'blocked' | 'differentAccount' | 'ready' | 'storageError';
export class DeletionFlow {
  state: DeletionState = 'idle';
  private active = new AbortController();
  private busy = false;
  private disposed = false;
  private observedRaw: string | null = null;
  private readonly api: PrivacyClient;
  private readonly store: MarkerStore;
  private readonly changed: (state: DeletionState) => void;
  private readonly onBlocked: () => void;
  constructor(api: PrivacyClient, store: MarkerStore, changed: (state: DeletionState) => void, onBlocked: () => void) {
    this.api = api; this.store = store; this.changed = changed; this.onBlocked = onBlocked;
  }
  private set(state: DeletionState) { if (!this.disposed) { this.state = state; this.changed(state); } }
  dispose() { this.disposed = true; this.active.abort(); }
  dismiss(): boolean {
    if (this.disposed || this.busy || this.observedRaw === null) return false;
    try {
      if (this.store.getItem(DELETION_PENDING) !== this.observedRaw) return false;
      this.store.removeItem(DELETION_PENDING); this.observedRaw = null; return true;
    } catch { this.set('storageError'); return false; }
  }
  private current(marker?: DeletionMarker) {
    this.active.signal.throwIfAborted();
    if (marker && readDeletion(this.store)?.operation !== marker.operation) throw new Error('SUPERSEDED');
  }
  /** Read-only recovery never sends deletion, including after login or 401. */
  async recover(): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true; this.set('checking');
    try {
      let marker: DeletionMarker | null;
      try { this.observedRaw = this.store.getItem(DELETION_PENDING); marker = readDeletion(this.store); }
      catch { this.set('storageError'); return; }
      if (!marker) { this.set('idle'); return; }
      if (marker.phase === 'blocked') { this.set('blocked'); return; }
      const session = await this.api.session(this.active.signal);
      const binding = await accountBinding(this.api.origin, session.accountPartition);
      const auth = await accountBinding(`${this.api.origin}:session`, session.csrfToken); this.current(marker);
      this.set(binding !== marker.account ? 'differentAccount' : marker.phase === 'reauth' && marker.auth === auth ? 'reauth' : 'ready');
    } catch { this.set('unknown'); }
    finally { this.busy = false; }
  }
  async retry(): Promise<void> {
    if (this.busy || this.disposed || this.state !== 'ready') return;
    this.busy = true;
    let session: Session;
    try { session = await this.api.session(this.active.signal); this.current(); }
    catch { this.set('unknown'); return; }
    finally { this.busy = false; }
    await this.submit(session);
  }
  /** Explicit user confirmation only. Re-reads account and exact session before mutation. */
  async submit(expected: Session): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true; this.set('checking');
    let marker: DeletionMarker | null = null;
    let dispatched = false;
    try {
      const account = await accountBinding(this.api.origin, expected.accountPartition); this.current();
      const auth = await accountBinding(`${this.api.origin}:session`, expected.csrfToken); this.current();
      marker = readDeletion(this.store);
      if (marker?.phase === 'blocked') { this.set('blocked'); return; }
      if (marker && marker.account !== account) { this.set('differentAccount'); return; }
      const session = await this.api.session(this.active.signal); this.current(marker ?? undefined);
      if (session.accountPartition !== expected.accountPartition || session.csrfToken !== expected.csrfToken) { this.set('differentAccount'); return; }
      if (!marker) {
        marker = { version: 1, operation: crypto.randomUUID(), account, phase: 'unknown', auth };
        this.store.setItem(DELETION_PENDING, JSON.stringify(marker));
      } else {
        marker = { ...marker, auth };
        if (!updateDeletion(this.store, marker, 'unknown')) { this.set('unknown'); return; }
      }
      this.current(marker); this.set('sending');
      dispatched = true;
      await this.api.deleteAccount(session.csrfToken, this.active.signal); this.current(marker);
      // The verified receipt proves access blocked only; physical deletion is separate.
      // Cleanup must occur even if writing the updated recovery marker fails.
      try { updateDeletion(this.store, marker, 'blocked'); }
      finally {
        try { this.observedRaw = this.store.getItem(DELETION_PENDING); } catch { /* Existing unknown marker remains fail closed. */ }
        this.set('blocked'); this.onBlocked();
      }
    } catch (error) {
      if (this.state === 'blocked') return;
      if (!marker || !dispatched) { this.set('storageError'); return; }
      if (error instanceof ApiError && error.code === 'RECENT_AUTH_REQUIRED') {
        try { updateDeletion(this.store, marker, 'reauth'); } catch { /* Existing unknown marker is conservative. */ }
        this.set('reauth');
      } else this.set(error instanceof ApiError && error.status === 503 ? 'unavailable' : 'unknown');
    } finally { this.busy = false; }
  }
  async login(): Promise<string | null> {
    if (this.busy || this.disposed) return null;
    this.busy = true;
    try {
      const marker = readDeletion(this.store);
      if (!marker || marker.phase === 'blocked') return null;
      const url = await this.api.login(this.active.signal); this.current(marker); return url;
    } catch { this.set('unknown'); return null; }
    finally { this.busy = false; }
  }
}
