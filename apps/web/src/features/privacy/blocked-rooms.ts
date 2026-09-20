import { ApiError, type Session } from '../../core/api/client';
import { exact, uuid } from '../chat/contract';
import type { PrivacyClient } from './client';

export interface BlockedRoom { roomId: string; displayName: string | null }
export interface BlockedRoomPage { rooms: BlockedRoom[]; nextCursor: string | null }
export function blockedRoomPage(value: unknown): BlockedRoomPage {
  const data = exact(value, ['rooms', 'nextCursor']);
  if (!Array.isArray(data.rooms) || data.rooms.length > 50 || (data.nextCursor !== null && (typeof data.nextCursor !== 'string' || !data.nextCursor.length || data.nextCursor.length > 2200))) throw new Error('INVALID_RESPONSE');
  const rooms = data.rooms.map(value => {
    const row = exact(value, ['roomId', 'displayName']);
    if (row.displayName !== null && typeof row.displayName !== 'string') throw new Error('INVALID_RESPONSE');
    return { roomId: uuid(row.roomId), displayName: row.displayName };
  });
  if (new Set(rooms.map(room => room.roomId)).size !== rooms.length) throw new Error('INVALID_RESPONSE');
  return { rooms, nextCursor: data.nextCursor as string | null };
}
export interface BlockedRoomsState extends BlockedRoomPage { phase: 'idle' | 'loading' | 'ready' | 'error'; restarted: boolean }
/** Memory-only own-room discovery. Membership lists and cached names are never consulted. */
export class BlockedRoomsFlow {
  private abort = new AbortController(); private generation = 0; private disposed = false;
  private api: PrivacyClient; private session: Session; private changed: (state: BlockedRoomsState) => void;
  constructor(api: PrivacyClient, session: Session, changed: (state: BlockedRoomsState) => void) { this.api = api; this.session = session; this.changed = changed; }
  dispose() { this.disposed = true; this.generation++; this.abort.abort(); }
  async load(cursor: string | null = null): Promise<void> {
    if (this.disposed) return;
    this.abort.abort(); this.abort = new AbortController();
    const signal = this.abort.signal, generation = ++this.generation;
    const guard = () => { signal.throwIfAborted(); if (this.disposed || generation !== this.generation) throw new Error('STALE_REQUEST'); };
    const verify = async () => {
      const current = await this.api.session(signal); guard();
      if (current.csrfToken !== this.session.csrfToken || current.accountPartition !== this.session.accountPartition || current.soopLinkStatus !== this.session.soopLinkStatus) throw new Error('SESSION_CHANGED');
    };
    this.changed({ phase: 'loading', rooms: [], nextCursor: null, restarted: false });
    let next = cursor, restarted = false; const seen = new Set<string>();
    try {
      for (let count = 0; count < 200; count++) {
        await verify();
        let page: BlockedRoomPage;
        try { page = await this.api.blockedRooms(next, signal); }
        catch (error) {
          guard();
          if (!restarted && next !== null && error instanceof ApiError && error.status === 400 && error.code === 'INVALID_CURSOR') {
            restarted = true; next = null; seen.clear(); continue;
          }
          throw error;
        }
        guard(); await verify();
        if (page.nextCursor !== null && (page.nextCursor === next || seen.has(page.nextCursor))) throw new Error('INVALID_CURSOR_CYCLE');
        if (page.nextCursor !== null) seen.add(page.nextCursor);
        // Scanned memberships may have no surviving blocks. Only null proves the end.
        if (page.rooms.length || page.nextCursor === null) {
          this.changed({ ...page, phase: 'ready', restarted }); return;
        }
        next = page.nextCursor;
      }
      throw new Error('DISCOVERY_LIMIT');
    } catch {
      if (!this.disposed && generation === this.generation && !signal.aborted) this.changed({ phase: 'error', rooms: [], nextCursor: null, restarted });
    }
  }
}
