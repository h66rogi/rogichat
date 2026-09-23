'use client';
import { useEffect, useState } from 'react';
import { ApiError, type Room } from '@/core/api/client';
import { resolveDefaultRoom } from '@/core/api/default-room';
import { invalidateSession } from '@/features/auth/private-session';
import { useApi, useDefaultRoomId } from '@/core/runtime/provider';
type RoomState = { kind: 'checking' } | { kind: 'unconfigured' } | { kind: 'unavailable' } | { kind: 'error' } | { kind: 'ready'; room: Room };
/** The configured binding is authoritative; list order and display names are not. */
export function useRoom() {
  const api = useApi();
  const roomId = useDefaultRoomId();
  const [state, setState] = useState<RoomState>({ kind: 'checking' });
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const room = await resolveDefaultRoom(path => api.request(path, { signal: controller.signal }), roomId);
        if (!controller.signal.aborted) setState(room ? { kind: 'ready', room } : { kind: roomId ? 'unavailable' : 'unconfigured' });
      } catch (e) {
        if (controller.signal.aborted) return;
        if (e instanceof ApiError && e.status === 401) invalidateSession();
        else setState({ kind: 'error' });
      }
    })();
    return () => controller.abort();
  }, [api, roomId]);
  return state;
}
