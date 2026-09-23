/**
 * Response DTOs for GET /global-songs/:id
 *
 * Public endpoint — returns the cross-channel streamer list for a global song.
 * Shape is authoritative per design spec Section 4.1.
 */

export interface GlobalSongArtistDto {
  id: number;
  name: string;
}

export interface GlobalSongChannelDto {
  id: number;
  name: string;
  profileImage: string | null;
  /** Streaming platform of the channel (SOOP / CHZZK / CIME / OTHER). */
  platform: string;
  /** Follower-equivalent metric; backed by user_channel_favorites in meloming. */
  followerCount: number;
  isLive: boolean;
}

export interface GlobalSongDetailResponseDto {
  id: number;
  title: string;
  artist: GlobalSongArtistDto;
  /** albumArtUrls[0] ?? null — single-url 호환. fallback chain 은 albumArtUrls 사용. */
  albumArt: string | null;
  /**
   * Album art 후보 URL 우선순위 배열 (중복 제거). 0번이 가장 우선.
   * Musixmatch → most-used Song.albumArt → GlobalSong.albumArt.
   * 첫 url 로딩 실패 시 다음 url 로 자동 fallback, 전부 실패하면 placeholder.
   */
  albumArtUrls: string[];
  /** Count of active channels (visibility=PUBLIC) that have this song registered. */
  channelCount: number;
  /** COUNT(DISTINCT Clip.id) linked via ClipChannel→Song.globalSongId where Clip.status = VISIBLE. */
  clipCount: number;
  channels: GlobalSongChannelDto[];
  /**
   * Spotify track id sourced from the Musixmatch matcher response. Renders as
   * an `open.spotify.com/embed/track/{id}` iframe on the detail page. Null
   * when the matcher hasn't run yet or Spotify has no entry for the track.
   */
  spotifyTrackId: string | null;
  /**
   * Set only when the requested id was a merged loser. Clients should update
   * any stored id / SEO URL to `id` (the canonical winner). `null` means the
   * request matched a live row directly.
   */
  mergedFrom?: number | null;
}

/**
 * Response for GET /global-songs/:id/my-registrations (JWT).
 *
 * Returns the channel ids (from the caller's owned + managed channels,
 * regardless of visibility) that have this GlobalSong registered. The
 * fan-facing `GlobalSongDetailResponseDto.channels` list is filtered to
 * `visibility=PUBLIC` so PRIVATE/UNLISTED channels never surface there —
 * this endpoint exists so the "내 노래책에 추가" UI can correctly hide the
 * Add button for already-registered channels even when they're not PUBLIC.
 */
export interface GlobalSongMyRegistrationsResponseDto {
  /** Distinct channel ids (any visibility) belonging to the caller that
   *  already have this GlobalSong. Empty when the caller has no channels or
   *  none of them have the song. */
  registeredChannelIds: number[];
  /** Resolved canonical GlobalSong id (after merge redirect). */
  globalSongId: number;
  /** Set when the requested id was a merged loser. Same contract as
   *  GlobalSongDetailResponseDto.mergedFrom. */
  mergedFrom: number | null;
}

/**
 * Response for GET /global-songs/me/registered-ids (JWT).
 *
 * Bulk variant of /global-songs/:id/my-registrations — returns every distinct
 * GlobalSong id the caller's owned + manager channels have registered, in one
 * round trip. The frontend uses this to hide the "+ 노래책에 추가" overlay on
 * SongCards the caller already owns somewhere, without firing one query per
 * card on a popular page that surfaces dozens.
 */
export interface GlobalSongMyRegisteredIdsResponseDto {
  /** Distinct GlobalSong ids the caller has under any of their owned/manager channels. */
  registeredGlobalSongIds: number[];
}
