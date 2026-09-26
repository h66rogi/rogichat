'use client';
import { useEffect, useState } from 'react';
import { ApiError, type Room } from '@/core/api/client';
import { resolveDefaultRoom, resolveSelectedRoom } from '@/core/api/default-room';
import { invalidateSession } from '@/features/auth/private-session';
import { useApi, useDefaultRoomId } from '@/core/runtime/provider';
import { usePrivateSession } from '@/features/auth/private-session';
import { useRoomBootstrap } from './room-bootstrap';
type RoomState = { kind: 'checking' } | { kind: 'unconfigured' } | { kind: 'unavailable' } | { kind: 'error' } | { kind: 'ready'; room: Room };
/** The configured binding is authoritative; list order and display names are not. */
export function useRoom(initialRoom?: Room | null, requestedRoomId?: string | null) {
  const api = useApi();
  const roomId = useDefaultRoomId();
  const bootstrap = useRoomBootstrap();
  const { state: session, obscured } = usePrivateSession();
  if (requestedRoomId && initialRoom?.roomId !== requestedRoomId) initialRoom = undefined;
  if (!requestedRoomId && initialRoom === undefined && session.kind === 'ready' && bootstrap?.sessionBinding === session.session.csrfToken && bootstrap.accountPartition === session.session.accountPartition) initialRoom = bootstrap.room;
  const [state, setState] = useState<RoomState>(initialRoom === undefined ? { kind: 'checking' } : initialRoom ? { kind: 'ready', room: initialRoom } : { kind: roomId ? 'unavailable' : 'unconfigured' });
  useEffect(() => {
    if (obscured) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const room = requestedRoomId
          ? await resolveSelectedRoom(path => api.request(path, { signal: controller.signal }), requestedRoomId, true)
          : await resolveDefaultRoom(path => api.request(path, { signal: controller.signal }), roomId);
        if (!controller.signal.aborted) setState(room ? { kind: 'ready', room } : { kind: roomId ? 'unavailable' : 'unconfigured' });
      } catch (e) {
        if (controller.signal.aborted) return;
        if (e instanceof ApiError && e.status === 401) invalidateSession();
        else setState({ kind: 'error' });
      }
    })();
    return () => controller.abort();
  }, [api, roomId, requestedRoomId, obscured]);
  return state;
}
