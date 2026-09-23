/**
 * Musixmatch integration constants.
 *
 * spec: docs/superpowers/specs/2026-04-28-musixmatch-integration-design.md
 */

export const MUSIXMATCH_API_BASE_URL_DEFAULT =
  'https://api.musixmatch.com/ws/1.1';

/**
 * Endpoint paths used by the lyrics pipeline. Analysis/fingerprint endpoints
 * remain unused.
 */
export const MXM_ENDPOINTS = {
  TRACK_SEARCH: 'track.search',
  TRACK_GET: 'track.get',
  MATCHER_TRACK_GET: 'matcher.track.get',
  MATCHER_LYRICS_GET: 'matcher.lyrics.get',
  TRACK_LYRICS_GET: 'track.lyrics.get',
  TRACK_LYRICS_TRANSLATION_GET: 'track.lyrics.translation.get',
  TRACK_SUBTITLE_GET: 'track.subtitle.get',
  TRACK_RICHSYNC_GET: 'track.richsync.get',
  TRACK_SNIPPET_GET: 'track.snippet.get',
} as const;

export type MxmEndpoint = (typeof MXM_ENDPOINTS)[keyof typeof MXM_ENDPOINTS];

/**
 * Quota bucket mapping for Grow v2 plan.
 *
 * Every call counts toward `total`. Lyrics-category endpoints additionally
 * count toward `lyrics`. The exact bucket assignment for subtitle/richsync is
 * still being verified against the dashboard counters; assume they share the
 * lyrics bucket (worst case) until verified.
 */
export type QuotaBucket =
  | 'total'
  | 'lyrics'
  | 'translations'
  | 'lyricsAnalysis'
  | 'lyricsFingerprint';

export const ENDPOINT_BUCKETS: Record<MxmEndpoint, QuotaBucket[]> = {
  [MXM_ENDPOINTS.TRACK_SEARCH]: ['total'],
  [MXM_ENDPOINTS.TRACK_GET]: ['total'],
  [MXM_ENDPOINTS.MATCHER_TRACK_GET]: ['total'],
  [MXM_ENDPOINTS.MATCHER_LYRICS_GET]: ['total', 'lyrics'],
  [MXM_ENDPOINTS.TRACK_LYRICS_GET]: ['total', 'lyrics'],
  [MXM_ENDPOINTS.TRACK_LYRICS_TRANSLATION_GET]: ['total', 'translations'],
  [MXM_ENDPOINTS.TRACK_SUBTITLE_GET]: ['total', 'lyrics'],
  [MXM_ENDPOINTS.TRACK_RICHSYNC_GET]: ['total', 'lyrics'],
  [MXM_ENDPOINTS.TRACK_SNIPPET_GET]: ['total', 'lyrics'],
};

/** Defaults reflecting Grow v2 plan limits (overridable via env). */
export const QUOTA_DEFAULTS = {
  total: 20_000,
  lyrics: 2_000,
  translations: 2_000,
  lyricsAnalysis: 1_000,
  lyricsFingerprint: 500,
} as const satisfies Record<QuotaBucket, number>;

export const MUSIXMATCH_CONFIG = {
  REQUEST_TIMEOUT_MS_DEFAULT: 10_000,
  RETRY_MAX_DEFAULT: 3,
  QUOTA_BUFFER_PCT_DEFAULT: 10,
  QUOTA_TIMEZONE_DEFAULT: 'Asia/Seoul',
} as const;
