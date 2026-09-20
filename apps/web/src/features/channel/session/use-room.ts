'use client';
import { useEffect, useState } from 'react';
import { ApiError, type Room } from '@/core/api/client';
import { invalidateSession } from '@/features/auth/private-session';
import { useApi, useDefaultRoomId } from '@/core/runtime/provider';
type RoomState = { kind: 'checking' } | { kind: 'unconfigured' } | { kind: 'unavailable' } | { kind: 'error' } | { kind: 'ready'; room: Room };
/** The configured binding is authoritative; list order and display names are not. */
export function useRoom() {
  const api = useApi();
  const roomId = useDefaultRoomId();
  const [state, setState] = useState<RoomState>(roomId ? { kind: 'checking' } : { kind: 'unconfigured' });
  useEffect(() => {
    if (!roomId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        let after: string | null = null;
        const seen = new Set<string>();
        do {
          const page: { rooms: Room[]; next: string | null } = await api.request('/v1/rooms' + (after ? `?after=${encodeURIComponent(after)}` : ''), { signal: controller.signal });
          const room = page.rooms.find(item => item.roomId === roomId);
          if (room) { if (!controller.signal.aborted) setState({ kind: 'ready', room }); return; }
          after = page.next;
          if (after && seen.has(after)) throw new Error('Invalid room pagination');
          if (after) seen.add(after);
        } while (after);
        if (!controller.signal.aborted) setState({ kind: 'unavailable' });
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
