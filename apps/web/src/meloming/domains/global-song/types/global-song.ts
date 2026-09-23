/**
 * Public GlobalSong detail + clip + search response types.
 *
 * These shapes must match the backend `GlobalSongPublicService` DTOs in
 * `meloming-back/src/global-song/dto/*` exactly. The backend is the source of
 * truth — do NOT add fallback fields that the backend does not return.
 *
 * Spec: docs/superpowers/specs/2026-04-12-globalsong-detail-design.md §4
 */

// ---------- Detail: GET /global-songs/:id ----------

export interface GlobalSongArtist {
  id: number;
  name: string;
}

export interface GlobalSongChannel {
  id: number;
  name: string;
  profileImage: string | null;
  /** Streaming platform: SOOP / CHZZK / CIME / OTHER */
  platform: string;
  /** Follower-equivalent count (user_channel_favorites in meloming). */
  followerCount: number;
}

export interface GlobalSongDetailResponse {
  id: number;
  title: string;
  artist: GlobalSongArtist;
  /** albumArtUrls[0] ?? null — single-url 호환. */
  albumArt: string | null;
  /**
   * 우선순위 url 배열. Musixmatch → most-used Song.albumArt → GlobalSong.albumArt.
   * 클라이언트는 0번부터 onError 시 다음으로 fallback, 모두 실패하면 placeholder.
   * 서버 구버전 응답에는 없을 수 있으므로 optional.
   */
  albumArtUrls?: string[];
  /** Active channels (visibility=PUBLIC) with this song registered. */
  channelCount: number;
  /** DISTINCT visible clips linked via ClipChannel -> Song.globalSongId. */
  clipCount: number;
  channels: GlobalSongChannel[];
  /** Spotify track id sourced via the Musixmatch matcher. */
  spotifyTrackId: string | null;
}

// ---------- My registrations: GET /global-songs/:id/my-registrations ----------

export interface GlobalSongMyRegistrationsResponse {
  /** Caller's channel ids (any visibility) that already registered this song. */
  registeredChannelIds: number[];
  globalSongId: number;
  mergedFrom: number | null;
}

// ---------- By-artist: GET /global-songs/:id/by-artist ----------

export interface GlobalSongByArtistItem {
  id: number;
  title: string;
  artist: GlobalSongArtist;
  albumArt: string | null;
  channelCount: number;
}

export interface GlobalSongByArtistResponse {
  items: GlobalSongByArtistItem[];
}

// ---------- Clips: GET /global-songs/:id/clips ----------

export type GlobalSongClipSort = "popular" | "recent";

export interface GlobalSongClipQuery {
  sort?: GlobalSongClipSort;
  cursor?: string;
  limit?: number;
}

export interface GlobalSongClipChannel {
  id: number;
  name: string;
  profileImage: string | null;
}

export interface GlobalSongClip {
  id: number;
  title: string;
  thumbnailUrl: string | null;
  duration: number | null;
  platform: string;
  channel: GlobalSongClipChannel;
  viewCount: number;
  createdAt: string;
}

export interface GlobalSongClipResponse {
  items: GlobalSongClip[];
  nextCursor: string | null;
}

// ---------- Popular: GET /global-songs/popular ----------

export interface GlobalSongPopularChannel {
  id: number;
  name: string;
  profileImage: string | null;
}

export interface GlobalSongPopularItem {
  id: number;
  title: string;
  artist: GlobalSongArtist;
  /** albumArtUrls[0] ?? null — single-url 호환용. */
  albumArt: string | null;
  /**
   * 우선순위 url 배열. Musixmatch → most-used Song.albumArt → GlobalSong.albumArt.
   * 클라이언트는 0번부터 onError 시 다음으로 fallback, 모두 실패하면 placeholder.
   * 서버 구버전 응답에는 없을 수 있으므로 optional 처리.
   */
  albumArtUrls?: string[];
  channelCount: number;
  /** Up to 5 PUBLIC channels that registered this song (follower Desc). */
  topChannels: GlobalSongPopularChannel[];
}

export interface GlobalSongPopularNewcomer extends GlobalSongPopularItem {
  /** ISO-8601 timestamp of GlobalSong row creation. */
  createdAt: string;
}

export interface GlobalSongPopularTopArtist {
  id: number;
  name: string;
  /** Number of GlobalSong rows linked to this artist with channelCount > 0. */
  songCount: number;
  /** Sum of channelCount across this artist's GlobalSong rows. */
  totalChannelCount: number;
  topSongs: GlobalSongPopularItem[];
}

/** Facet wrappers — extend the base item with the metric the facet sorts on. */
export interface GlobalSongLiveNowItem extends GlobalSongPopularItem {
  liveCount: number;
}

export interface GlobalSongMostRequestedItem extends GlobalSongPopularItem {
  recentRequestCount: number;
}

export interface GlobalSongMostLikedItem extends GlobalSongPopularItem {
  likeCount: number;
}

export interface GlobalSongMostHotClipsItem extends GlobalSongPopularItem {
  clipCount: number;
  clipViewSum: number;
}

export interface GlobalSongMostDonatedItem extends GlobalSongPopularItem {
  recentDonationKrw: number;
}

export interface GlobalSongPopularResponse {
  ranking: GlobalSongPopularItem[];
  newcomers: GlobalSongPopularNewcomer[];
  topArtists: GlobalSongPopularTopArtist[];
  liveNow: GlobalSongLiveNowItem[];
  mostRequestedThisWeek: GlobalSongMostRequestedItem[];
  mostLiked: GlobalSongMostLikedItem[];
  mostHotClips: GlobalSongMostHotClipsItem[];
  mostDonated: GlobalSongMostDonatedItem[];
  /** ISO-8601 timestamp of when this snapshot was assembled. */
  generatedAt: string;
}

export type GlobalSongPopularSectionKey =
  | "ranking"
  | "live-now"
  | "most-requested"
  | "newcomers"
  | "most-liked"
  | "most-hot-clips"
  | "most-donated";

export type GlobalSongPopularSectionItem =
  | GlobalSongPopularItem
  | GlobalSongPopularNewcomer
  | GlobalSongLiveNowItem
  | GlobalSongMostRequestedItem
  | GlobalSongMostLikedItem
  | GlobalSongMostHotClipsItem
  | GlobalSongMostDonatedItem;

export interface GlobalSongPopularSectionResponse {
  section: GlobalSongPopularSectionKey;
  items: GlobalSongPopularSectionItem[];
  limit: number;
  offset: number;
  maxRank: number;
  hasNextPage: boolean;
  generatedAt: string;
}
