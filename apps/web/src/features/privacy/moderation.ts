import { ApiError, type Session } from '../../core/api/client';
import { exact, uuid, type ServerMessage } from '../chat/contract';
import type { PrivacyClient } from './client';
import { accountBinding, type MarkerStore } from './deletion';
import { reportInput, type ReportInput, type ReportReceipt, type ReportReason, type BlockPage } from './moderation-contract';

export const REPORT_PENDING = 'rogichat.report-pending.v1';
export interface ReportMarker { key: string; account: string }
export function readReport(store: MarkerStore): ReportMarker | null {
  const raw = store.getItem(REPORT_PENDING);
  if (raw === null) return null;
  const data = exact(JSON.parse(raw), ['key', 'account']);
  if (typeof data.account !== 'string' || !/^[a-f0-9]{64}$/.test(data.account)) throw new Error('INVALID_MARKER');
  return { key: uuid(data.key), account: data.account };
}
export function blockTarget(message: ServerMessage, selfActor: string): string | null {
  return message.author.kind === 'member' && message.author.actorId !== selfActor ? message.author.actorId : null;
}
export type ReportState = 'idle' | 'sending' | 'unknown' | 'missing' | 'differentAccount' | 'pendingExisting' | 'storageError' | 'received' | 'resolved' | 'dismissed';
export class ReportFlow {
  state: ReportState = 'idle';
  private active = new AbortController();
  private disposed = false;
  private busy = false;
  private input: ReportInput | null = null;
  private target: string | null = null;
  private marker: ReportMarker | null = null;
  private observedRaw: string | null = null;
  private api: PrivacyClient; private store: MarkerStore; private session: Session;
  private changed: (state: ReportState) => void;
  constructor(api: PrivacyClient, store: MarkerStore, session: Session, changed: (state: ReportState) => void) { this.api = api; this.store = store; this.session = session; this.changed = changed; }
  private set(state: ReportState) { if (!this.disposed) { this.state = state; this.changed(state); } }
  dispose() { this.disposed = true; this.active.abort(); this.input = null; this.marker = null; this.target = null; }
  dismiss(): boolean {
    if (this.disposed || this.busy || this.observedRaw === null || !['missing', 'differentAccount', 'storageError'].includes(this.state)) return false;
    try { this.active.signal.throwIfAborted(); if (this.store.getItem(REPORT_PENDING) !== this.observedRaw) return false; this.store.removeItem(REPORT_PENDING); this.input = null; this.marker = null; this.observedRaw = null; this.set('idle'); return true; }
    catch { this.set('unknown'); return false; }
  }
  private current() {
    this.active.signal.throwIfAborted();
    if (this.marker && readReport(this.store)?.key !== this.marker.key) throw new Error('SUPERSEDED');
  }
  private async verify() {
    const session = await this.api.session(this.active.signal); this.active.signal.throwIfAborted();
    if (session.accountPartition !== this.session.accountPartition || session.csrfToken !== this.session.csrfToken) throw new Error('SESSION_CHANGED');
    return session;
  }
  private accept(receipt: ReportReceipt) {
    this.current();
    if (this.marker && readReport(this.store)?.key === this.marker.key) this.store.removeItem(REPORT_PENDING);
    this.input = null; this.set(receipt.status);
  }
  async submit(roomId: string, messageId: string, reason: ReportReason, detail: string): Promise<void> {
    if (this.busy || this.disposed || this.state !== 'idle') return;
    this.busy = true; this.set('sending');
    let sent = false;
    try {
      if (readReport(this.store)) { this.set('pendingExisting'); return; }
      const input = reportInput({ idempotencyKey: crypto.randomUUID(), reason, ...(detail ? { detail } : {}) });
      const session = await this.verify();
      const account = await accountBinding(this.api.origin, session.accountPartition); this.active.signal.throwIfAborted();
      if (readReport(this.store)) { this.set('pendingExisting'); return; }
      this.marker = { key: input.idempotencyKey, account }; this.input = input; this.target = JSON.stringify([roomId, messageId]);
      this.store.setItem(REPORT_PENDING, JSON.stringify(this.marker)); this.current(); sent = true;
      const receipt = await this.api.report(roomId, messageId, input, session.csrfToken, this.active.signal);
      await this.verify(); this.accept(receipt);
    } catch { this.set(sent ? 'unknown' : 'storageError'); }
    finally { this.busy = false; }
  }
  async recover(): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true;
    try {
      let marker: ReportMarker | null;
      try { this.observedRaw = this.store.getItem(REPORT_PENDING); marker = readReport(this.store); }
      catch { this.set('storageError'); return; }
      if (!marker) { this.set('idle'); return; }
      if (this.input?.idempotencyKey !== marker.key) { this.input = null; this.target = null; }
      this.marker = marker;
      const current = await this.verify();
      const account = await accountBinding(this.api.origin, current.accountPartition); this.active.signal.throwIfAborted();
      if (account !== marker.account) { this.set('differentAccount'); return; }
      this.current();
      const receipt = await this.api.reportByKey(marker.key, this.active.signal);
      await this.verify(); this.accept(receipt);
    } catch (error) { this.set(error instanceof ApiError && error.status === 404 ? 'missing' : 'unknown'); }
    finally { this.busy = false; }
  }
  get canRetry() { return this.state === 'missing' && this.input !== null && this.input.idempotencyKey === this.marker?.key; }
  /** Only after own receipt GET 404, exact memory-only original request. */
  async retry(roomId: string, messageId: string): Promise<void> {
    if (!this.canRetry || this.busy || this.disposed || this.target !== JSON.stringify([roomId, messageId])) return;
    this.busy = true; this.set('sending');
    try { const session = await this.verify(); this.current(); const receipt = await this.api.report(roomId, messageId, this.input!, session.csrfToken, this.active.signal); await this.verify(); this.accept(receipt); }
    catch { this.set('unknown'); }
    finally { this.busy = false; }
  }
}

export type BlockState = 'idle' | 'checking' | 'blocked' | 'unblocked' | 'unknown';
export class BlockFlow {
  private active = new AbortController(); private disposed = false; private busy = false;
  private api: PrivacyClient; private session: Session; private changed: (state: BlockState) => void; private reset: () => void;
  constructor(api: PrivacyClient, session: Session, changed: (state: BlockState) => void, reset: () => void) { this.api = api; this.session = session; this.changed = changed; this.reset = reset; }
  dispose() { this.disposed = true; this.active.abort(); }
  private async verify() {
    const current = await this.api.session(this.active.signal); this.active.signal.throwIfAborted();
    if (current.csrfToken !== this.session.csrfToken || current.accountPartition !== this.session.accountPartition) throw new Error('SESSION_CHANGED');
  }
  async list(room: string, after: string | null): Promise<BlockPage> {
    await this.verify(); const page = await this.api.blocks(room, after, this.active.signal); await this.verify(); return page;
  }
  async change(room: string, actor: string, blocked: boolean): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true; this.changed('checking'); let sent = false;
    try { await this.verify(); sent = true; await this.api.block(room, actor, blocked, this.session.csrfToken, this.active.signal); await this.verify(); if (!this.disposed) this.changed(blocked ? 'blocked' : 'unblocked'); }
    catch { if (!this.disposed) this.changed('unknown'); }
    finally {
      this.busy = false;
      if (sent && !this.disposed) {
        // A lost ACK still requires scope reconciliation, but never reset a
        // successor account using this old control's callback.
        try { await this.verify(); if (!this.disposed) this.reset(); } catch { /* Parent session gate owns the new session. */ }
      }
    }
  }
}
