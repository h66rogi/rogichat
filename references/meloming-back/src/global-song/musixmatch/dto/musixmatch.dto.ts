/**
 * Musixmatch API response DTOs.
 *
 * mxm wraps every response in `{ message: { header, body } }` regardless of
 * HTTP status. The header `status_code` is the authoritative status — HTTP
 * status alone is unreliable (see spec Section 6.2). The client validates
 * both layers.
 *
 * Endpoints typed in Phase A1a:
 *   - track.search
 *   - track.get
 *   - matcher.track.get
 *   - matcher.lyrics.get
 *   - track.lyrics.get
 *   - track.lyrics.translation.get
 *   - track.subtitle.get
 *   - track.richsync.get
 */

export interface MxmEnvelope<T> {
  message: {
    header: MxmHeader;
    body: T | [];
  };
}

export interface MxmHeader {
  status_code: number;
  execute_time?: number;
  available?: number;
  /** mxm sometimes adds extra hint flags here (e.g. instrumental on subtitle.get). */
  [key: string]: unknown;
}

/** track entry inside `track_list[].track`, `body.track`, etc. */
export interface MxmTrack {
  track_id: number;
  track_name: string;
  track_name_translation_list?: unknown[];
  artist_id?: number;
  artist_name: string;
  album_id?: number;
  album_name?: string;
  commontrack_id: number;
  /** ISRC of the primary recording. May be null. */
  track_isrc?: string | null;
  /** Some responses include a list of all ISRCs for the commontrack family. */
  commontrack_isrcs?: string[];
  track_spotify_id?: string | null;
  has_lyrics: number; // 0 or 1 (mxm boolean encoding)
  has_subtitles: number;
  has_richsync: number;
  instrumental: number;
  explicit?: number;
  restricted?: number;
  num_favourite?: number;
  track_share_url?: string;
  track_edit_url?: string;
  // Album / track metadata (Phase A1f)
  album_coverart_100x100?: string;
  album_coverart_350x350?: string;
  album_coverart_500x500?: string;
  album_coverart_800x800?: string;
  track_length?: number;
  track_rating?: number;
  primary_genres?: {
    music_genre_list?: Array<{
      music_genre?: {
        music_genre_id?: number;
        music_genre_parent_id?: number;
        music_genre_name?: string;
        music_genre_name_extended?: string;
        music_genre_vanity?: string;
      };
    }>;
  };
  secondary_genres?: {
    music_genre_list?: Array<{
      music_genre?: {
        music_genre_id?: number;
        music_genre_name?: string;
      };
    }>;
  } | null;
  updated_time?: string;
  /** Future: country restriction info. May appear in track.lyrics.get response. */
  restricted_track_id?: number;
}

export interface MxmTrackSearchBody {
  track_list: Array<{ track: MxmTrack }>;
}

export interface MxmTrackGetBody {
  track: MxmTrack;
}

export interface MxmMatcherTrackBody {
  track: MxmTrack;
}

export interface MxmLyrics {
  lyrics_id: number;
  restricted?: number | null;
  instrumental?: number | null;
  explicit?: number;
  lyrics_body: string;
  lyrics_language?: string;
  script_tracking_url?: string;
  pixel_tracking_url?: string;
  html_tracking_url?: string | null;
  lyrics_copyright?: string;
  updated_time?: string;
  backlink_url?: string | null;
  /** Region restriction list (mxm uses ISO 3166 codes). May appear at lyrics level. */
  publisher_list?: unknown[];
}

export interface MxmLyricsGetBody {
  lyrics: MxmLyrics;
}

export interface MxmLyricsTranslationLine {
  matched_line?: string | null;
  description?: string | null;
  selected_language?: string | null;
}

export interface MxmLyricsTranslation {
  translation_list?: Array<
    | { translation?: MxmLyricsTranslationLine | null }
    | MxmLyricsTranslationLine
  >;
  selected_language?: string | null;
  lyrics_translation_body?: string | null;
  lyrics_copyright?: string | null;
}

export interface MxmTranslatedLyrics {
  lyrics_body?: string | null;
  selected_language?: string | null;
  restricted?: number | null;
  locked?: number | null;
  script_tracking_url?: string | null;
  pixel_tracking_url?: string | null;
  html_tracking_url?: string | null;
}

export interface MxmLyricsTranslationGetBody {
  lyrics_translation?: MxmLyricsTranslation;
  lyrics?: MxmLyrics & {
    lyrics_translated?: MxmTranslatedLyrics | null;
  };
}

export interface MxmSubtitle {
  subtitle_id: number;
  restricted?: number | null;
  subtitle_body: string;
  subtitle_length?: number;
  subtitle_language?: string;
  script_tracking_url?: string;
  pixel_tracking_url?: string;
  subtitle_copyright?: string | null;
  lyrics_copyright?: string;
  updated_time?: string;
}

export interface MxmSubtitleGetBody {
  subtitle: MxmSubtitle;
}

export interface MxmRichsync {
  richsync_id: number;
  restricted?: number;
  richsync_body: string; // JSON string of `[{ts, te, l, x }, ...]`
  richsync_length?: number;
  richsync_language?: string | null;
  lyrics_copyright?: string;
}

export interface MxmRichsyncGetBody {
  richsync: MxmRichsync;
}

/** Internal call options shared across endpoints. */
export interface MxmCallOptions {
  /**
   * Whether this call belongs to a backfill job. Backfill is gated more
   * conservatively than normal calls (90% of bucket vs 100%).
   */
  mode: 'normal' | 'backfill';
  /** Per-call retry override. Defaults to client config. */
  retryMax?: number;
}
