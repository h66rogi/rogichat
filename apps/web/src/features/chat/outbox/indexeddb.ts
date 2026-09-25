import type { OutboxPayload } from './model';
import type { Receipt } from '../contract';
import { applyAuthority, applyReceipt, emptyState, expire, insert, normalizeAuthority, normalizePayload, OutboxError, permitted, type OutboxAuthority, type OutboxRecord, type OutboxState } from './model';

export { OUTBOX_LIMITS, OutboxError, outboxSessionKey } from './model';
export type { OutboxAuthority, OutboxRecord, OutboxRoom } from './model';

/** Native IDB serializes records, while every authorized tab can send independently. */
export class DurableOutbox {
  private authorityEpoch: number | null = null;
  private generation = 0;
  private stopped = false;
  private locallySuspended = false;
  private authority: OutboxAuthority | null = null;
  private lastGrant: { authority: OutboxAuthority; epoch: number } | null = null;
  private preparedHere = new Set<string>();
  private lookup404 = new Set<string>();
  private readonly pending = new Set<IDBTransaction>();
  private readonly abort = new AbortController();
  private operationAbort = new AbortController();
  private readonly db: IDBDatabase;
  private readonly channel: BroadcastChannel | null;
  private readonly changeListeners = new Set<() => void>();
  private constructor(db: IDBDatabase, environment: string) {
    this.db = db;
    let channel: BroadcastChannel | null = null;
    try { if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(`rogichat-outbox-${environment}`); }
    catch { /* Polling and server wake-ups remain the source of truth. */ }
    this.channel = channel;
    if (channel) channel.onmessage = event => {
      if (event.data === 'changed' && !this.stopped) for (const listener of this.changeListeners) listener();
    };
    db.onversionchange = () => this.close();
    db.onclose = () => this.close();
    if (typeof window !== 'undefined') {
      const options = { signal: this.abort.signal };
      window.addEventListener('pagehide', () => this.suspend(), options);
      window.addEventListener('pageshow', event => { if (event.persisted) this.suspend(); }, options);
      document.addEventListener('freeze', () => this.suspend(), options);
    }
  }
  /** Abort in-flight transport as soon as this tab loses its local authority. */
  get signal(): AbortSignal { return this.operationAbort.signal; }
  get closed(): boolean { return this.stopped; }
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => { this.changeListeners.delete(listener); };
  }
  private announceChange() { try { this.channel?.postMessage('changed'); } catch { /* Server sync still converges. */ } }
  /** Logout must erase the captured session even after every chat controller unmounts. */
  static async revokeSession(environment: string, accountPartition: string, sessionKey: string): Promise<void> {
    const identity = normalizeAuthority({ accountPartition, sessionKey, rooms: [] });
    const outbox = await DurableOutbox.open(environment);
    try {
      const stored = outbox.lastGrant?.authority;
      // A delayed old-session logout must never erase the successor's new commands.
      if (stored?.accountPartition === identity.accountPartition && stored.sessionKey === identity.sessionKey) await outbox.revoke();
    } finally { outbox.close(); }
  }
  /** Compact pending-deletion markers carry only the environment-bound session digest. */
  static async revokeSessionKey(environment: string, sessionKey: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(sessionKey)) throw new OutboxError('INVALID_COMMAND');
    const outbox = await DurableOutbox.open(environment);
    try {
      if (outbox.lastGrant?.authority.sessionKey === sessionKey) await outbox.revoke();
    } finally { outbox.close(); }
  }
  static open(environment: string): Promise<DurableOutbox> {
    if (!/^[a-z0-9-]{1,32}$/.test(environment)) return Promise.reject(new OutboxError('INVALID_COMMAND'));
    return new Promise((resolve, reject) => {
      let failed = false;
      let request: IDBOpenDBRequest;
      try { request = indexedDB.open(`rogichat-outbox-${environment}`, 1); }
      catch { reject(new OutboxError('STORAGE_FAILED')); return; }
      request.onupgradeneeded = event => {
        if (event.oldVersion !== 0) { request.transaction?.abort(); return; }
        request.result.createObjectStore('state').put(emptyState(), 'singleton');
      };
      request.onblocked = () => { failed = true; reject(new OutboxError('UPDATE_REQUIRED')); };
      request.onerror = () => reject(new OutboxError(request.error?.name === 'VersionError' ? 'UPDATE_REQUIRED' : 'STORAGE_FAILED'));
      request.onsuccess = () => {
        if (failed) { request.result.close(); return; }
        const outbox = new DurableOutbox(request.result, environment);
        // Observe only an erasure fence, never unlock or expose persisted authority/content.
        void outbox.transaction(state => {
          expire(state, Date.now());
          return state.authority ? { authority: state.authority, epoch: state.authorityEpoch } : null;
        }).then(grant => { outbox.lastGrant = grant; resolve(outbox); }, error => { outbox.close(); reject(error); });
      };
    });
  }
  private transaction<T>(work: (state: OutboxState) => T, generation = this.generation): Promise<T> {
    if (this.stopped || generation !== this.generation) return Promise.reject(new OutboxError('LOCKED'));
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try { tx = this.db.transaction('state', 'readwrite'); }
      catch { reject(new OutboxError('STORAGE_FAILED')); return; }
      this.pending.add(tx);
      let result: T; let error: unknown;
      const request = tx.objectStore('state').get('singleton');
      request.onsuccess = () => {
        try {
          if (this.stopped || generation !== this.generation) throw new OutboxError('LOCKED');
          const state = request.result as OutboxState | undefined;
          // An evicted/corrupt store is never recreated by an active connection.
          if (!state || state.schema !== 1 || !Number.isSafeInteger(state.fence) || !Number.isSafeInteger(state.authorityEpoch) || !Array.isArray(state.records)) throw new OutboxError('UPDATE_REQUIRED');
          result = structuredClone(work(state));
          tx.objectStore('state').put(state, 'singleton');
        } catch (caught) { error = caught; tx.abort(); }
      };
      tx.oncomplete = () => {
        this.pending.delete(tx);
        if (this.stopped || generation !== this.generation) reject(new OutboxError('LOCKED'));
        else resolve(result);
      };
      tx.onabort = tx.onerror = () => {
        this.pending.delete(tx);
        reject(error instanceof OutboxError ? error : new OutboxError('STORAGE_FAILED'));
      };
    });
  }
  private guard(state: OutboxState) {
    if (!this.authority || this.authorityEpoch === null) throw new OutboxError('LOCKED');
    if (state.authorityEpoch !== this.authorityEpoch || JSON.stringify(state.authority) !== JSON.stringify(this.authority)) {
      this.operationAbort.abort(); this.authority = null; this.authorityEpoch = null; this.preparedHere.clear(); this.lookup404.clear(); throw new OutboxError('AUTHORITY_CHANGED');
    }
    expire(state, Date.now());
  }
  /** Call only after genuine session + COMPLETE manifest + room authorization. Never from stored state. */
  async authorize(value: OutboxAuthority): Promise<void> {
    const authority = normalizeAuthority(value);
    this.locallySuspended = false;
    // A routine refresh never interrupts an in-flight command in this tab.
    if (this.authorityEpoch !== null && this.authority && JSON.stringify(this.authority) === JSON.stringify(authority)) {
      try { await this.assertCurrent(); return; }
      catch (error) { if (!(error instanceof OutboxError) || error.code !== 'AUTHORITY_CHANGED') throw error; }
    }
    const generation = ++this.generation;
    this.operationAbort.abort(); this.operationAbort = new AbortController();
    this.authority = null; this.authorityEpoch = null; this.preparedHere.clear(); this.lookup404.clear();
    const grant = await this.transaction(state => {
      const now = Date.now();
      const changed = JSON.stringify(state.authority) !== JSON.stringify(authority);
      if (changed) {
        if (state.authorityEpoch >= Number.MAX_SAFE_INTEGER) throw new OutboxError('UPDATE_REQUIRED');
        state.authorityEpoch++;
      }
      applyAuthority(state, authority, now);
      // Recovery always looks up the receipt first. Do not change another tab's
      // unattempted command while it is between prepare() and beforeSend().
      return { epoch: state.authorityEpoch, changed };
    }, generation);
    if (generation !== this.generation) throw new OutboxError('LOCKED');
    this.authorityEpoch = grant.epoch; this.authority = authority; this.lastGrant = { authority, epoch: grant.epoch };
    if (grant.changed) this.announceChange();
  }
  async assertCurrent(): Promise<void> { await this.transaction(state => { this.guard(state); }); }
  async prepare(roomId: string, value: OutboxPayload): Promise<OutboxRecord> {
    const payload = normalizePayload(value);
    const { record, created } = await this.transaction(state => {
      this.guard(state);
      const created = !state.records.some(record => record.clientMessageId === payload.clientMessageId);
      return { record: insert(state, roomId, payload, Date.now()), created };
    });
    if (created) this.preparedHere.add(payload.clientMessageId);
    return record;
  }
  async recover(roomId: string): Promise<OutboxRecord[]> {
    return this.transaction(state => {
      this.guard(state);
      if (!this.authority!.rooms.some(room => room.roomId === roomId)) throw new OutboxError('LOCKED');
      return state.records.filter(record => record.roomId === roomId && record.accountPartition === this.authority!.accountPartition)
        .map(record => {
          const safe = { ...record };
          if (!permitted(record, this.authority!)) { delete safe.payload; if (safe.result?.status !== 'deleted') delete safe.result; }
          return safe;
        });
    });
  }
  private record(state: OutboxState, id: string): OutboxRecord {
    this.guard(state);
    const record = state.records.find(record => record.clientMessageId === id);
    if (!record || record.accountPartition !== this.authority!.accountPartition || !this.authority!.rooms.some(room => room.roomId === record.roomId)) throw new OutboxError('READ_ONLY');
    return record;
  }
  async beforeLookup(id: string): Promise<void> { await this.transaction(state => { this.record(state, id); }); }
  /** Only call following an actual same-command GET 404 and current session verification. */
  async lookupNotFound(id: string): Promise<void> {
    const generation = this.generation;
    await this.beforeLookup(id);
    if (generation !== this.generation) throw new OutboxError('LOCKED');
    this.lookup404.add(id);
  }
  async beforeSend(id: string, explicitRetry = false): Promise<OutboxPayload> {
    const payload = await this.transaction(state => {
      const record = this.record(state, id);
      if (!record.payload || record.result || !permitted(record, this.authority!)) throw new OutboxError('READ_ONLY');
      if (!this.preparedHere.has(id) && !(explicitRetry && this.lookup404.has(id))) throw new OutboxError('RECEIPT_FIRST');
      this.lookup404.delete(id); record.attempted = true;
      return record.payload;
    });
    this.preparedHere.delete(id);
    return normalizePayload(payload);
  }
  async settle(value: Receipt): Promise<void> {
    await this.transaction(state => { applyReceipt(this.record(state, value.clientMessageId), value); });
    this.preparedHere.delete(value.clientMessageId);
    this.lookup404.delete(value.clientMessageId);
    this.announceChange();
  }
  /** Scope/quote/capability loss scrubs payload without reminting or retaining a private projection. */
  async quarantine(ids?: readonly string[]): Promise<void> {
    await this.transaction(state => {
      this.guard(state);
      for (const record of state.records) if (!ids || ids.includes(record.clientMessageId)) { delete record.payload; if (record.result?.status !== 'deleted') delete record.result; }
    });
    if (!ids) this.preparedHere.clear(); else for (const id of ids) this.preparedHere.delete(id);
  }
  suspend(): void {
    if (this.locallySuspended || this.stopped) return;
    this.locallySuspended = true;
    this.generation++; this.authority = null; this.authorityEpoch = null; this.preparedHere.clear(); this.lookup404.clear(); this.operationAbort.abort();
    for (const tx of this.pending) { try { tx.abort(); } catch { /* A committed transaction needs no abort. */ } }
  }
  /** Confirmed account/session loss. Fence every tab before erasing all persisted content. */
  async revoke(): Promise<void> {
    const grant = this.lastGrant;
    this.suspend();
    const revoked = await this.transaction(state => {
      // A stale logout completion cannot erase a successor session's new input.
      if (!grant || state.authorityEpoch !== grant.epoch || JSON.stringify(state.authority) !== JSON.stringify(grant.authority)) return false;
      if (state.authorityEpoch >= Number.MAX_SAFE_INTEGER) throw new OutboxError('UPDATE_REQUIRED');
      state.authorityEpoch++; state.authority = null;
      for (const record of state.records) { delete record.payload; if (record.result?.status !== 'deleted') delete record.result; }
      return true;
    });
    if (this.lastGrant === grant) this.lastGrant = null;
    if (revoked) this.announceChange();
  }
  close(): void {
    if (this.stopped) return;
    this.suspend(); this.stopped = true; this.abort.abort(); this.changeListeners.clear(); this.channel?.close(); this.db.close();
  }
}
