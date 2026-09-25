'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Session } from '@/core/api/client';
import { sessionBinding } from '@/core/api/session-binding';
import { WakeBindingRegistry } from '@/features/push/wake';
import { startWakeBridge } from '@/features/push/wake-bridge';
import { ChatPrivacyContext } from './ChatPrivacyActions';
import { SessionMediaProvider } from '@/features/media/session-ui';
import { io } from 'socket.io-client';
import { Button } from '@/shared/ui/button';
import { ReactionContext } from './ReactionControl';
import { ChatRoomView } from './ChatRoomView';
import { ChatRoomSkeleton } from './ChatRoomSkeleton';
import { sessionChatMemory } from './chat-memory';
import { ChatController } from './chat-controller';
import type { ChatRequest } from './contract';
import type { ChatSeed } from '@/core/server/channel-bootstrap';

// Shared across mounts so delayed cleanup cannot match a newer page binding.
const wakeBindings = new WakeBindingRegistry();

export interface RealChatRoomProps {
  active: boolean;
  suspended?: boolean;
  visit: number;
  accountId: string;
  session: Session;
  roomId: string;
  sessionScopeKey: string;
  accountPartition: string;
  apiOrigin: string;
  csrfToken: string;
  request: ChatRequest;
  onInvalidate?: (() => void) | undefined;
  seed?: ChatSeed | null;
}

export function RealChatRoom(props: RealChatRoomProps) {
  return <ScopedRealChatRoom key={`${props.accountPartition}:${props.sessionScopeKey}:${props.roomId}`} {...props} />;
}

function ScopedRealChatRoom({ active, suspended = false, visit, session, accountId, roomId, apiOrigin, csrfToken, accountPartition, request, onInvalidate, seed }: RealChatRoomProps) {
  const [controller, setController] = useState<ChatController | null>(() => seed ? new ChatController(roomId, request, onInvalidate, csrfToken, accountPartition,
    typeof window === 'undefined' ? undefined : sessionChatMemory(accountPartition, csrfToken, roomId),
    typeof window === 'undefined' ? undefined : apiOrigin === 'https://api.qa.rogi.chat' ? 'qa' : 'production', seed) : null);
  const wasSuspended = useRef(false);
  useEffect(() => {
    if (seed) return;
    const current = new ChatController(roomId, request, onInvalidate, csrfToken, accountPartition, sessionChatMemory(accountPartition, csrfToken, roomId), apiOrigin === 'https://api.qa.rogi.chat' ? 'qa' : 'production');
    let mounted = true;
    queueMicrotask(() => { if (mounted) setController(current); });
    return () => { mounted = false; current.dispose(); };
  }, [roomId, apiOrigin, csrfToken, accountPartition, request, onInvalidate, seed]);
  useEffect(() => {
    if (!seed || !controller) return;
    return () => controller.dispose();
  }, [controller, seed]);

  useEffect(() => {
    if (!controller) return;
    if (!active) { controller.suspendStorage(); return; }
    controller.resumeStorage();
    return () => controller.suspendStorage();
  }, [active, controller]);

  // Keep the mounted timeline and its scroll position during route changes.
  // The controller checks the session and membership again in the background.
  useEffect(() => {
    if (suspended) { wasSuspended.current = true; return; }
    if (!active || !controller) return;
    if (wasSuspended.current) { wasSuspended.current = false; void controller.refreshAfterResume(); }
    else void controller.refreshForEntry();
  }, [active, suspended, controller, visit]);

  useEffect(() => {
    if (!active || !controller) return;
    let current = true;
    let stopWake: (() => void) | undefined;
    void Promise.all([sessionBinding(accountId), sessionBinding(csrfToken)]).then(([account, sessionId]) => {
      if (!current) return;
      const binding = wakeBindings.bind(account, sessionId);
      const stop = startWakeBridge({ binding,
        sync: async () => { if (current && wakeBindings.isCurrent(binding)) await controller.refreshHints(); },
        resumeSync: async () => { if (current && wakeBindings.isCurrent(binding)) await controller.refresh(); },
        worker: 'serviceWorker' in navigator ? navigator.serviceWorker : null,
        resume: window, visible: () => document.visibilityState === 'visible', initialSync: false,
      });
      stopWake = () => { stop(); if (wakeBindings.isCurrent(binding)) wakeBindings.clear(); };
    }).catch(() => { /* Existing authenticated polling remains available when the browser cannot bind wake hints. */ });
    // The namespace is '/', with Engine.IO on this path. This is a lossy wake-up
    // channel only: no rooms, sends, presence or synthetic messages travel here.
    const socket = io(apiOrigin, {
      path: '/v1/realtime', transports: ['websocket'], upgrade: false,
      withCredentials: true, auth: { schemaVersion: 1, csrfToken },
      reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 10000,
    });
    socket.on('connect', () => { void controller.refresh(); });
    socket.on('sync.required', () => { void controller.refresh(); });
    socket.on('disconnect', (reason) => {
      // A server disconnect may mean session revocation; drop the whole scope.
      if (reason === 'io server disconnect') { controller.dispose(); onInvalidate?.(); }
    });
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void controller.refresh(); }, 15000);
    const online = () => { if (document.visibilityState === 'visible') void controller.refresh(); };
    window.addEventListener('online', online);
    return () => {
      current = false; stopWake?.(); socket.removeAllListeners(); socket.disconnect();
      window.clearInterval(timer); window.removeEventListener('online', online);
    };
  }, [active, controller, accountId, apiOrigin, csrfToken, onInvalidate]);
  if (!controller) return <ChatRoomSkeleton />;
  return <>
    <div hidden={!active} className={!active ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
      <LiveRoom controller={controller} csrf={csrfToken} roomId={roomId} session={session} origin={apiOrigin} />
    </div>
  </>;
}

function LiveRoom({ controller, csrf, roomId, session, origin }: { session: Session; origin: string; controller: ChatController; csrf: string; roomId: string }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [reconnecting, setReconnecting] = useState(false);
  const reconnect = async () => { if (reconnecting) return; setReconnecting(true); try { await controller.reconnectStorage(); } finally { setReconnecting(false); } };
  const lifetime = useMemo(() => controller.mediaLifetime(state.epoch), [controller, state.epoch]);
  if (state.phase === 'loading') return <ChatRoomSkeleton />;
  if (state.phase === 'error' || !state.room) return (
    <section className="flex flex-col items-start gap-4 p-6" aria-label="채팅 연결">
      <p role="alert">{state.error ?? '채팅 정보를 확인하지 못했습니다.'}</p>
      <Button onClick={() => { void controller.refresh(); }}>다시 시도</Button>
    </section>
  );
  const room = state.room;
  const viewer = state.profiles.find(profile => profile.actorId === room.actorId);
  if (!viewer) return <p className="p-6" role="alert">내 참여 정보를 확인하지 못했습니다. 다시 접속해 주세요.</p>;
  const recipients = state.recipients;
  return <ChatPrivacyContext.Provider value={{ origin, session, controller }}><SessionMediaProvider key={state.epoch} csrf={csrf} lifetime={lifetime} roomId={roomId}><div className="flex h-full min-h-0 flex-col">
    <div className="min-h-0 flex-1"><ReactionContext.Provider value={{ controller, reactions: state.reactions, reactionRevision: state.reactionRevision }}><ChatRoomView
    composerMemory={controller} composerEpoch={state.epoch}
    conversationScopeKey={`${room.actorId}:${state.epoch}`}
    roomName={room.name} viewer={viewer} viewerRole={room.role} items={state.items}
    outgoing={state.outgoing} outgoingBusy={state.commandBusy} onRetryOutgoing={controller.retry}
    streamerRecipients={recipients}
    onDelete={controller.remove} actionNotice={state.notice ?? undefined}
    submitBlockedReason={state.storageError ?? undefined}
    submitBusy={state.commandBusy || reconnecting}
    onRetryBlocked={state.storageError ? () => { void reconnect(); } : undefined}
    onSubmit={controller.send} onLoadOlder={controller.loadOlder} hasOlder={state.hasOlder} isLoadingOlder={state.loadingOlder}
  /></ReactionContext.Provider></div></div></SessionMediaProvider></ChatPrivacyContext.Provider>;
}
