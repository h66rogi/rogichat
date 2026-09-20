import { reactionSummary, type ReactionState } from './reactions';
import { actor, cursor, envelope, list, membership, mergeMessages, message, projectMessages, record, string } from './contract';
import type { ChatRequest, RoomMembership, ServerMessage } from './contract';
import type { ChatActorRef, ChatComposerSubmission, ChatSubmitResult, ChatTimelineItem } from './types';
import type { MediaLifetime } from '../media/contracts';

export interface ChatState {
  reactions: Record<string, ReactionState>; reactionRevision: number;
  phase: 'loading' | 'ready' | 'error'; notice: string | null; epoch: number; room: RoomMembership | null;
  profiles: ChatActorRef[]; recipients: ChatActorRef[]; items: ChatTimelineItem[]; hasOlder: boolean; loadingOlder: boolean; error: string | null;
}
const initial = (): ChatState => ({ reactions: {}, reactionRevision: 0, phase: 'loading', notice: null, epoch: 0, room: null, profiles: [], recipients: [], items: [], hasOlder: false, loadingOlder: false, error: null });
const inaccessible = (error: unknown) => [401, 403, 404].includes(Number(recordError(error).status));
function recordError(error: unknown): { status?: unknown } { return error !== null && typeof error === 'object' ? error : {}; }
class ResetRequired extends Error {}

/** Ephemeral, per-mount cache. No browser persistence; every request is bounded by one access epoch. */
export class ChatController {
  private state = initial();
  private listeners = new Set<() => void>();
  private abort = new AbortController();
  private dead = false;
  private flight: Promise<void> | null = null;
  private messages: ServerMessage[] = [];
  private eventCursor: string | null = null;
  private historyCursor: string | null = null;
  private manifestGeneration: string | null = null;
  private profileGeneration: string | null = null;
  private recipientBinding: string | null = null;
  private readonly deviceId = crypto.randomUUID();
  private cacheId = crypto.randomUUID();
  private attempts = new Map<string, string>();
  private sending = false;
  private deleting = false;
  private reactionFlights = new Set<string>();
  private reactionCooldown = 0;
  private readonly roomId: string;
  private readonly request: ChatRequest;
  private readonly onInvalidate: (() => void) | undefined;
  private readonly csrfToken: string | undefined;
  constructor(roomId: string, request: ChatRequest, onInvalidate?: () => void, csrfToken?: string) {
    this.roomId = roomId; this.request = request; this.onInvalidate = onInvalidate; this.csrfToken = csrfToken;
  }
  getSnapshot = (): ChatState => this.state;
  mediaLifetime = (epoch = this.state.epoch): MediaLifetime => {
    const signal = this.abort.signal;
    return { signal, isCurrent: () => !this.dead && !signal.aborted && epoch === this.state.epoch && this.state.phase === 'ready' };
  };
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<ChatState>) {
    if (this.dead) return;
    this.state = { ...this.state, ...patch };
    if (patch.items) this.state.reactions = Object.fromEntries(Object.entries(this.state.reactions).filter(([id, value]) => this.messages.some(message => message.id === id && message.version === value.version)));
    for (const listener of this.listeners) listener();
  }
  private clear(forgetAttempts = false) {
    this.abort.abort(); this.abort = new AbortController(); this.cacheId = crypto.randomUUID();
    this.reactionFlights = new Set(); this.reactionCooldown = 0;
    this.messages = []; this.eventCursor = null; this.historyCursor = null;
    this.manifestGeneration = null; this.profileGeneration = null; this.recipientBinding = null; if (forgetAttempts) this.attempts.clear();
    this.publish({ ...initial(), epoch: this.state.epoch + 1 });
  }
  dispose() { this.clear(true); this.dead = true; this.abort.abort(); this.listeners.clear(); }
  private async get(path: string, from?: string | null): Promise<Record<string, unknown>> {
    const query = new URLSearchParams({ deviceId: this.deviceId, cacheId: this.cacheId, limit: '100' });
    if (from) query.set('cursor', from);
    const signal = this.abort.signal;
    const data = envelope(await this.request(`${path}?${query}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }));
    if (signal.aborted || this.dead) throw new DOMException('Aborted', 'AbortError');
    if (data.resetRequired) throw new ResetRequired();
    return data;
  }
  private path(action: string) { return `/v1/rooms/${encodeURIComponent(this.roomId)}/${action}`; }
  private async verifySession() {
    if (!this.csrfToken) return;
    const signal = this.abort.signal;
    const session = record(await this.request('/v1/auth/session', { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }));
    if (signal.aborted || this.dead) throw new DOMException('Aborted', 'AbortError');
    if (session.authenticated !== true || session.soopLinkStatus !== 'VERIFIED' || session.csrfToken !== this.csrfToken) throw Object.assign(new Error('SESSION_CHANGED'), { status: 401 });
  }
  private async authorization() {
    await this.verifySession();
    let next: string | null = null; let found: RoomMembership | null = null; let generation: string | null = null;
    const manifestCursors = new Set<string>();
    do {
      const page = await this.get('/v1/sync', next); const current = string(page.generation);
      if (generation && generation !== current) throw new ResetRequired();
      generation = current;
      for (const value of list(page.rooms)) if (record(value).roomId === this.roomId) found = membership(value);
      next = cursor(page.nextCursor);
      if (page.complete !== (next === null)) throw new Error('INVALID_RESPONSE');
      if (next && (manifestCursors.has(next) || manifestCursors.size >= 100)) throw new Error('INVALID_RESPONSE');
      if (next) manifestCursors.add(next);
    } while (next);
    if (!found) throw Object.assign(new Error('ACCESS_CHANGED'), { status: 403 });
    if (this.manifestGeneration && this.manifestGeneration !== generation) throw new ResetRequired();
    const profiles: ChatActorRef[] = []; let profileGeneration: string | null = null;
    const profileCursors = new Set<string>();
    do {
      const page = await this.get(this.path('profile-sync'), next); const current = string(page.generation);
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
      const page = record(await this.request(this.path('private-recipients') + (next ? `?after=${encodeURIComponent(next)}` : ''), { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }));
      if (signal.aborted || this.dead) throw new DOMException('Aborted', 'AbortError');
      for (const value of list(page.recipients)) {
        const data = record(value); const actorId = string(data.actorId);
        if (actorId === found.actorId) throw new Error('INVALID_RESPONSE');
        recipients.push({ actorId, displayName: string(data.nickname), avatarUrl: null, role: profiles.find(profile => profile.actorId === actorId)?.role });
      }
      next = cursor(page.next);
      if (next && (recipientCursors.has(next) || recipientCursors.size >= 200)) throw new Error('INVALID_RESPONSE');
      if (next) recipientCursors.add(next);
    } while (next);
    const binding = JSON.stringify(recipients.map(recipient => recipient.actorId));
    if (this.recipientBinding && this.recipientBinding !== binding) throw new ResetRequired();
    this.manifestGeneration = generation; this.profileGeneration = profileGeneration; this.recipientBinding = binding;
    return { room: found, profiles, recipients };
  }
  refresh = (): Promise<void> => {
    if (this.dead) return Promise.resolve();
    if (this.flight) return this.flight;
    this.flight = this.synchronize().finally(() => { this.flight = null; });
    return this.flight;
  };
  private async synchronize() {
    for (let attempt = 0; attempt < 2 && !this.dead; attempt++) {
      const epoch = this.state.epoch;
      try {
        const auth = await this.authorization();
        if (!this.eventCursor) {
          await this.snapshot();
        } else {
          let more = true; const eventCursors = new Set<string>();
          while (more) {
            const page = await this.get(this.path('events'), this.eventCursor);
            let unknownPosition = false;
            for (const value of list(page.events)) {
              const event = record(value);
              if (event.type === 'message.deleted') {
                string(event.messageId);
                // A remote deletion also invalidates quotes in hidden composer drafts
                // and untraceable copies. Reset the complete UI/cache epoch before
                // reauthorizing, just like local deletion; keep uncertain send IDs.
                throw new ResetRequired();
              }
              else if (event.type === 'message.upsert') {
                const incoming = message(event.message);
                if (!this.messages.some(item => item.id === incoming.id)) unknownPosition = true;
                else this.messages = mergeMessages(this.messages, [incoming]);
              }
              else throw new Error('INVALID_RESPONSE');
            }
            if (unknownPosition) { await this.snapshot(); break; }
            const nextCursor = string(page.nextCursor);
            if (eventCursors.has(nextCursor) || eventCursors.size >= 100) throw new Error('INVALID_RESPONSE');
            eventCursors.add(nextCursor); this.eventCursor = nextCursor;
            if (typeof page.hasMore !== 'boolean') throw new Error('INVALID_RESPONSE');
            more = page.hasMore;
          }
        }
        await this.verifySession();
        this.publish({ ...auth, phase: 'ready', items: projectMessages(this.messages, auth.room.actorId, auth.profiles), hasOlder: this.historyCursor !== null, error: null });
        return;
      } catch (error) {
        if (this.dead || epoch !== this.state.epoch) return;
        if (error instanceof ResetRequired) { this.clear(); if (attempt === 0) continue; }
        // A failed authorization/sync must never leave previously visible private content on screen.
        this.clear(inaccessible(error));
        this.publish({ phase: 'error', error: inaccessible(error) ? '채팅 접근 권한이 변경되었습니다. 다시 확인해 주세요.' : '메시지를 불러오지 못했습니다. 다시 시도해 주세요.' });
        if (Number(recordError(error).status) === 401) this.onInvalidate?.();
        return;
      }
    }
  }
  private async snapshot() {
    const page = await this.get(this.path('snapshot'));
    this.messages = list(page.messages).map(message);
    this.eventCursor = string(page.nextCursor); this.historyCursor = cursor(page.historyCursor);
  }
  loadOlder = async (): Promise<void> => {
    if (this.dead || this.flight || !this.historyCursor || this.state.phase !== 'ready') return;
    const epoch = this.state.epoch;
    this.publish({ loadingOlder: true });
    this.flight = (async () => {
      try {
        const page = await this.get(this.path('history'), this.historyCursor);
        this.messages = mergeMessages(this.messages, list(page.messages).map(message), true);
        this.historyCursor = cursor(page.nextCursor);
        await this.verifySession();
        this.publish({ items: projectMessages(this.messages, this.state.room!.actorId, this.state.profiles), hasOlder: this.historyCursor !== null, error: null });
      } catch (error) {
        if (this.dead || epoch !== this.state.epoch) return;
        this.clear(inaccessible(error)); this.publish({ phase: 'error', error: '이전 메시지를 불러오지 못했습니다. 다시 확인해 주세요.' });
        if (Number(recordError(error).status) === 401) this.onInvalidate?.();
      } finally { this.publish({ loadingOlder: false }); }
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
    const version = item.version; const signal = this.abort.signal;
    const flights = this.reactionFlights;
    const current = () => !this.dead && !signal.aborted && this.messages.some(message => message.id === messageId && message.version === version);
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
        this.clear(status === 401);
        this.publish({ phase: 'error', error: '메시지와 채팅 접근 권한을 다시 확인해 주세요.' });
        if (status === 401) this.onInvalidate?.();
        else void this.revalidate();
        return;
      }
      // Transport exposes status only; a conservative local cooldown avoids a retry storm.
      if (status === 429) this.reactionCooldown = Date.now() + 30000;
      publish({ version, phase: 'error', error: status === 429 ? '요청이 많습니다. 30초 후 반응을 다시 확인해 주세요.' : '반응 결과를 확인하지 못했습니다. 다시 조회한 뒤 선택해 주세요.' });
    } finally {
      flights.delete(messageId);
      // Wake only subscribed open controls after an old-version request settles.
      // This carries no private response data and never retries a mutation.
      if (!this.dead && !signal.aborted && this.messages.some(message => message.id === messageId && message.version !== version)) {
        this.publish({ reactionRevision: this.state.reactionRevision + 1 });
      }
    }
  };
  remove = async (messageId: string): Promise<ChatSubmitResult> => {
    if (this.dead || this.deleting || this.sending || this.state.phase !== 'ready') return { accepted: false, reason: '다른 요청을 확인한 뒤 다시 시도해 주세요.' };
    const owned = this.messages.find(item => item.id === messageId);
    if (!owned || owned.author.kind !== 'member' || owned.author.actorId !== this.state.room?.actorId) return { accepted: false, reason: '내 메시지만 삭제할 수 있습니다.' };
    const signal = this.abort.signal; this.deleting = true;
    try {
      const ack = record(await this.request(this.path(`messages/${encodeURIComponent(messageId)}/delete`), { method: 'POST', body: {}, signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }));
      if (signal.aborted || this.dead) return { accepted: false, reason: '접근 상태가 변경되어 삭제 결과를 다시 확인해야 합니다.' };
      if (ack.status !== 'blocked' || typeof ack.requestId !== 'string' || !ack.requestId) throw new Error('INVALID_ACK');
      // Anonymous copies cannot be traced client-side. Drop ALL text/quotes/drafts,
      // abort pre-delete reads, then recover only from a fresh authorized snapshot.
      this.clear();
      this.publish({ notice: '메시지가 더 이상 표시되지 않도록 차단되었습니다.' });
      // A concurrent refresh is aborted by clear; let it settle before fresh sync.
      await this.flight;
      if (!this.dead) await this.refresh();
      return { accepted: true };
    } catch (error) {
      if (!this.dead && inaccessible(error)) {
        this.clear(Number(recordError(error).status) === 401);
        this.publish({ phase: 'error', error: '메시지와 채팅 접근 권한을 다시 확인해 주세요.' });
        if (Number(recordError(error).status) === 401) this.onInvalidate?.();
        else void this.revalidate();
      }
      return { accepted: false, reason: '삭제 결과를 확인하지 못했습니다. 다시 시도해 주세요.' };
    } finally { this.deleting = false; }
  };
  send = async (submission: ChatComposerSubmission): Promise<ChatSubmitResult> => {
    const room = this.state.room;
    if (this.dead || this.sending || this.deleting || this.state.phase !== 'ready' || !room) return { accepted: false, reason: '채팅 연결을 확인한 뒤 다시 시도해 주세요.' };
    const { target } = submission;
    const recipient = target.scope === 'PRIVATE' ? this.state.recipients.find(p => p.actorId === target.recipient.actorId && p.actorId !== room.actorId) : null;
    if (target.scope === 'SHARED' ? room.role !== 'STREAMER' : !recipient) return { accepted: false, reason: '이 대상에게 메시지를 보낼 수 없습니다.' };
    const text = submission.body.normalize('NFC');
    let photoAsset: string | undefined;
    let stickerId: string | undefined;
    if (submission.photo && submission.sticker) return { accepted: false, reason: '사진과 스티커는 따로 보내 주세요.' };
    if (submission.photo) {
      try {
        if (text || submission.quoteMessageId) throw new Error('PHOTO_ONLY');
        photoAsset = submission.photo.readyAsset('PHOTO', this.roomId);
      } catch { return { accepted: false, reason: '준비가 완료된 사진만 따로 보낼 수 있습니다.' }; }
    } else if (submission.sticker) {
      try {
        if (text || submission.quoteMessageId) throw new Error('STICKER_ONLY');
        stickerId = submission.sticker.readySticker(this.roomId);
      } catch { return { accepted: false, reason: '현재 목록에서 스티커를 선택해 주세요.' }; }
    } else if (!text.trim() || [...text].length > 4000 || new TextEncoder().encode(text).length > 16384 || text.includes('\0')) return { accepted: false, reason: '메시지는 4,000자 이내로 입력해 주세요.' };
    // Only a server-visible source may be quoted. Cross-private recipient quotes are
    // unavailable because the current DTO deliberately omits its recipient/stream ID.
    const quote = submission.quoteMessageId ? this.messages.find(m => m.id === submission.quoteMessageId) : null;
    if (submission.quoteMessageId && (!quote || (quote.audience === 'PRIVATE' && (quote.author.kind !== 'member' || quote.author.actorId !== recipient?.actorId)))) return { accepted: false, reason: '이 대화에서 인용할 수 없는 메시지입니다.' };
    const body = { intent: target.scope, ...(recipient ? { recipientActorId: recipient.actorId } : {}), ...(quote ? { quoteId: quote.id } : {}), content: photoAsset ? { type: 'PHOTO', assetIds: [photoAsset] } : stickerId ? { type: 'STICKER', stickerId } : { type: 'TEXT', text } };
    const fingerprint = JSON.stringify(body);
    const clientMessageId = this.attempts.get(fingerprint) ?? crypto.randomUUID();
    this.attempts.set(fingerprint, clientMessageId);
    const media = submission.photo ?? submission.sticker;
    const signal = media ? AbortSignal.any([this.abort.signal, media.lifetime.signal]) : this.abort.signal; this.sending = true;
    try {
      const ack = record(await this.request(this.path('messages'), { method: 'POST', body: { ...body, clientMessageId }, signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }));
      if (signal.aborted || this.dead) return { accepted: false, reason: '접근 권한이 변경되어 전송 결과를 다시 확인해야 합니다.' };
      if (ack.clientMessageId !== clientMessageId || (typeof ack.messageId !== 'string' || !ack.messageId) || (ack.status === 'committed' && (typeof ack.version !== 'string' || !/^\d+$/.test(ack.version))) || !['committed', 'deleted'].includes(String(ack.status))) throw new Error('INVALID_ACK');
      this.attempts.delete(fingerprint);
      // A commit ACK proves persistence. The next sync, not fabricated local content, updates the timeline.
      // An existing read may have captured the timeline before this commit.
      // Let it settle, then fetch again instead of coalescing into that old read.
      void this.revalidate();
      return { accepted: true, ...(ack.status === 'deleted' ? { note: '이 메시지는 이미 삭제되었습니다.' } : {}) };
    } catch (error) {
      if (!this.dead && inaccessible(error)) {
        this.clear(Number(recordError(error).status) === 401);
        this.publish({ phase: 'error', error: '보낼 대상과 채팅 접근 권한을 다시 확인해 주세요.' });
        if (Number(recordError(error).status) === 401) this.onInvalidate?.();
        else void this.revalidate();
      }
      return { accepted: false, reason: '전송을 확인하지 못했습니다. 같은 내용으로 다시 보내면 중복 없이 재확인합니다.' };
    } finally { this.sending = false; }
  };
}
