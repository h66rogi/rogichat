import { createHmac } from 'node:crypto';
import { ApiError } from '../auth/auth-primitives.js';
import type { Principal } from '../auth/auth-primitives.js';
import { CursorCodec } from '../sync/cursor.js';
import type { CursorBinding } from '../sync/cursor.js';

/** Reuse the authenticated-encryption codec in a separate recovery-only domain. */
export class BlockRoomsCursor {
  private readonly codec: CursorCodec;
  private readonly scope: string;
  constructor(key: Buffer, audience: string) {
    this.scope = createHmac('sha256', key).update(`rogichat:blocked-rooms:v1:${audience}`).digest('base64url');
    this.codec = new CursorCodec(key, this.scope);
  }
  private binding(principal: Principal): CursorBinding {
    // This ordinary account-management list has no client device/cache selector.
    // Server-owned session IDs fill those codec bindings; no room authority is encoded.
    return { purpose: 'manifest', userId: principal.userId, sessionId: principal.sessionId,
      deviceId: principal.sessionId, cacheId: principal.sessionId, roomId: null, periodId: null, acl: this.scope };
  }
  after(token: unknown, principal: Principal, now: Date): string {
    if (token === undefined) return '';
    try {
      const position = this.codec.decode(token, this.binding(principal), now);
      if (position.from !== '0' || position.upper !== null || position.lastId === null) throw new Error('invalid_position');
      return position.lastId;
    } catch { throw new ApiError('INVALID_CURSOR', 400); }
  }
  next(roomId: string | null, principal: Principal, now: Date): string | null {
    return roomId === null ? null : this.codec.encode(this.binding(principal), { from: '0', upper: null, lastId: roomId }, { now, ttlSeconds: 900 });
  }
}
