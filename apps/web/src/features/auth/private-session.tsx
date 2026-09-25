'use client';
import { sessionAllowsChat } from '@/core/api/session-contract';
import { revokeChatOutboxes, suspendChatOutboxes } from '@/features/chat/chat-controller';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { ApiError, type Profile, type Session } from '@/core/api/client';
import { sessionBinding } from '@/core/api/session-binding';
import { forgetChatMemory } from '@/features/chat/chat-memory';
import { useApi } from '@/core/runtime/provider';
import { cleanupBinding, outboxEnvironment } from './outbox-cleanup';
import { ACCOUNT_DELETION_PENDING, PRIVACY_CHANGED, isAccountDeletionPending, readDeletion, browserPrivacyStore } from '@/features/privacy/deletion';

import { LOGOUT_PENDING, beginLogout, clearLogout } from '@/core/api/logout-marker';
import { clearPrivateRenderLock, setPrivateRenderLock } from '@/core/api/private-render-lock';
import { PageSkeleton } from '@/shared/ui/page-skeleton';
export { LOGOUT_PENDING } from '@/core/api/logout-marker';
const INVALIDATE = 'rogichat-session-invalidated';
const CURRENT_BINDING = 'rogichat.current-session-binding';
let localBroadcastId: string | null = null;
const broadcastId = () => localBroadcastId ??= crypto.randomUUID();
function publishSessionBinding(binding: string) {
  const previous = localStorage.getItem(CURRENT_BINDING);
  if (previous === binding) return;
  localStorage.setItem(CURRENT_BINDING, binding);
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(INVALIDATE);
  channel?.postMessage({ source: broadcastId() }); channel?.close();
}
export function invalidateSession() {
  window.dispatchEvent(new Event(INVALIDATE));
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(INVALIDATE);
  channel?.postMessage({ source: broadcastId() });
  channel?.close();
}
export async function setLogoutPending(binding: string, origin: string, session: Session) {
  const sessionKey = await cleanupBinding(origin, session);
  if (localStorage.getItem(CURRENT_BINDING) !== binding) throw new Error('SESSION_CHANGED');
  await setPrivateRenderLock();
  try {
    revokeChatOutboxes(session.accountPartition, session.csrfToken); forgetChatMemory();
    const marker = beginLogout(localStorage, binding, crypto.randomUUID(), { environment: outboxEnvironment(origin), sessionKey });
    invalidateSession();
    return marker;
  } catch (error) { await clearPrivateRenderLock().catch(() => {}); throw error; }
}
export function clearLogoutPending(expected: string) {
  if (clearLogout(localStorage, expected)) { void clearPrivateRenderLock().catch(() => {}); invalidateSession(); }
}
export type PrivateState = { kind: 'checking' | 'hidden' | 'unauthenticated' | 'logoutPending' } | { kind: 'deletionPending'; operation: string } | { kind: 'linkRequired'; session: Session } | { kind: 'error'; message: string } | { kind: 'ready'; session: Session; profile: Profile; generation: number };
const PrivateSessionContext = createContext<{ state: PrivateState; refresh: () => void; obscured: boolean } | null>(null);
export function PrivateSessionProvider({ children, initialState = { kind: 'checking' } }: { children: ReactNode; initialState?: PrivateState }) {
  const session = usePrivateSessionState(initialState);
  return <PrivateSessionContext.Provider value={session}>
    <div className={session.obscured ? 'invisible' : undefined} inert={session.obscured} aria-hidden={session.obscured}>{children}</div>
    {session.obscured && <div data-private-shield className="fixed inset-0 z-[2147483647] bg-canvas"><PageSkeleton /></div>}
  </PrivateSessionContext.Provider>;
}
export function usePrivateSession() {
  const session = useContext(PrivateSessionContext);
  if (!session) throw new Error('Missing private session provider');
  return session;
}
/** Memory only: no credentials or private response data enter browser storage. */
function usePrivateSessionState(initialState: PrivateState) {
  const api = useApi();
  const [state, setState] = useState<PrivateState>(initialState);
  const [obscured, setObscured] = useState(false);
  const generation = useRef(initialState.kind === 'ready' ? initialState.generation : 0);
  const latest = useRef<PrivateState>(initialState);
  const update = useCallback((value: PrivateState | ((previous: PrivateState) => PrivateState)) => {
    setState(previous => { const next = typeof value === 'function' ? value(previous) : value; latest.current = next; return next; });
  }, []);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const revalidate = useCallback((background = false, force = false) => {
    // Focus, pageshow and visibility can fire as one burst. One in-flight
    // verification is enough; explicit invalidation still supersedes it.
    if (!force && active.current) return;
    active.current?.abort();
    active.current = null;
    const current = ++generation.current;
    if (!mounted.current) return;
    if (document.visibilityState === 'hidden') { if (latest.current.kind !== 'unauthenticated') setObscured(true); return; }
    try {
      if (isAccountDeletionPending(browserPrivacyStore)) {
        suspendChatOutboxes(); forgetChatMemory();
        let operation = 'unreadable'; try { operation = readDeletion(browserPrivacyStore)?.operation ?? operation; } catch { /* Recovery gate exposes the unavailable state. */ }
        update({ kind: 'deletionPending', operation }); setObscured(false); return;
      }
      if (localStorage.getItem(LOGOUT_PENDING)) { forgetChatMemory(); update({ kind: 'logoutPending' }); setObscured(false); return; }
    } catch { update({ kind: 'error', message: '로그인 상태를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.' }); setObscured(false); return; }
    // Public sign-in controls contain no private data. Keep them mounted while
    // rechecking so window focus cannot swallow a click.
    // A visible tab keeps its mounted chat during a routine focus check. Explicit
    // invalidation and page hiding still lock private content synchronously.
    if (!background) update(previous => previous.kind === 'unauthenticated' ? previous : { kind: 'checking' });
    const controller = new AbortController();
    active.current = controller;
    void (async () => {
      try {
        const session = await api.session(controller.signal);
        if (session.authenticated !== true || !session.csrfToken || !['VERIFIED', 'REQUIRED'].includes(session.soopLinkStatus)) throw new ApiError(502, 'INVALID_SESSION');
        const binding = await sessionBinding(session.csrfToken);
        if (current !== generation.current || !mounted.current) return;
        if (latest.current.kind === 'ready' && latest.current.session.csrfToken !== session.csrfToken) update({ kind: 'checking' });
        publishSessionBinding(binding);
        if (!sessionAllowsChat(session)) {
          if (session.soopLinkStatus !== 'REQUIRED') throw new ApiError(403, 'FORBIDDEN');
          revokeChatOutboxes(); forgetChatMemory();
          if (current === generation.current && mounted.current) { update({ kind: 'linkRequired', session }); setObscured(false); }
          return;
        }
        // Identity is never fabricated.
        const profile = await api.profile(controller.signal);
        const confirmed = await api.session(controller.signal);
        if (confirmed.csrfToken !== session.csrfToken || confirmed.accountPartition !== session.accountPartition || confirmed.soopLinkStatus !== session.soopLinkStatus || !sessionAllowsChat(confirmed)) throw new ApiError(403, 'SESSION_CHANGED');
        if (current !== generation.current || !mounted.current) return;
        if (current === generation.current && mounted.current) {
          const previous = latest.current;
          const stableGeneration = previous.kind === 'ready' && previous.session.csrfToken === session.csrfToken && previous.session.accountPartition === session.accountPartition && previous.profile.id === profile.id ? previous.generation : current;
          update(existing => existing.kind === 'ready' && existing.generation === stableGeneration &&
            JSON.stringify(existing.session) === JSON.stringify(session) && JSON.stringify(existing.profile) === JSON.stringify(profile)
            ? existing : { kind: 'ready', session, profile, generation: stableGeneration });
          setObscured(false);
        }
      } catch (error) {
        if (current !== generation.current || !mounted.current) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) { revokeChatOutboxes(); forgetChatMemory(); }
        if (error instanceof ApiError && error.status === 401) { try { publishSessionBinding('signed-out'); } catch { /* Locked state below remains authoritative. */ } }
        update(error instanceof ApiError && error.status === 401 ? { kind: 'unauthenticated' } : { kind: 'error', message: error instanceof ApiError ? error.message : '연결을 확인할 수 없습니다. 다시 시도해 주세요.' });
        setObscured(false);
      } finally { if (active.current === controller) active.current = null; }
    })();
  }, [api, update]);
  const refresh = useCallback(() => revalidate(false, true), [revalidate]);
  useEffect(() => {
    mounted.current = true;
    const hide = () => {
      active.current?.abort(); ++generation.current;
      active.current = null;
      // Keep the mounted timeline and composer, but obscure all private pixels
      // until the resumed tab confirms its current API session.
      if (latest.current.kind !== 'unauthenticated') flushSync(() => setObscured(true));
    };
    const visibleState = () => latest.current.kind === 'ready' || latest.current.kind === 'linkRequired';
    const visibility = () => document.visibilityState === 'hidden' ? hide() : revalidate(visibleState());
    const focus = () => revalidate(visibleState());
    const resume = () => revalidate(visibleState());
    const storage = (event: StorageEvent) => { if (event.key === ACCOUNT_DELETION_PENDING || event.key === LOGOUT_PENDING || event.key === CURRENT_BINDING || event.key === null) refresh(); };
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(INVALIDATE);
    if (channel) channel.onmessage = event => { if (event.data?.source !== broadcastId()) refresh(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', resume);
    window.addEventListener('online', focus);
    window.addEventListener('focus', focus);
    window.addEventListener('storage', storage);
    window.addEventListener(INVALIDATE, refresh); window.addEventListener(PRIVACY_CHANGED, refresh);
    const initial = window.setTimeout(() => revalidate(visibleState()), 0);
    const invalidateGeneration = () => { ++generation.current; };
    return () => {
      window.clearTimeout(initial);
      mounted.current = false; invalidateGeneration(); active.current?.abort(); channel?.close();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', focus); window.removeEventListener('focus', focus); window.removeEventListener('storage', storage);
      window.removeEventListener(INVALIDATE, refresh); window.removeEventListener(PRIVACY_CHANGED, refresh);
    };
  }, [refresh, revalidate, update]);
  return { state, refresh, obscured };
}
