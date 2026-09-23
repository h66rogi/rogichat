/**
 * Lifecycle events emitted by ArtistService.
 *
 * Same rationale as channel-events: emit instead of importing the Song layer
 * directly. Listeners must isolate failures.
 */

export const ARTIST_EVENTS = {
  ARTIST_DELETED: 'artist.deleted',
} as const;

export interface ArtistDeletedEvent {
  artistId: number;
  channelId: number;
}
