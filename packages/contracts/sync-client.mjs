// Executable client contract, not a production persistence adapter. An IndexedDB/SQLite
// adapter must commit the cloned resource set AND cursor in one local transaction.
export class ReferenceRoomCache {
  constructor(cacheId) { this.reset(cacheId); }
  reset(cacheId) { this.state = { cacheId, cursor: null, messages: new Map() }; }
  transaction(cacheId, run, beforeCommit = () => {}) {
    if (cacheId !== this.state.cacheId) return false; // Old account/cache responses cannot merge.
    const next = structuredClone(this.state);
    run(next);
    beforeCommit(); // Fault fixture: a crash here must leave both data and cursor unchanged.
    this.state = next;
    return true;
  }
  put(next, message) {
    const prior = next.messages.get(message.id);
    if (prior && BigInt(prior.version) > BigInt(message.version)) return;
    // At equal version a prior tombstone wins over a late history response.
    if (prior?.deleted && BigInt(prior.version) === BigInt(message.version)) return;
    next.messages.set(message.id, { version: message.version, deleted: false, message: structuredClone(message) });
  }
  snapshot(cacheId, response) {
    if (response.resetRequired || this.state.cursor !== null) return false;
    return this.transaction(cacheId, next => {
      next.messages.clear();
      for (const message of response.messages) this.put(next, message);
      next.cursor = response.nextCursor;
    });
  }
  delta(cacheId, requestedCursor, response, beforeCommit) {
    if (response.resetRequired || requestedCursor !== this.state.cursor) return false; // Reset needs a new cacheId + snapshot.
    return this.transaction(cacheId, next => {
      for (const event of response.events) {
        if (event.type === 'message.upsert') this.put(next, event.message);
        else if (event.type === 'message.deleted') {
          const prior = next.messages.get(event.messageId);
          if (!prior || BigInt(prior.version) <= BigInt(event.version)) next.messages.set(event.messageId, { version: event.version, deleted: true });
        } else throw new Error('unsupported_event');
      }
      next.cursor = response.nextCursor;
    }, beforeCommit);
  }
  history(cacheId, response) {
    if (response.resetRequired) return false;
    return this.transaction(cacheId, next => { for (const message of response.messages) this.put(next, message); });
  }
  visible() { return [...this.state.messages.values()].filter(value => !value.deleted).map(value => structuredClone(value.message)); }
}

// One authoritative generation must finish before removing missing rooms/profiles.
// Objects replace fully: an omitted birthday is removed, never shallow-merged.
export class ReferenceManifest {
  constructor(cacheId) { this.current = new Map(); this.pending = null; this.cacheId = cacheId; }
  page(cacheId, response, kind) {
    if (cacheId !== this.cacheId) return false;
    if (response.resetRequired) { this.pending = null; return false; }
    if (!['rooms', 'profiles'].includes(kind)) throw new Error('unsupported_manifest');
    if (!this.pending || this.pending.generation !== response.generation) this.pending = { generation: response.generation, rows: new Map() };
    for (const value of response[kind]) this.pending.rows.set(value.roomId ?? value.actorId, structuredClone(value));
    if (!response.complete) return false;
    this.current = this.pending.rows; this.pending = null;
    return true;
  }
  clear(newCacheId) {
    if (!newCacheId || newCacheId === this.cacheId) throw new Error('new_cache_generation_required');
    this.cacheId = newCacheId; this.current.clear(); this.pending = null;
  }
}

export const syncPolicy = Object.freeze({ foregroundMs: 15000, jitterFraction: 0.2,
  pollingFallbackMs: 4000, hintCoalesceMs: 150,
  triggers: Object.freeze(['foreground', 'connect', 'reconnect', 'ack', 'sync.required']),
  socketServerDisconnect: 'reauthenticate_then_explicit_connect',
  onUnauthorized: 'clear_account_caches_and_stop', onReset: 'new_cache_id_and_replace_snapshot' });
