import { exact, uuid } from '../../features/chat/contract';
import type { Room } from './client';

/** Deployment binding wins; otherwise only the server's unique explicit marker is authoritative. */
export async function resolveDefaultRoom(request: (path: string) => Promise<unknown>, configuredId: string | null): Promise<Room | null> {
  return resolveSelectedRoom(request, configuredId, false);
}

export async function resolveSelectedRoom(request: (path: string) => Promise<unknown>, configuredId: string | null, requireJoined: boolean): Promise<Room | null> {
  let after: string | null = null;
  let found: Room | null = null;
  const cursors = new Set<string>();
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const page = exact(await request('/v1/rooms' + (after ? `?after=${encodeURIComponent(after)}` : '')), ['rooms', 'next']);
    if (!Array.isArray(page.rooms) || (page.next !== null && (typeof page.next !== 'string' || !page.next || page.next.length > 4096))) throw new Error('INVALID_ROOM_PAGE');
    for (const value of page.rooms) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_ROOM');
      const room = value as Room;
      uuid(room.roomId);
      if (typeof room.name !== 'string' || typeof room.mode !== 'string' || typeof room.joined !== 'boolean' || (room.role !== undefined && !['FAN', 'STREAMER', 'MEMBER'].includes(room.role)) || (room.isDefault !== undefined && typeof room.isDefault !== 'boolean') || (room.availability !== undefined && !['OWNER_PENDING', 'READY'].includes(room.availability))) throw new Error('INVALID_ROOM');
      if ((configuredId ? room.roomId === configuredId : room.isDefault === true) && (!requireJoined || room.joined)) {
        if (found) throw new Error('AMBIGUOUS_DEFAULT_ROOM');
        found = room;
      }
    }
    after = page.next as string | null;
    if (!after) return found;
    if (cursors.has(after)) throw new Error('INVALID_ROOM_PAGINATION');
    cursors.add(after);
  }
  throw new Error('ROOM_PAGINATION_LIMIT');
}
