'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { io } from 'socket.io-client';
import { Button } from '@/shared/ui/button';
import { ReactionContext } from './ReactionControl';
import { ChatRoomView } from './ChatRoomView';
import { ChatController } from './chat-controller';
import type { ChatRequest } from './contract';

export interface RealChatRoomProps {
  roomId: string;
  sessionScopeKey: string;
  apiOrigin: string;
  csrfToken: string;
  request: ChatRequest;
  onInvalidate?: (() => void) | undefined;
}

export function RealChatRoom(props: RealChatRoomProps) {
  return <ScopedRealChatRoom key={`${props.sessionScopeKey}:${props.roomId}`} {...props} />;
}

function ScopedRealChatRoom({ roomId, apiOrigin, csrfToken, request, onInvalidate }: RealChatRoomProps) {
  const [controller, setController] = useState<ChatController | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const current = new ChatController(roomId, request, onInvalidate, csrfToken);
    let active = true;
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
    const foreground = () => { if (document.visibilityState === 'visible') void current.refresh(); };
    window.addEventListener('online', foreground);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      active = false; current.dispose(); socket.removeAllListeners(); socket.disconnect();
      window.clearInterval(timer); window.removeEventListener('online', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [roomId, apiOrigin, csrfToken, request, onInvalidate]);
  if (!controller) return <p className="p-6 text-muted" role="status">채팅을 불러오는 중입니다.</p>;
  return <LiveRoom controller={controller} connected={connected} />;
}

function LiveRoom({ controller, connected }: { controller: ChatController; connected: boolean }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
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
  return <ReactionContext.Provider value={{ controller, reactions: state.reactions, reactionRevision: state.reactionRevision }}><ChatRoomView
    conversationScopeKey={`${room.actorId}:${state.epoch}`}
    roomName={room.name} viewer={viewer} viewerRole={room.role} items={state.items}
    fanRecipients={recipients}
    streamerRecipients={recipients}
    onDelete={controller.remove} actionNotice={state.notice ?? undefined}
    onSubmit={controller.send} onLoadOlder={controller.loadOlder} hasOlder={state.hasOlder} isLoadingOlder={state.loadingOlder}
    connectionNotice={connected ? undefined : '실시간 연결을 다시 시도하고 있습니다. 메시지는 주기적으로 확인합니다.'}
  /></ReactionContext.Provider>;
}
