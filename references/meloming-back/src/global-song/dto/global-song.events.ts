/**
 * Event name constants and payload interfaces for global-song index sync.
 *
 * Published by SongMutationService after song create/update/delete operations,
 * consumed by GlobalSongIndexerService asynchronously. All listeners must wrap
 * handlers in try/catch — errors must NEVER propagate back to the emitter.
 */

export const GLOBAL_SONG_EVENTS = {
  SONG_CREATED: 'global-song.song-created',
  SONG_UPDATED: 'global-song.song-updated',
  SONG_DELETED: 'global-song.song-deleted',
  /**
   * Emitted AFTER a Song has been indexed and its globalSongId set. Consumed
   * by Musixmatch matcher (Phase A1b+) to attempt mxm matching for any
   * GlobalSong currently in PENDING state.
   *
   * NOT emitted from rebuild/bootstrap — those use indexSong() directly
   * without going through the event handlers, so 30K bootstrap calls
   * cannot trigger 30K mxm matching attempts.
   */
  SONG_INDEXED: 'global-song.song-indexed',
} as const;

export type GlobalSongEventName =
  (typeof GLOBAL_SONG_EVENTS)[keyof typeof GLOBAL_SONG_EVENTS];

/** Minimal song snapshot carried in events. */
export interface SongEventSnapshot {
  id: number;
  title: string;
  artistId: number;
  channelId: number;
  albumArt: string | null;
}

export interface SongCreatedEvent {
  song: SongEventSnapshot;
  artistName: string;
  channelId: number;
  /**
   * Category names attached to the song at creation time. Passed through so
   * the indexer does not need to requery. Empty array means no categories.
   */
  categoryNames: string[];
}

/**
 * Update event carries both old and new song data so the indexer can
 * remove stale Redis keys before re-indexing.
 */
export interface SongUpdatedEvent {
  oldSong: SongEventSnapshot;
  oldArtistName: string;
  oldCategoryNames: string[];
  newSong: SongEventSnapshot;
  newArtistName: string;
  newCategoryNames: string[];
  channelId: number;
}

/**
 * Emitted after `indexSong()` completes from a real-time event handler
 * (SONG_CREATED / SONG_UPDATED). Carries the GlobalSong id so downstream
 * consumers (Musixmatch matcher) can decide whether to act based on
 * matcherStatus.
 */
export interface SongIndexedEvent {
  globalSongId: number;
  /**
   * The Song.id whose creation/update triggered the indexing. Useful when
   * the listener needs Song-scoped context (channelId for permission, etc.).
   */
  songId: number;
  /**
   * True if this indexing created a new (channel, globalSongId) mapping.
   * False on idempotent re-index. Consumers can use this to dedupe work.
   */
  isNewChannelMapping: boolean;
}

export interface SongDeletedEvent {
  songId: number;
  title: string;
  artistName: string;
  channelId: number;
  /**
   * Category names captured BEFORE the song row was deleted. Required —
   * cascade delete removes song_categories rows so the indexer cannot
   * requery them after the fact.
   */
  categoryNames: string[];
}
