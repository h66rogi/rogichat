import { MediaError } from './contracts';

/** Shared by image/video resources in one account/room scope. Reservations include in-flight bytes. */
export interface MediaByteBudget { reserve(bytes: number): () => void }
export class MediaBudget implements MediaByteBudget {
  readonly limit: number;
  private used = 0;
  constructor(limit = 64 * 1024 * 1024) { this.limit = limit; }
  get reservedBytes() { return this.used; }
  reserve(bytes: number): () => void {
    if (!Number.isSafeInteger(bytes) || bytes < 1 || this.used + bytes > this.limit) throw new MediaError('MEDIA_CAPACITY');
    this.used += bytes; let released = false;
    return () => { if (!released) { released = true; this.used -= bytes; } };
  }
}
