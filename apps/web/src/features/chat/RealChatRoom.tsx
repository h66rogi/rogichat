'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
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
import { sessionChatMemory } from './chat-memory';
import { ChatController } from './chat-controller';
import type { ChatRequest } from './contract';

// Shared across mounts so delayed cleanup cannot match a newer page binding.
const wakeBindings = new WakeBindingRegistry();

export interface RealChatRoomProps {
  accountId: string;
  session: Session;
  roomId: string;
  sessionScopeKey: string;
  accountPartition: string;
  apiOrigin: string;
  csrfToken: string;
  request: ChatRequest;
  onInvalidate?: (() => void) | undefined;
}

export function RealChatRoom(props: RealChatRoomProps) {
  return <ScopedRealChatRoom key={`${props.accountPartition}:${props.sessionScopeKey}:${props.roomId}`} {...props} />;
}

function ScopedRealChatRoom({ session, accountId, roomId, apiOrigin, csrfToken, accountPartition, request, onInvalidate }: RealChatRoomProps) {
  const [controller, setController] = useState<ChatController | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const current = new ChatController(roomId, request, onInvalidate, csrfToken, accountPartition, sessionChatMemory(accountPartition, csrfToken, roomId), apiOrigin === 'https://api.qa.rogi.chat' ? 'qa' : 'production');
    let active = true;
    let stopWake: (() => void) | undefined;
    void Promise.all([sessionBinding(accountId), sessionBinding(csrfToken)]).then(([account, sessionId]) => {
      if (!active) return;
      const binding = wakeBindings.bind(account, sessionId);
      const stop = startWakeBridge({ binding,
        sync: async () => { if (active && wakeBindings.isCurrent(binding)) await current.refreshHints(); },
        worker: 'serviceWorker' in navigator ? navigator.serviceWorker : null,
        resume: window, visible: () => document.visibilityState === 'visible',
      });
      stopWake = () => { stop(); if (wakeBindings.isCurrent(binding)) wakeBindings.clear(); };
    }).catch(() => { /* Existing authenticated polling remains available when the browser cannot bind wake hints. */ });
    void current.refresh().then(() => { if (active) setController(current); });
    // The namespace is '/', with Engine.IO on this path. This is a lossy wake-up
    // channel only: no rooms, sends, presence or synthetic messages travel here.
    const socket = io(apiOrigin, {
      path: '/v1/realtime', transports: ['websocket'], upgrade: false,
      withCredentials: true, auth: { schemaVersion: 1, csrfToken },
      reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 10000,
    });
    socket.on('connect', () => { setConnected(true); void current.refresh(); });
    socket.on('sync.required', () => { void current.refresh(); });
    socket.on('disconnect', (reason) => {
      setConnected(false);
      // A server disconnect may mean session revocation; drop the whole scope.
      if (reason === 'io server disconnect') { current.dispose(); onInvalidate?.(); }
    });
    socket.on('connect_error', () => { setConnected(false); void current.refresh(); });
    const timer = window.setInterval(() => { void current.refresh(); }, 15000);
    const foreground = () => { if (document.visibilityState === 'visible') void current.refreshHints(); };
    window.addEventListener('online', foreground);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      active = false; stopWake?.(); current.dispose(); socket.removeAllListeners(); socket.disconnect();
      window.clearInterval(timer); window.removeEventListener('online', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [roomId, apiOrigin, csrfToken, accountPartition, accountId, request, onInvalidate]);
  if (!controller) return <p className="p-6 text-muted" role="status">채팅을 불러오는 중입니다.</p>;
  return <LiveRoom controller={controller} connected={connected} csrf={csrfToken} roomId={roomId} session={session} origin={apiOrigin} />;
}

function LiveRoom({ controller, connected, csrf, roomId, session, origin }: { session: Session; origin: string; controller: ChatController; connected: boolean; csrf: string; roomId: string }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [reconnecting, setReconnecting] = useState(false);
  const reconnect = async () => { if (reconnecting) return; setReconnecting(true); try { await controller.reconnectStorage(); } finally { setReconnecting(false); } };
  const lifetime = useMemo(() => controller.mediaLifetime(state.epoch), [controller, state.epoch]);
  if (state.phase === 'loading') return <p className="p-6 text-muted" role="status">채팅을 불러오는 중입니다.</p>;
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
  return <ChatPrivacyContext.Provider value={{ origin, session, controller }}><SessionMediaProvider key={state.epoch} csrf={csrf} lifetime={lifetime} roomId={roomId}><div className="flex h-full min-h-0 flex-col"><section aria-label="전송 저장소" className="shrink-0">{state.storageError && <div className="p-3"><p role="status">{state.storageError}</p><Button variant="outline" disabled={reconnecting} onClick={() => { void reconnect(); }}>{reconnecting ? '전송 저장소 연결 중' : '전송 저장소 다시 연결'}</Button></div>}</section><section aria-label="전송 결과 확인" className="shrink-0">{state.commands.map((command, index) => <div key={command.id} role="group" aria-label={`결과 미확인 전송 ${index + 1}`} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm"><span>결과 미확인 전송 {index + 1}</span><Button variant="outline" aria-label={`전송 ${index + 1} 결과 조회`} disabled={state.commandBusy} onClick={() => { void controller.reconcile(command.id); }}>결과 조회</Button>{command.canRetry && <Button variant="outline" aria-label={`전송 ${index + 1} 같은 전송 다시 시도`} disabled={state.commandBusy} onClick={() => { void controller.retry(command.id); }}>같은 전송 다시 시도</Button>}</div>)}</section><div className="min-h-0 flex-1"><ReactionContext.Provider value={{ controller, reactions: state.reactions, reactionRevision: state.reactionRevision }}><ChatRoomView
    composerMemory={controller} composerEpoch={state.epoch}
    conversationScopeKey={`${room.actorId}:${state.epoch}`}
    roomName={room.name} viewer={viewer} viewerRole={room.role} items={state.items}
    fanRecipients={recipients} fanRoomOwner={room.role === 'FAN'}
    streamerRecipients={recipients}
    onDelete={controller.remove} actionNotice={state.notice ?? undefined}
    submitBlockedReason={state.storageError ?? (state.commandBusy || reconnecting ? '이전 전송 결과를 확인하고 있습니다. 입력은 계속 작성할 수 있습니다.' : undefined)}
    onSubmit={controller.send} onLoadOlder={controller.loadOlder} hasOlder={state.hasOlder} isLoadingOlder={state.loadingOlder}
    connectionNotice={connected ? undefined : '실시간 연결을 다시 시도하고 있습니다. 메시지는 주기적으로 확인합니다.'}
  /></ReactionContext.Provider></div></div></SessionMediaProvider></ChatPrivacyContext.Provider>;
}
