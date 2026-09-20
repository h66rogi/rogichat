'use client';
import { useCallback, useRef, useState } from 'react';
import { ApiError, type Session } from '@/core/api/client';
import { useApi } from '@/core/runtime/provider';
import { PrivateGate, StatePanel } from '@/features/auth/auth-panel';
import { usePrivateSession } from '@/features/auth/private-session';
import { RealChatRoom } from '@/features/chat/RealChatRoom';
import { Button } from '@/shared/ui/button';
import { useRoom } from './use-room';
export function ChannelChat() {
  const { state, refresh } = usePrivateSession();
  if (state.kind !== 'ready') return <PrivateGate state={state} retry={refresh} />;
  return <AuthorizedChat key={state.generation} session={state.session} scope={`${state.profile.id}:${state.generation}`} refresh={refresh} />;
}
function AuthorizedChat({ session, scope, refresh }: { session: Session; scope: string; refresh: () => void }) {
  const api = useApi();
  const state = useRoom();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const request = useCallback((path: string, options?: { method?: 'POST'; body?: unknown; signal?: AbortSignal }) => api.request(path, { ...options, csrf: session.csrfToken }), [api, session.csrfToken]);
  const join = async (roomId: string) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await request(`/v1/rooms/${encodeURIComponent(roomId)}/join`, { method: 'POST' }); refresh(); }
    catch (e) { setError(e instanceof ApiError ? e.message : '입장 결과를 확인하지 못했습니다. 다시 확인해 주세요.'); }
    finally { pending.current = false; setBusy(false); }
  };
  if (state.kind === 'checking') return <StatePanel title="채팅방 참여 상태를 확인하고 있어요" />;
  if (state.kind === 'unconfigured') return <StatePanel title="아직 채팅방이 열리지 않았어요" retry={refresh}>후로기의 채팅방이 준비되면 여기에서 참여할 수 있습니다.</StatePanel>;
  if (state.kind === 'unavailable') return <StatePanel title="지금은 채팅방에 접근할 수 없어요" retry={refresh}>채팅방이 열려 있는지 다시 확인해 주세요.</StatePanel>;
  if (state.kind === 'error') return <StatePanel title="채팅방 정보를 가져오지 못했어요" retry={refresh}>연결 상태를 확인하고 다시 시도해 주세요.</StatePanel>;
  if (!state.room.joined) return <StatePanel title="후로기 채팅방에 참여하기"><p>팬은 후로기에게 개인 메시지를 보낼 수 있습니다. 개인 메시지는 방장이 전체 공개할 수 있습니다.</p>{error && <p role="alert">{error}</p>}<Button className="mt-4" disabled={busy} onClick={() => void join(state.room.roomId)}>{busy ? '입장 확인 중' : '채팅방 입장'}</Button></StatePanel>;
  return <RealChatRoom key={scope + state.room.roomId} roomId={state.room.roomId} sessionScopeKey={scope} apiOrigin={api.origin} csrfToken={session.csrfToken} request={request} onInvalidate={refresh} />;
}
