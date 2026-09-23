import { apiClient } from "@/meloming/shared/lib/api-client";

// ---------- Match ----------

export interface MatchResult {
  globalSongId: number;
  title: string;
  artist: string;
  albumArt: string | null;
  channelCount: number;
  matchConfidence: "HIGH" | "MEDIUM" | "LOW";
  matchMethod: "EXACT" | "ALIAS" | "FUZZY" | "AI";
  alreadyInChannel?: boolean;
  topCategories: string[];
}

export interface MatchResponse {
  results: MatchResult[];
  query: { parsedTitle: string; parsedArtist: string | null };
}

export async function matchGlobalSongs(
  query: string,
  channelId?: number,
  limit?: number,
): Promise<MatchResponse> {
  const { data } = await apiClient.post<MatchResponse>(
    "/global-songs/match",
    { query, channelId, limit },
    { withCredentials: true },
  );
  return data;
}

// ---------- Quick Add ----------

export interface QuickAddRequest {
  globalSongId: number;
  categoryIds?: number[];
  categoryNames?: string[];
  /**
   * Legacy nested overrides — kept for back-compat with the original
   * `add-song-quick-content` flow. New code should use the flat fields below.
   */
  overrides?: {
    difficulty?: number;
    songKey?: string;
    bpm?: number;
  };

  // ---------------------------------------------------------------------------
  // Optional metadata for the full prefill modal flow. All fields are optional;
  // omitted ones fall back to GlobalSong metadata or defaults on the server.
  // Identity fields (title / artist / albumArt) are pulled from the canonical
  // GlobalSong row server-side, except `albumArt` which acts as a per-channel
  // override here.
  // ---------------------------------------------------------------------------

  albumArt?: string;
  autoSearchAlbumArt?: boolean;
  karaokeUrl?: string;
  coverUrl?: string;
  originalUrl?: string;
  lyricsLink?: string;
  lyricsText?: string;
  description?: string;
  difficulty?: number;
  proficiency?: number;
  songKey?: string;
  bpm?: number;
  price?: number;
  currencyPrices?: Record<string, number | null> | null;
}

export interface QuickAddResponse {
  song: any;
  recommendations: Array<{
    globalSongId: number;
    title: string;
    artist: string;
    albumArt: string | null;
    score: number;
    reason: string;
    channelCount: number;
    topCategories: string[];
  }>;
}

export async function quickAddGlobalSong(
  channelId: number,
  body: QuickAddRequest,
): Promise<QuickAddResponse> {
  const { data } = await apiClient.post<QuickAddResponse>(
    `/global-songs/quick-add/channel/${channelId}`,
    body,
    { withCredentials: true },
  );
  return data;
}

// ---------- Recommendations ----------

export interface RecommendationItem {
  globalSongId: number;
  title: string;
  artist: string;
  albumArt: string | null;
  score: number;
  reason: string;
  channelCount: number;
  topCategories: string[];
}

export interface RecommendationsResponse {
  recommendations: RecommendationItem[];
  metadata: {
    basedOnSongCount: number;
    lastCalculated: string | null;
  };
}

export async function getRecommendations(
  channelId: number,
  limit = 20,
  offset = 0,
): Promise<RecommendationsResponse> {
  const { data } = await apiClient.get<RecommendationsResponse>(
    `/global-songs/recommendations/channel/${channelId}`,
    { params: { limit, offset }, withCredentials: true },
  );
  return data;
}
