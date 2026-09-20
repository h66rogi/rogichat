import { ChatMemory, authorityKey, MAX_PARKED_BYTES, MAX_PARKED_DRAFTS } from './chat-memory';
import type { ChatDrafts } from './drafts';
import { truncateExcerpt } from './formatters';
import { type PendingCommand, type UnknownCommand } from './commands';
import { reactionSummary, type ReactionState } from './reactions';
import { actor, cursor, envelope, event, exact, list, membership, mergeMessages, message, projectMessages, receipt, record, string, token, uuid } from './contract';
import type { ChatRequest, RoomMembership, ServerMessage, SyncKind, Receipt } from './contract';
import type { ChatActorRef, ChatComposerTarget, ChatComposerSubmission, ChatSubmitResult, ChatTimelineItem } from './types';

export interface ChatState {
  commands: { id: string; canRetry: boolean }[]; commandBusy: boolean;
  reactions: Record<string, ReactionState>; reactionRevision: number;
  phase: 'loading' | 'ready' | 'error'; notice: string | null; epoch: number; room: RoomMembership | null;
  profiles: ChatActorRef[]; recipients: ChatActorRef[]; items: ChatTimelineItem[]; hasOlder: boolean; loadingOlder: boolean; error: string | null;
}
const initial = (): ChatState => ({ commands: [], commandBusy: false, reactions: {}, reactionRevision: 0, phase: 'loading', notice: null, epoch: 0, room: null, profiles: [], recipients: [], items: [], hasOlder: false, loadingOlder: false, error: null });
const inaccessible = (error: unknown) => [401, 403, 404].includes(Number(recordError(error).status));
function recordError(error: unknown): { status?: unknown; code?: unknown } { return error !== null && typeof error === 'object' ? error : {}; }
class ResetRequired extends Error {}
const differentHints = (a: ServerMessage, b: ServerMessage) => JSON.stringify([a.counterpart, a.allowedActions]) !== JSON.stringify([b.counterpart, b.allowedActions]);

/** Ephemeral, per-mount cache. No browser persistence; every request is bounded by one access epoch. */
export class ChatController {
  private state = initial();
  private listeners = new Set<() => void>();
  private abort = new AbortController();
  private disposed = false;
  private readonly memory: ChatMemory;
  private readonly lease: number;
  private readonly retainMemory: boolean;
  private get dead() { return this.disposed || this.lease !== this.memory.lease; }
  private flight: Promise<void> | null = null;
  private messages: ServerMessage[] = [];
  private eventCursor: string | null = null;
  private historyCursor: string | null = null;
  private manifestGeneration: string | null = null;
  private profileGeneration: string | null = null;
  private recipientBinding: string | null = null;
  private readonly deviceId = crypto.randomUUID();
  private cacheId = crypto.randomUUID();
  private get commands() { return this.memory.commands; }
  private tombstones = new Map<string, { version: string; createdAt?: string }>();
  private scope: RoomMembership | null = null;
  private projectionGeneration = 0;
  private accountPartition: string | undefined;
  private sessionBinding: string | undefined;
  private sending = false;
  private deleting = false;
  private reactionFlights = new Set<string>();
  private reactionCooldown = 0;
  private readonly roomId: string;
  private readonly request: ChatRequest;
  private readonly onInvalidate: (() => void) | undefined;
  constructor(roomId: string, request: ChatRequest, onInvalidate?: () => void, csrfToken?: string, accountPartition?: string, memory?: ChatMemory) {
    this.memory = memory ?? new ChatMemory(); this.retainMemory = memory !== undefined; this.lease = this.memory.activate();
    this.state = { ...initial(), epoch: this.memory.epoch, notice: this.memory.expired ? '오래 보관된 초안은 삭제되었습니다. 미확인 전송은 결과만 조회할 수 있습니다.' : null };
    this.roomId = roomId; this.request = request; this.onInvalidate = onInvalidate; this.accountPartition = accountPartition; this.sessionBinding = csrfToken;
  }
  getSnapshot = (): ChatState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<ChatState>) {
    if (this.dead) return;
    this.state = { ...this.state, ...patch, epoch: this.memory.epoch };
    this.state.commands = this.commands.pending().map(command => ({ id: command.clientMessageId, canRetry: this.commandAuthorized(command) }));
    this.state.commandBusy = this.sending;
    if (patch.items) this.state.reactions = Object.fromEntries(Object.entries(this.state.reactions).filter(([id, value]) => this.messages.some(message => message.id === id && message.version === value.version)));
    for (const listener of this.listeners) listener();
  }
  private clear(forgetAttempts = false, preserveComposer = false) {
    this.abort.abort(); this.abort = new AbortController(); this.cacheId = crypto.randomUUID();
    this.reactionFlights = new Set(); this.reactionCooldown = 0;
    this.messages = []; this.tombstones.clear(); this.scope = null; this.projectionGeneration++; this.eventCursor = null; this.historyCursor = null;
    this.manifestGeneration = null; this.profileGeneration = null; this.recipientBinding = null;
    if (forgetAttempts) this.memory.clearAll(); else if (!preserveComposer) this.memory.clearComposer();
    this.publish({ ...initial(), epoch: this.memory.epoch });
  }
  private clearAfterError(error: unknown) {
    const status = Number(recordError(error).status);
    if (status === 403 || status === 404) { this.memory.scrubAccess(); this.clear(false, true); }
    else this.clear(status === 401, status !== 401);
  }
  dispose() { if (!this.dead) { this.clear(!this.retainMemory, this.retainMemory); if (this.retainMemory) this.memory.park(); else this.memory.lease++; } this.disposed = true; this.abort.abort(); this.listeners.clear(); }
  getComposer = () => ({ drafts: structuredClone(this.memory.drafts), target: structuredClone(this.memory.target) });
  saveComposer = (drafts: ChatDrafts, target: ChatComposerTarget | null, epoch: number) => {
    if (!this.dead && this.state.phase === 'ready' && epoch === this.memory.epoch) {
      if (Object.keys(drafts).length > MAX_PARKED_DRAFTS || new TextEncoder().encode(JSON.stringify(drafts)).length > MAX_PARKED_BYTES) {
        this.memory.drafts = {}; this.memory.target = null;
        this.publish({ notice: '초안 임시 보관 한도를 넘었습니다. 화면을 떠나기 전에 내용을 정리해 주세요.' }); return;
      }
      const parked = structuredClone(drafts);
      if (this.sending) for (const [key, draft] of Object.entries(parked)) {
        const prior = this.memory.drafts[key];
        if (!draft.retryCommandId && prior?.retryCommandId && prior.body === draft.body && prior.quote?.messageId === draft.quote?.messageId) draft.retryCommandId = prior.retryCommandId;
      }
      this.memory.drafts = parked; this.memory.target = structuredClone(target);
      for (const draft of Object.values(drafts)) { const item = this.messages.find(item => item.id === draft.quote?.messageId); if (item) this.memory.hints.set(item.id, { createdAt: item.createdAt, version: item.version, counterpart: item.counterpart, allowedActions: item.allowedActions }); }
      const quoted = new Set(Object.values(drafts).flatMap(draft => draft.quote ? [draft.quote.messageId] : []));
      for (const id of this.memory.hints.keys()) { if (this.memory.hints.size <= 544) break; if (!quoted.has(id)) this.memory.hints.delete(id); }
    }
  };
  private invalidateComposer() { this.memory.clearComposer(); this.publish({ epoch: this.memory.epoch, reactions: {}, items: [] }); }
  private async get(path: string, kind: SyncKind, from?: string | null): Promise<Record<string, unknown>> {
    const query = new URLSearchParams({ deviceId: this.deviceId, cacheId: this.cacheId, limit: '100' });
    if (from) query.set('cursor', from);
    const signal = this.abort.signal;
    const data = envelope(await this.request(`${path}?${query}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }), kind);
    if (signal.aborted || this.dead) throw new DOMException('Aborted', 'AbortError');
    if (data.resetRequired) throw new ResetRequired();
    if (kind !== 'manifest' && (!this.scope || data.membershipScope !== this.scope.membershipScope || data.authorizationRevision !== this.scope.authorizationRevision)) throw new ResetRequired();
    return data;
  }
  private path(action: string) { return `/v1/rooms/${encodeURIComponent(this.roomId)}/${action}`; }
  private async verifySession() {
    const signal = this.abort.signal;
    const session = exact(await this.request('/v1/auth/session', { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }), ['authenticated', 'soopLinkStatus', 'csrfToken', 'accountPartition']);
    if (signal.aborted || this.dead) throw new DOMException('Aborted', 'AbortError');
    token(session.accountPartition); string(session.csrfToken);
    if (session.authenticated !== true || session.soopLinkStatus !== 'VERIFIED' || (this.sessionBinding !== undefined && session.csrfToken !== this.sessionBinding) || (this.accountPartition !== undefined && session.accountPartition !== this.accountPartition)) throw Object.assign(new Error('SESSION_CHANGED'), { status: 401 });
    this.sessionBinding = string(session.csrfToken); this.accountPartition = token(session.accountPartition);
  }
  private async authorization() {
    const authorizationSignal = this.abort.signal;
    const guard = () => { if (this.dead || authorizationSignal.aborted) throw new DOMException('Aborted', 'AbortError'); };
    await this.verifySession(); guard();
    let next: string | null = null; let found: RoomMembership | null = null; let generation: string | null = null;
    const manifestCursors = new Set<string>(); const roomIds = new Set<string>();
    do {
      const page = await this.get('/v1/sync', 'manifest', next); guard(); const current = string(page.generation);
      if (generation && generation !== current) throw new ResetRequired();
      generation = current;
      for (const value of list(page.rooms)) { const id = uuid(record(value).roomId); if (roomIds.has(id)) throw new Error('INVALID_RESPONSE'); roomIds.add(id); if (id === this.roomId) found = membership(value); }
      next = cursor(page.nextCursor);
      if (page.complete !== (next === null)) throw new Error('INVALID_RESPONSE');
      if (next && (manifestCursors.has(next) || manifestCursors.size >= 100)) throw new Error('INVALID_RESPONSE');
      if (next) manifestCursors.add(next);
    } while (next);
    if (!found) { this.memory.scrubAccess(); throw Object.assign(new Error('ACCESS_CHANGED'), { status: 403 }); }
    if (this.memory.membershipScope !== found.membershipScope) { if (this.memory.membershipScope !== null) this.commands.quarantine(); this.memory.membershipGeneration++; this.memory.membershipScope = found.membershipScope; }
    if (this.manifestGeneration && this.manifestGeneration !== generation) throw new ResetRequired();
    if (this.scope && (this.scope.membershipScope !== found.membershipScope || this.scope.authorizationRevision !== found.authorizationRevision || this.scope.actorId !== found.actorId || this.scope.role !== found.role)) throw new ResetRequired();
    this.scope = found;
    const profiles: ChatActorRef[] = []; let profileGeneration: string | null = null;
    const profileCursors = new Set<string>();
    do {
      const page = await this.get(this.path('profile-sync'), 'profiles', next); guard(); const current = string(page.generation);
      if (profileGeneration && profileGeneration !== current) throw new ResetRequired();
      profileGeneration = current;
      for (const value of list(page.profiles)) { const profile = actor(value); if (profile) profiles.push(profile); }
      next = cursor(page.nextCursor);
      if (page.complete !== (next === null)) throw new Error('INVALID_RESPONSE');
      if (next && (profileCursors.has(next) || profileCursors.size >= 100)) throw new Error('INVALID_RESPONSE');
      if (next) profileCursors.add(next);
    } while (next);
    if (this.profileGeneration && this.profileGeneration !== profileGeneration) throw new ResetRequired();
    // Profile visibility is not permission to send. This endpoint applies actual pair grants.
    const recipients: ChatActorRef[] = []; const recipientCursors = new Set<string>();
    do {
      const signal = this.abort.signal;
      const page = exact(await this.request(this.path('private-recipients') + (next ? `?after=${encodeURIComponent(next)}` : ''), { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }), ['recipients', 'next']);
      if (signal.aborted || this.dead) throw new DOMException('Aborted', 'AbortError');
      for (const value of list(page.recipients)) {
        const data = exact(value, ['actorId', 'nickname', 'avatar']); const actorId = uuid(data.actorId);
        if (data.avatar !== null) uuid(exact(data.avatar, ['assetId']).assetId);
        if (actorId === found.actorId) throw new Error('INVALID_RESPONSE');
        recipients.push({ actorId, displayName: string(data.nickname), avatarUrl: null, role: profiles.find(profile => profile.actorId === actorId)?.role });
      }
      next = cursor(page.next);
      if (next && (recipientCursors.has(next) || recipientCursors.size >= 200)) throw new Error('INVALID_RESPONSE');
      if (next) recipientCursors.add(next);
    } while (next);
    this.commands.quarantine(command => command.payload.intent === 'SHARED' ? found.role !== 'STREAMER' : !recipients.some(recipient => recipient.actorId === command.payload.recipientActorId));
    const binding = JSON.stringify(recipients.map(recipient => recipient.actorId));
    if (this.recipientBinding && this.recipientBinding !== binding) throw new ResetRequired();
    guard();
    this.manifestGeneration = generation; this.profileGeneration = profileGeneration; this.recipientBinding = binding;
    return { room: found, profiles, recipients };
  }
  refresh = (): Promise<void> => {
    if (this.dead) return Promise.resolve();
    if (this.flight) return this.flight;
    if (this.sending && this.state.phase === 'ready') return Promise.resolve();
    this.flight = this.synchronize().finally(() => { this.flight = null; });
    return this.flight;
  };
  /** Resume/access refresh replaces hints from a new authoritative snapshot, never stale versions. */
  refreshHints = async (): Promise<void> => {
    if (this.dead) return;
    this.clear(false, true); await this.flight; if (!this.dead) await this.refresh();
  };
  private async synchronize() {
    for (let attempt = 0; attempt < 2 && !this.dead; attempt++) {
      const signal = this.abort.signal;
      try {
        const auth = await this.authorization();
        if (this.dead || signal.aborted) return;
        if (!this.eventCursor) {
          await this.snapshot();
          if (signal.aborted || this.dead) return;
          await this.reauthorizeComposer(auth.room, auth.recipients, signal);
        } else {
          let more = true; const eventCursors = new Set<string>();
          while (more) {
            const page = await this.get(this.path('events'), 'events', this.eventCursor);
            if (signal.aborted || this.dead) return;
            const events = list(page.events).map(event);
            const nextMessages = this.messages.slice();
            const tombstones = new Map(this.tombstones);
            let merged = nextMessages; let removed = false; let hintsChanged = false; const deletedIds = new Set<string>();
            for (const value of events) {
              if (value.type === 'message.deleted') {
                const prior = merged.find(item => item.id === value.messageId);
                const tombstone = tombstones.get(value.messageId);
                if (BigInt(prior?.version ?? tombstone?.version ?? '0') <= BigInt(value.version)) {
                  tombstones.set(value.messageId, { version: value.version, ...(prior ? { createdAt: prior.createdAt } : tombstone?.createdAt ? { createdAt: tombstone.createdAt } : {}) });
                  merged = merged.filter(item => item.id !== value.messageId);
                  if (!tombstone) removed = true; deletedIds.add(value.messageId);
                }
              } else {
                const prior = tombstones.get(value.message.id);
                if (prior?.createdAt && prior.createdAt !== value.message.createdAt) throw new Error('IMMUTABLE_DISPLAY_KEY');
                if (!prior) {
                  const previous = merged.find(m => m.id === value.message.id);
                  if (previous && BigInt(value.message.version) >= BigInt(previous.version) && differentHints(previous, value.message)) hintsChanged = true;
                  merged = mergeMessages(merged, [value.message]);
                }
              }
            }
            this.messages = merged; this.tombstones = tombstones;
            this.commands.quarantine(command => Boolean(command.payload.quoteId && (deletedIds.has(command.payload.quoteId) || merged.some(item => item.id === command.payload.quoteId && !item.allowedActions.reply))));
            if (hintsChanged && !removed) { this.projectionGeneration++; this.invalidateComposer(); }
            if (removed) {
              // Drop all draft/quote views and in-flight action projections, but retain
              // this cache generation's terminal tombstones and event checkpoint.
              this.projectionGeneration++;
              this.invalidateComposer(); this.publish({ notice: null });
              const candidates = this.messages;
              this.messages = [];
              // Anonymous derived copies have no source link. Re-read every retained
              // DTO before showing any potentially stale quote/copy after deletion.
              const refreshed: ServerMessage[] = [];
              for (let offset = 0; offset < candidates.length; offset += 4) {
                const rows = await Promise.all(candidates.slice(offset, offset + 4).map(async item => {
                  try {
                    const value = message(await this.request(this.path(`messages/${item.id}`), { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }));
                    if (signal.aborted || this.dead) throw new Error('STALE_REQUEST');
                    if (value.id !== item.id || value.createdAt !== item.createdAt || BigInt(value.version) < BigInt(item.version)) throw new Error('INVALID_RESPONSE');
                    return value;
                  } catch (error) { if (Number(recordError(error).status) === 404) return null; throw error; }
                }));
                refreshed.push(...rows.filter((value): value is ServerMessage => value !== null));
              }
              if (signal.aborted || this.dead) return;
              // Recheck the M/A manifest after these un-enveloped GET projections.
              await this.authorization(); if (signal.aborted || this.dead) return;
              this.messages = mergeMessages([], refreshed.filter(item => !this.tombstones.has(item.id)));
            }
            const nextCursor = string(page.nextCursor);
            if (eventCursors.has(nextCursor) || eventCursors.size >= 100) throw new Error('INVALID_RESPONSE');
            eventCursors.add(nextCursor); this.eventCursor = nextCursor;
            if (typeof page.hasMore !== 'boolean') throw new Error('INVALID_RESPONSE');
            more = page.hasMore;
          }
        }
        await this.verifySession();
        if (this.dead || signal.aborted) return;
        this.refreshQuotedDrafts();
        this.rememberAuthority(auth.room, auth.recipients);
        this.publish({ ...auth, phase: 'ready', items: projectMessages(this.messages, auth.room.actorId, [...auth.profiles, ...auth.recipients]), hasOlder: this.historyCursor !== null, error: null });
        return;
      } catch (error) {
        if (this.dead || signal.aborted) return;
        if (error instanceof ResetRequired) { this.clear(false, true); if (attempt === 0) continue; }
        // A failed authorization/sync must never leave previously visible private content on screen.
        this.clearAfterError(error);
        this.publish({ phase: 'error', error: inaccessible(error) ? '채팅 접근 권한이 변경되었습니다. 다시 확인해 주세요.' : '메시지를 불러오지 못했습니다. 다시 시도해 주세요.' });
        if (Number(recordError(error).status) === 401) this.onInvalidate?.();
        return;
      }
    }
  }
  private rememberAuthority(room: RoomMembership, recipients: ChatActorRef[]) {
    this.memory.expired = false;
    this.memory.authority = authorityKey(room); this.memory.recipients = JSON.stringify(recipients.map(item => item.actorId));
    const quoteIds = new Set(Object.values(this.memory.drafts).flatMap(draft => draft.quote ? [draft.quote.messageId] : []));
    const retained = [...this.messages.slice(-512), ...this.messages.filter(item => quoteIds.has(item.id))];
    const hints = new Map([...this.memory.hints].filter(([id]) => quoteIds.has(id)));
    for (const item of retained) hints.set(item.id, { createdAt: item.createdAt, version: item.version, counterpart: item.counterpart, allowedActions: item.allowedActions });
    this.memory.hints = hints;
  }
  private async reauthorizeComposer(room: RoomMembership, recipients: ChatActorRef[], signal: AbortSignal) {
    const changed = this.memory.authority !== null && (this.memory.authority !== authorityKey(room) || this.memory.recipients !== JSON.stringify(recipients.map(item => item.actorId)));
    if (changed) { this.invalidateComposer(); return; }
    // A quote outside the new latest page must be re-read before its parked excerpt
    // can return to the DOM; absence from a snapshot is not deletion evidence.
    const quoteIds = [...new Set(Object.values(this.memory.drafts).flatMap(draft => draft.quote ? [draft.quote.messageId] : []))];
    const priorHints = new Map(this.memory.hints);
    for (const id of quoteIds) {
      try {
        const value = this.messages.find(item => item.id === id) ?? message(await this.request(this.path(`messages/${id}`), { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }));
        if (signal.aborted || this.dead) throw new DOMException('Aborted', 'AbortError');
        const prior = priorHints.get(id);
        if (value.id !== id || (prior && (prior.createdAt !== value.createdAt || BigInt(value.version) < BigInt(prior.version)))) throw new Error('INVALID_RESPONSE');
        this.messages = mergeMessages(this.messages, [value]);
        // A parked excerpt is never display authority: derive it from the current DTO.
        if (value.content.type !== 'TEXT' || typeof value.content.text !== 'string' || value.author.kind !== 'member' || !value.allowedActions.reply) {
          this.commands.quarantine(command => command.payload.quoteId === id); this.invalidateComposer();
        } else {
          const quote = { messageId: id, authorName: value.author.nickname, excerpt: truncateExcerpt(value.content.text) };
          this.memory.drafts = Object.fromEntries(Object.entries(this.memory.drafts).map(([key, draft]) => [key, draft.quote?.messageId === id ? { ...draft, quote } : draft]));
        }
      } catch (error) {
        const status = Number(recordError(error).status);
        if (status !== 403 && status !== 404) throw error;
        await this.authorization(); if (signal.aborted || this.dead) throw new DOMException('Aborted', 'AbortError');
        this.commands.quarantine(command => command.payload.quoteId === id); this.invalidateComposer();
      }
    }
    if (quoteIds.length) { await this.authorization(); if (signal.aborted || this.dead) throw new DOMException('Aborted', 'AbortError'); }
    if (this.messages.some(item => { const prior = priorHints.get(item.id); return prior && JSON.stringify([prior.counterpart, prior.allowedActions]) !== JSON.stringify([item.counterpart, item.allowedActions]); })) this.invalidateComposer();
  }
  private refreshQuotedDrafts() {
    let changed = false;
    const drafts = Object.fromEntries(Object.entries(this.memory.drafts).map(([key, draft]) => {
      const value = this.messages.find(item => item.id === draft.quote?.messageId);
      if (!value || !draft.quote) return [key, draft];
      const prior = this.memory.hints.get(value.id);
      if (prior && (prior.createdAt !== value.createdAt || BigInt(value.version) < BigInt(prior.version))) throw new Error('INVALID_RESPONSE');
      const quote = value.content.type === 'TEXT' && typeof value.content.text === 'string' && value.author.kind === 'member' && value.allowedActions.reply
        ? { messageId: value.id, authorName: value.author.nickname, excerpt: truncateExcerpt(value.content.text) } : null;
      if (JSON.stringify(quote) === JSON.stringify(draft.quote)) return [key, draft];
      changed = true;
      if (!quote) this.commands.quarantine(command => command.payload.quoteId === value.id);
      return [key, { ...draft, quote, ...(!quote ? { retryCommandId: undefined } : {}) }];
    }));
    if (changed) { this.memory.drafts = drafts; this.memory.epoch++; }
  }
  private async snapshot() {
    const signal = this.abort.signal;
    const page = await this.get(this.path('snapshot'), 'snapshot');
    if (signal.aborted || this.dead) throw new DOMException('Aborted', 'AbortError');
    this.messages = mergeMessages([], list(page.messages).map(message));
    this.eventCursor = string(page.nextCursor); this.historyCursor = cursor(page.historyCursor);
  }
  loadOlder = async (): Promise<void> => {
    if (this.dead || this.flight || !this.historyCursor || this.state.phase !== 'ready') return;
    const signal = this.abort.signal;
    this.publish({ loadingOlder: true });
    this.flight = (async () => {
      try {
        const page = await this.get(this.path('history'), 'history', this.historyCursor);
        if (signal.aborted || this.dead) return;
        const incoming = list(page.messages).map(message).filter(item => { const deleted = this.tombstones.get(item.id); if (deleted?.createdAt && deleted.createdAt !== item.createdAt) throw new Error('IMMUTABLE_DISPLAY_KEY'); return !deleted; });
        const hintsChanged = incoming.some(item => { const prior = this.messages.find(value => value.id === item.id); return prior && BigInt(item.version) >= BigInt(prior.version) && differentHints(prior, item); });
        this.messages = mergeMessages(this.messages, incoming);
        this.commands.quarantine(command => Boolean(command.payload.quoteId && this.messages.some(item => item.id === command.payload.quoteId && !item.allowedActions.reply)));
        if (hintsChanged) { this.projectionGeneration++; this.invalidateComposer(); }
        this.historyCursor = cursor(page.nextCursor);
        await this.verifySession();
        if (signal.aborted || this.dead) return;
        this.refreshQuotedDrafts();
        this.rememberAuthority(this.state.room!, this.state.recipients);
        this.publish({ items: projectMessages(this.messages, this.state.room!.actorId, [...this.state.profiles, ...this.state.recipients]), hasOlder: this.historyCursor !== null, error: null });
      } catch (error) {
        if (this.dead || signal.aborted) return;
        this.clearAfterError(error); this.publish({ phase: 'error', error: '이전 메시지를 불러오지 못했습니다. 다시 확인해 주세요.' });
        if (Number(recordError(error).status) === 401) this.onInvalidate?.();
      } finally { if (!signal.aborted && !this.dead) this.publish({ loadingOlder: false }); }
    })().finally(() => { this.flight = null; });
    await this.flight;
  };
  private async revalidate() {
    await this.flight;
    if (!this.dead) await this.refresh();
  }
  /** Explicit reads only: no per-row mount fanout or automatic mutation retries. */
  react = async (messageId: string, emoji?: string | null): Promise<void> => {
    const item = this.messages.find(message => message.id === messageId);
    if (this.dead || this.state.phase !== 'ready' || !item || this.deleting || this.reactionFlights.has(messageId)) return;
    const version = item.version; const projection = this.projectionGeneration; const signal = this.abort.signal;
    const flights = this.reactionFlights;
    const current = () => !this.dead && !signal.aborted && projection === this.projectionGeneration && this.messages.some(message => message.id === messageId && message.version === version);
    const publish = (value: ReactionState) => { if (current()) this.publish({ reactions: { ...this.state.reactions, [messageId]: value } }); };
    if (Date.now() < this.reactionCooldown || flights.size >= 4) {
      publish({ version, phase: 'error', error: '요청이 많습니다. 잠시 후 반응을 다시 확인해 주세요.' }); return;
    }
    flights.add(messageId);
    publish({ version, phase: 'loading' });
    try {
      const path = this.path(`messages/${encodeURIComponent(messageId)}/reactions`);
      const summary = reactionSummary(await this.request(path + (emoji === undefined ? '' : '/me'), {
        ...(emoji === undefined ? {} : emoji === null ? { method: 'DELETE' as const } : { method: 'PUT' as const, body: { emoji } }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      }));
      if (!current()) return;
      await this.verifySession();
      publish({ version, phase: 'ready', summary });
    } catch (error) {
      if (!current()) return;
      const status = Number(recordError(error).status);
      if (inaccessible(error)) {
        this.clear(status === 401, status !== 401);
        this.publish({ phase: 'error', error: '메시지와 채팅 접근 권한을 다시 확인해 주세요.' });
        if (status === 401) this.onInvalidate?.();
        else await this.revalidate();
        return;
      }
      if (emoji !== undefined && (status === 400 || status === 409)) { void this.refreshHints(); return; }
      // Transport exposes only allowlisted codes; a conservative local cooldown avoids a retry storm.
      if (status === 429) this.reactionCooldown = Date.now() + 30000;
      publish({ version, phase: 'error', error: status === 429 ? '요청이 많습니다. 30초 후 반응을 다시 확인해 주세요.' : '반응 결과를 확인하지 못했습니다. 다시 조회한 뒤 선택해 주세요.' });
    } finally {
      flights.delete(messageId);
      // Wake only subscribed open controls after an old-version request settles.
      // This carries no private response data and never retries a mutation.
      if (!this.dead && !signal.aborted && projection === this.projectionGeneration && this.messages.some(message => message.id === messageId && message.version !== version)) {
        this.publish({ reactionRevision: this.state.reactionRevision + 1 });
      }
    }
  };
  remove = async (messageId: string): Promise<ChatSubmitResult> => {
    if (this.dead || this.deleting || this.sending || this.state.phase !== 'ready') return { accepted: false, reason: '다른 요청을 확인한 뒤 다시 시도해 주세요.' };
    const owned = this.messages.find(item => item.id === messageId);
    if (!owned?.allowedActions.delete) return { accepted: false, reason: '내 메시지만 삭제할 수 있습니다.' };
    const signal = this.abort.signal; const projection = this.projectionGeneration; this.deleting = true;
    try {
      const ack = exact(await this.request(this.path(`messages/${encodeURIComponent(messageId)}/delete`), { method: 'POST', body: {}, signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }), ['requestId', 'status']);
      if (signal.aborted || this.dead || projection !== this.projectionGeneration) return { accepted: false, reason: '접근 상태가 변경되어 삭제 결과를 다시 확인해야 합니다.' };
      uuid(ack.requestId);
      if (ack.status !== 'blocked' || typeof ack.requestId !== 'string' || !ack.requestId) throw new Error('INVALID_ACK');
      await this.verifySession();
      if (signal.aborted || this.dead || projection !== this.projectionGeneration) return { accepted: false, reason: '접근 상태가 변경되어 삭제 결과를 다시 확인해야 합니다.' };
      // Anonymous copies cannot be traced client-side. Drop ALL text/quotes/drafts,
      // abort pre-delete reads, then recover only from a fresh authorized snapshot.
      this.clear();
      this.publish({ notice: '메시지가 더 이상 표시되지 않도록 차단되었습니다.' });
      // A concurrent refresh is aborted by clear; let it settle before fresh sync.
      await this.flight;
      if (!this.dead) await this.refresh();
      return { accepted: true };
    } catch (error) {
      if (!this.dead && !signal.aborted && projection === this.projectionGeneration && inaccessible(error)) {
        const status = Number(recordError(error).status);
        this.clear(status === 401, status !== 401);
        this.publish({ phase: 'error', error: '메시지와 채팅 접근 권한을 다시 확인해 주세요.' });
        if (status === 401) this.onInvalidate?.();
        else await this.revalidate();
      }
      if (!this.dead && !signal.aborted && projection === this.projectionGeneration && Number(recordError(error).status) >= 400 && Number(recordError(error).status) < 500 && !inaccessible(error)) void this.refreshHints();
      return { accepted: false, reason: '삭제 결과를 확인하지 못했습니다. 다시 시도해 주세요.' };
    } finally { this.deleting = false; }
  };
  private commandAuthorized(command: UnknownCommand): boolean {
    const room = this.state.room;
    if (!('payload' in command) || !room || command.accountPartition !== this.accountPartition || command.sessionBinding !== this.sessionBinding || command.roomId !== room.roomId || command.payload.membershipScope !== room.membershipScope || command.membershipGeneration !== this.memory.membershipGeneration) return false;
    return this.payloadAuthorized(command.payload, room);
  }
  private payloadAuthorized(body: { intent: 'SHARED' | 'PRIVATE'; recipientActorId?: string; quoteId?: string }, room: RoomMembership): boolean {
    if (body.intent === 'SHARED' ? room.role !== 'STREAMER' : !this.state.recipients.some(p => p.actorId === body.recipientActorId && p.actorId !== room.actorId)) return false;
    if (body.quoteId) {
      const quote = this.messages.find(m => m.id === body.quoteId);
      if (!quote?.allowedActions.reply || body.intent !== 'PRIVATE' || (quote.audience === 'PRIVATE' ? quote.counterpart?.actorId : quote.author.kind === 'member' ? quote.author.actorId : null) !== body.recipientActorId) return false;
    }
    return true;
  }
  /** Read-only recovery is allowed under fresh membership; it never rebinds an old SEND. */
  reconcile = async (id: string): Promise<void> => {
    await this.flight;
    const command = this.commands.get(id);
    if (this.dead || this.sending || this.deleting || this.state.phase !== 'ready' || command?.status !== 'unknown' || command.accountPartition !== this.accountPartition || command.sessionBinding !== this.sessionBinding || command.roomId !== this.roomId) return;
    const signal = this.abort.signal; const projection = this.projectionGeneration;
    const current = () => !this.dead && !signal.aborted && projection === this.projectionGeneration;
    this.sending = true; this.publish({ notice: null });
    try {
      await this.verifySession(); if (!current()) return;
      const result = receipt(await this.request(this.path(`message-commands/${id}`), { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }), id, 'lookup');
      if (!current()) return;
      await this.verifySession(); if (!current()) return;
      this.commandResult(result);
      this.publish({ notice: result.status === 'deleted' ? '이 전송은 이미 삭제된 메시지입니다.' : '메시지 저장 결과를 확인했습니다.' });
    } catch (error) {
      if (!current()) return;
      if (Number(recordError(error).status) === 401) { this.clear(true); this.onInvalidate?.(); }
      else if (Number(recordError(error).status) === 403) void this.refreshHints();
      else this.publish({ notice: '전송 결과를 확인할 수 없습니다. 조회 실패만으로 저장되지 않았다고 판단하지 않습니다.' });
    } finally { this.sending = false; if (!this.dead) { this.publish({}); if (this.getSnapshot().phase === 'loading') void this.refresh(); } }
  };
  retry = async (id: string): Promise<void> => {
    const command = this.commands.get(id);
    if (command?.status !== 'unknown' || !('payload' in command) || !this.commandAuthorized(command)) return;
    const signal = this.abort.signal; const projection = this.projectionGeneration;
    const payload = command.payload;
    const recipient = this.state.recipients.find(item => item.actorId === payload.recipientActorId);
    if (payload.intent === 'PRIVATE' && !recipient) return;
    const result = await this.send({ target: payload.intent === 'SHARED' ? { scope: 'SHARED' } : { scope: 'PRIVATE', recipient: recipient! }, body: payload.content.text, retryCommandId: id, ...(payload.quoteId ? { quoteMessageId: payload.quoteId } : {}) });
    if (!this.dead && !signal.aborted && projection === this.projectionGeneration) this.publish({ notice: result.accepted ? result.note ?? '메시지 저장 결과를 확인했습니다.' : result.reason });
  };
  private commandResult(result: Receipt): ChatSubmitResult {
    if (result.status === 'committed' && this.tombstones.has(result.messageId)) throw new Error('STALE_RECEIPT');
    this.commands.settle(result);
    // A recovered receipt and a direct ACK both require a read after any older flight.
    // revalidate yields until the command releases its sending fence in finally.
    void this.revalidate();
    const terminal = this.commands.get(result.clientMessageId);
    return { accepted: true, ...(terminal?.status === 'deleted' ? { note: '이 메시지는 이미 삭제되었습니다.' } : {}) };
  }
  send = async (submission: ChatComposerSubmission): Promise<ChatSubmitResult> => {
    await this.flight;
    const room = this.state.room;
    if (this.dead || this.sending || this.deleting || this.state.phase !== 'ready' || !room || !this.accountPartition || !this.sessionBinding) return { accepted: false, reason: '채팅 연결을 확인한 뒤 다시 시도해 주세요.' };
    const text = submission.body.normalize('NFC');
    if (!text.trim() || [...text].length > 4000 || new TextEncoder().encode(text).length > 16384 || text.includes('\0')) return { accepted: false, reason: '메시지는 4,000자 이내로 입력해 주세요.' };
    const body = { intent: submission.target.scope, ...(submission.target.scope === 'PRIVATE' ? { recipientActorId: submission.target.recipient.actorId } : {}), ...(submission.quoteMessageId ? { quoteId: submission.quoteMessageId } : {}), content: { type: 'TEXT' as const, text } };
    let command: PendingCommand;
    if (submission.retryCommandId) {
      const previous = this.commands.get(submission.retryCommandId);
      if (!previous) return { accepted: false, reason: '이 전송 기록은 현재 세션에서 확인할 수 없습니다.' };
      if (previous.status !== 'unknown') return { accepted: true, note: previous.status === 'deleted' ? '이 메시지는 이미 삭제되었습니다.' : '이전에 저장된 전송입니다.' };
      if (!('payload' in previous)) return { accepted: false, retryCommandId: previous.clientMessageId, reason: '접근 상태가 변경된 이전 전송은 결과 조회만 가능합니다.' };
      if (previous.payload.intent !== body.intent || previous.payload.recipientActorId !== body.recipientActorId || previous.payload.quoteId !== body.quoteId || previous.payload.content.text !== text) return { accepted: false, reason: '다시 시도할 메시지의 내용과 대상이 변경되었습니다.' };
      command = previous;
    } else {
      if (!this.payloadAuthorized(body, room)) return { accepted: false, reason: '이 대상이나 메시지에 지금 전송할 수 없습니다.' };
      try { command = this.commands.create(room, this.accountPartition, this.sessionBinding, this.memory.membershipGeneration, body); }
      catch { return { accepted: false, reason: '미확인 전송이 많습니다. 이전 전송 결과를 먼저 확인해 주세요.' }; }
    }
    const clientMessageId = command.clientMessageId;
    const draftKey = body.intent === 'SHARED' ? 'shared' : `private:${body.recipientActorId}`;
    const draft = this.memory.drafts[draftKey];
    if (draft && draft.body.trim().normalize('NFC') === text && draft.quote?.messageId === body.quoteId) this.memory.drafts = { ...this.memory.drafts, [draftKey]: { ...draft, retryCommandId: clientMessageId } };
    if (!this.commandAuthorized(command)) return { accepted: false, retryCommandId: clientMessageId, reason: '참여 상태나 보낼 대상이 변경되었습니다. 이전 전송을 새 참여 상태로 다시 보내지 않습니다.' };
    const signal = this.abort.signal; const projection = this.projectionGeneration;
    const current = () => !this.dead && !signal.aborted && projection === this.projectionGeneration;
    this.sending = true; this.publish({});
    try {
      await this.verifySession(); if (!current()) throw new Error('STALE_REQUEST');
      if (submission.retryCommandId) {
        // A lookup is a read only. 404 stays unknown; only this explicit retry
        // action plus fresh authorization can replay the exact immutable command.
        try {
          const result = receipt(await this.request(this.path(`message-commands/${clientMessageId}`), { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }), clientMessageId, 'lookup');
          if (!current()) throw new Error('STALE_REQUEST');
          await this.verifySession(); if (!current()) throw new Error('STALE_REQUEST');
          return this.commandResult(result);
        } catch (error) { if (Number(recordError(error).status) !== 404 || !current()) throw error; }
        // Reauthorize after the ambiguous receipt, never derive noncommit from it.
        const auth = await this.authorization();
        if (!current() || auth.room.membershipScope !== command.payload.membershipScope) throw new ResetRequired();
        this.publish(auth);
        if (!this.commandAuthorized(command)) throw new ResetRequired();
      }
      const result = receipt(await this.request(this.path('messages'), { method: 'POST', body: command.payload, signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }), clientMessageId, 'send');
      if (!current()) throw new Error('STALE_REQUEST');
      await this.verifySession(); if (!current()) throw new Error('STALE_REQUEST');
      return this.commandResult(result);
    } catch (error) {
      if (current()) {
        const status = Number(recordError(error).status);
        if (status === 401) { this.clear(true); this.publish({ phase: 'error', error: '로그인 상태를 다시 확인해 주세요.' }); this.onInvalidate?.(); }
        else if (status === 409 && recordError(error).code === 'MEMBERSHIP_SCOPE_MISMATCH') { this.commands.quarantine(); void this.refreshHints(); }
        else if (inaccessible(error) || error instanceof ResetRequired || status === 409 || (status >= 400 && status < 500)) {
          // Includes MEMBERSHIP_SCOPE_MISMATCH: no expected-token hints, rebinding or automatic send.
          void this.refreshHints();
        }
      }
      return { accepted: false, retryCommandId: clientMessageId, reason: '전송 결과가 확인되지 않았습니다. 다시 보내기는 같은 전송 기록을 조회하고 현재 권한으로 재확인합니다.' };
    } finally { this.sending = false; if (!this.dead) this.publish({}); if (this.getSnapshot().phase === 'loading') void this.refresh(); }
  };
}
