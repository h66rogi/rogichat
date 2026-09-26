'use client';
import { useCallback, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiError, type Session } from '@/core/api/client';
import { useApi } from '@/core/runtime/provider';
import { PrivateGate, StatePanel } from '@/features/auth/auth-panel';
import { usePrivateSession } from '@/features/auth/private-session';
import { RealChatRoom } from '@/features/chat/RealChatRoom';
import { ChatRoomSkeleton } from '@/features/chat/ChatRoomSkeleton';
import { Button } from '@/shared/ui/button';
import { useRoom } from './use-room';
import type { ChannelBootstrap } from '@/core/server/channel-bootstrap';
export function ChannelChat({ active, visit, initial }: { active: boolean; visit: number; initial: ChannelBootstrap | null }) {
  const { state, refresh, obscured } = usePrivateSession();
  const requestedRoomId = useSearchParams().get('roomId');
  if (state.kind === 'checking' || state.kind === 'hidden') return <ChatRoomSkeleton />;
  if (state.kind !== 'ready') return <PrivateGate state={state} retry={refresh} />;
  return <AuthorizedChat key={`${state.generation}:${requestedRoomId ?? ''}`} active={active && !obscured} suspended={obscured} visit={visit} session={state.session} accountId={state.profile.id} scope={`${state.profile.id}:${state.generation}`} refresh={refresh} initial={initial} />;
}
function AuthorizedChat({ active, suspended, visit, session, accountId, scope, refresh, initial }: { active: boolean; suspended: boolean; visit: number; session: Session; accountId: string; scope: string; refresh: () => void; initial: ChannelBootstrap | null }) {
  const api = useApi();
  const params = useSearchParams();
  const requestedRoomId = active ? params.get('roomId') : null;
  const targetMessageId = active ? params.get('messageId') : null;
  const validId = (value: string | null) => value === null || /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
  const state = useRoom(initial?.sessionBinding === session.csrfToken && initial.accountPartition === session.accountPartition ? initial.room : undefined, requestedRoomId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const request = useCallback((path: string, options?: { method?: 'POST' | 'PUT' | 'DELETE'; body?: unknown; signal?: AbortSignal }) => api.request(path, { ...options, csrf: session.csrfToken }), [api, session.csrfToken]);
  const join = async (roomId: string) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await request(`/v1/rooms/${encodeURIComponent(roomId)}/join`, { method: 'POST' }); refresh(); }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) { refresh(); return; }
      setError(e instanceof ApiError ? e.message : '채팅방에 들어갈 수 없어요. 다시 시도해 주세요.');
    }
    finally { pending.current = false; setBusy(false); }
  };
  if (!validId(requestedRoomId) || !validId(targetMessageId)) return <StatePanel title="메시지 위치를 열 수 없어요">알림이나 검색 결과에서 다시 열어 주세요.</StatePanel>;
  if (state.kind === 'checking') return <ChatRoomSkeleton />;
  if (state.kind === 'unconfigured') return <StatePanel title="아직 채팅방이 열리지 않았어요" retry={refresh}>후로기의 채팅방이 준비되면 여기에서 참여할 수 있습니다.</StatePanel>;
  if (state.kind === 'unavailable') return <StatePanel title="지금은 채팅방에 접근할 수 없어요" retry={refresh}>채팅방이 열려 있는지 다시 확인해 주세요.</StatePanel>;
  if (state.kind === 'error') return <StatePanel title="채팅방 정보를 가져오지 못했어요" retry={refresh}>연결 상태를 확인하고 다시 시도해 주세요.</StatePanel>;
  if (state.room.availability === 'OWNER_PENDING') return <StatePanel title="후로기 채팅방을 준비하고 있어요" retry={refresh}>방장 계정을 확인하고 있습니다. 확인이 완료되면 입장할 수 있습니다.</StatePanel>;
  if (!state.room.joined) return <StatePanel title="후로기 채팅방에 참여하기">{error && <p role="alert">{error}</p>}<Button className="mt-4" disabled={busy} onClick={() => void join(state.room.roomId)}>{busy ? '입장 확인 중' : '채팅방 입장'}</Button></StatePanel>;
  return <RealChatRoom active={active} suspended={suspended} visit={visit} session={session} accountId={accountId} key={scope + state.room.roomId} roomId={state.room.roomId} targetMessageId={targetMessageId} sessionScopeKey={scope} accountPartition={session.accountPartition} apiOrigin={api.origin} csrfToken={session.csrfToken} request={request} onInvalidate={refresh} seed={initial?.chat?.room.roomId === state.room.roomId && initial.chat.sessionBinding === session.csrfToken && initial.chat.accountPartition === session.accountPartition ? initial.chat : null} />;
}
