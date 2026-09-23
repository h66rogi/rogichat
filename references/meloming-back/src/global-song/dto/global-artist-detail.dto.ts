/**
 * Response DTO for GET /global-artists/:id
 *
 * Public endpoint — artist hero data for the /artist/[id] page.
 * Cover art is borrowed from the most popular GlobalSong (since GlobalArtist
 * itself doesn't carry an image), matching the Spotify-style "show the
 * top track's cover when the artist has no portrait" pattern.
 */

export interface GlobalArtistDetailResponseDto {
  id: number;
  name: string;
  /** albumArt of the most-popular GlobalSong (channelCount DESC). null if none. */
  albumArt: string | null;
  /** GlobalSongs of this artist with channelCount > 0. */
  songCount: number;
  /** DISTINCT PUBLIC channels covering any of this artist's songs. */
  channelCount: number;
  /** DISTINCT visible clips across all of this artist's songs (PUBLIC channel). */
  clipCount: number;
  /**
   * Set only when the requested id was a merged loser. Clients should update
   * any stored id / SEO URL to `id`. `null` when the request matched a live row.
   */
  mergedFrom?: number | null;
}
