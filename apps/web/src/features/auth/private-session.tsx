'use client';
import { sessionAllowsChat } from '@/core/api/session-contract';
import { revokeChatOutboxes, suspendChatOutboxes } from '@/features/chat/chat-controller';
import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ApiError, type Profile, type Session } from '@/core/api/client';
import { sessionBinding } from '@/core/api/session-binding';
import { forgetChatMemory } from '@/features/chat/chat-memory';
import { useApi } from '@/core/runtime/provider';
import { cleanupBinding, outboxEnvironment } from './outbox-cleanup';
import { ACCOUNT_DELETION_PENDING, PRIVACY_CHANGED, isAccountDeletionPending, readDeletion, browserPrivacyStore } from '@/features/privacy/deletion';

import { LOGOUT_PENDING, beginLogout, clearLogout } from '@/core/api/logout-marker';
export { LOGOUT_PENDING } from '@/core/api/logout-marker';
const INVALIDATE = 'rogichat-session-invalidated';
const CURRENT_BINDING = 'rogichat.current-session-binding';
function publishSessionBinding(binding: string) {
  const previous = localStorage.getItem(CURRENT_BINDING);
  if (previous === binding) return;
  localStorage.setItem(CURRENT_BINDING, binding);
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(INVALIDATE);
  channel?.postMessage('invalidate'); channel?.close();
}
export function invalidateSession() {
  window.dispatchEvent(new Event(INVALIDATE));
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(INVALIDATE);
  channel?.postMessage('invalidate');
  channel?.close();
}
export async function setLogoutPending(binding: string, origin: string, session: Session) {
  const sessionKey = await cleanupBinding(origin, session);
  if (localStorage.getItem(CURRENT_BINDING) !== binding) throw new Error('SESSION_CHANGED');
  revokeChatOutboxes(session.accountPartition, session.csrfToken); forgetChatMemory();
  const marker = beginLogout(localStorage, binding, crypto.randomUUID(), { environment: outboxEnvironment(origin), sessionKey });
  invalidateSession();
  return marker;
}
export function clearLogoutPending(expected: string) {
  if (clearLogout(localStorage, expected)) invalidateSession();
}
export type PrivateState = { kind: 'checking' | 'hidden' | 'unauthenticated' | 'logoutPending' } | { kind: 'deletionPending'; operation: string } | { kind: 'linkRequired'; session: Session } | { kind: 'error'; message: string } | { kind: 'ready'; session: Session; profile: Profile; generation: number };
/** Memory only: no credentials or private response data enter browser storage. */
export function usePrivateSession() {
  const api = useApi();
  const [state, setState] = useState<PrivateState>({ kind: 'checking' });
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const refresh = useCallback(() => {
    active.current?.abort();
    const current = ++generation.current;
    if (!mounted.current) return;
    if (document.visibilityState === 'hidden') { setState(previous => previous.kind === 'unauthenticated' ? previous : { kind: 'hidden' }); return; }
    try {
      if (isAccountDeletionPending(browserPrivacyStore)) {
        suspendChatOutboxes(); forgetChatMemory();
        let operation = 'unreadable'; try { operation = readDeletion(browserPrivacyStore)?.operation ?? operation; } catch { /* Recovery gate exposes the unavailable state. */ }
        setState({ kind: 'deletionPending', operation }); return;
      }
      if (localStorage.getItem(LOGOUT_PENDING)) { forgetChatMemory(); setState({ kind: 'logoutPending' }); return; }
    } catch { setState({ kind: 'error', message: '브라우저 저장소에 접근할 수 없어 안전하게 로그인 상태를 확인할 수 없습니다.' }); return; }
    // Public sign-in controls contain no private data. Keep them mounted while
    // rechecking so window focus cannot swallow a click or reset terms consent.
    // Every state carrying account data still locks before the fresh read.
    setState(previous => previous.kind === 'unauthenticated' ? previous : { kind: 'checking' });
    const controller = new AbortController();
    active.current = controller;
    void (async () => {
      try {
        const session = await api.session(controller.signal);
        if (session.authenticated !== true || !session.csrfToken || !['VERIFIED', 'REQUIRED'].includes(session.soopLinkStatus)) throw new ApiError(502, 'INVALID_SESSION');
        const binding = await sessionBinding(session.csrfToken);
        if (current !== generation.current || !mounted.current) return;
        publishSessionBinding(binding);
        if (!sessionAllowsChat(session)) {
          if (session.soopLinkStatus !== 'REQUIRED') throw new ApiError(403, 'FORBIDDEN');
          revokeChatOutboxes(); forgetChatMemory();
          if (current === generation.current && mounted.current) setState({ kind: 'linkRequired', session });
          return;
        }
        // Identity is never fabricated.
        const profile = await api.profile(controller.signal);
        const confirmed = await api.session(controller.signal);
        if (confirmed.csrfToken !== session.csrfToken || confirmed.accountPartition !== session.accountPartition || confirmed.soopLinkStatus !== session.soopLinkStatus || !sessionAllowsChat(confirmed)) throw new ApiError(403, 'SESSION_CHANGED');
        if (current === generation.current && mounted.current) setState({ kind: 'ready', session, profile, generation: current });
      } catch (error) {
        if (current !== generation.current || !mounted.current) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) { revokeChatOutboxes(); forgetChatMemory(); }
        if (error instanceof ApiError && error.status === 401) { try { publishSessionBinding('signed-out'); } catch { /* Locked state below remains authoritative. */ } }
        setState(error instanceof ApiError && error.status === 401 ? { kind: 'unauthenticated' } : { kind: 'error', message: error instanceof ApiError ? error.message : '연결을 확인할 수 없습니다. 다시 시도해 주세요.' });
      }
    })();
  }, [api]);
  useEffect(() => {
    mounted.current = true;
    const hide = () => {
      active.current?.abort(); ++generation.current;
      flushSync(() => setState(previous => previous.kind === 'unauthenticated' ? previous : { kind: 'hidden' }));
    };
    const visibility = () => document.visibilityState === 'hidden' ? hide() : refresh();
    const storage = (event: StorageEvent) => { if (event.key === ACCOUNT_DELETION_PENDING || event.key === LOGOUT_PENDING || event.key === CURRENT_BINDING || event.key === null) refresh(); };
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(INVALIDATE);
    if (channel) channel.onmessage = refresh;
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', storage);
    window.addEventListener(INVALIDATE, refresh); window.addEventListener(PRIVACY_CHANGED, refresh);
    const initial = window.setTimeout(refresh, 0);
    const invalidateGeneration = () => { ++generation.current; };
    return () => {
      window.clearTimeout(initial);
      mounted.current = false; invalidateGeneration(); active.current?.abort(); channel?.close();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', refresh);
      window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); window.removeEventListener('storage', storage);
      window.removeEventListener(INVALIDATE, refresh); window.removeEventListener(PRIVACY_CHANGED, refresh);
    };
  }, [refresh]);
  return { state, refresh };
}
