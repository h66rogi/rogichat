import type { CommonPaginationWithLimit } from "@/meloming/shared/types/common";
import type { SheetMusicType } from "@/meloming/domains/channel/components/sheet-music/utils/detectSheetMusicType";

/**
 * Domain
 */

export interface SongArtist {
  id: number;
  name: string;
  channelId: number;
  createdAt: string;
}

export interface SongCategory {
  id: number;
  name: string;
  color: string;
  price?: number | null; // 카테고리별 신청곡 가격
  currencyPrices?: Record<string, number | null> | null; // 재화별 카테고리 신청곡 가격
  channelId: number;
  createdAt: string;
}

export interface SongChannel {
  id: number;
  name: string;
  webPath: string;
  themeColor: string;
  profileImageUrl?: string | null;
  user: {
    id: number;
    nickname: string;
  };
}

export interface Song {
  id: number;
  title: string;
  artistId: number;
  channelId: number;
  albumArt: string;
  karaokeUrl: string;
  coverUrl: string | null;
  originalUrl: string | null;
  mrVideoUrl?: string | null;
  mrVideoKey?: string | null;
  difficulty: number;
  proficiency?: number | null;
  songKey: string;
  bpm: number | null;
  lyricsLink: string | null;
  lyricsText: string | null;
  description: string | null;
  price?: number | null; // 곡 자체 가격
  currencyPrices?: Record<string, number | null> | null; // 재화별 곡 가격
  globalSongId?: number | null; // GlobalSong 매칭 ID (없으면 null)
  createdAt: string;
  artist: SongArtist;
  songCategories: {
    id: number;
    songId: number;
    categoryId: number;
    category: SongCategory;
  }[];
  channel: SongChannel;
  totalFavorites: number;
  categories: SongCategory[];
  /**
   * 새 API에서 제공되는 즐겨찾기 상태 (비로그인 시 항상 false)
   */
  isFavorite?: boolean;
  /**
   * Phase 2 (2026-05-06) — 다중 슬롯 contract. 매니저 권한일 때만 응답에 포함.
   * sortOrder 오름차순 정렬됨. 빈 배열 = 매니저인데 슬롯 없음. 키 자체가 없음 = 비매니저.
   */
  sheetMusics?: SheetMusicSlot[];
  /**
   * @deprecated Phase 2C 에서 제거 예정. 첫 슬롯의 url 평탄화 (= sheetMusics[0]?.url).
   * frontend Phase 2B 마이그레이션 동안 fallback.
   */
  sheetMusicUrl?: string | null;
  /**
   * @deprecated Phase 2C 에서 제거 예정. 첫 슬롯의 type 평탄화.
   */
  sheetMusicType?: SheetMusicType | null;
}

/**
 * Phase 2 — 단일 악보 슬롯. backend SheetMusicSlotResponse 와 동일.
 */
export interface SheetMusicSlot {
  id: number;
  url: string;
  type: SheetMusicType;
  fileName: string | null;
  fileSize: number | null;
  sortOrder: number;
}

export interface AlbumArtSearch {
  albumArt: string;
  title: string;
  artistName: string;
  matchType: string;
}

/**
 * Dto
 */

export type GetSongsChannelIdentifierResponse = {
  songs: Song[];
} & CommonPaginationWithLimit;

export interface PostSongsChannelIdentifierRequestBody {
  title: string;
  artistId?: number;
  artistName?: string;
  albumArt?: string;
  karaokeUrl?: string;
  coverUrl?: string | null;
  originalUrl?: string | null;
  difficulty?: number;
  proficiency?: number | null;
  songKey?: string;
  bpm?: number | null;
  lyricsLink?: string | null;
  lyricsText?: string | null;
  description?: string | null;
  price?: number | null; // 곡 자체 가격
  currencyPrices?: Record<string, number | null> | null; // 재화별 곡 가격
  categoryIds?: number[];
  categoryNames?: string[];
  autoSearchAlbumArt?: boolean;
}

export type GetSongsChannelIdentifierSongIdResponse = Song;

/**
 * Round 2 migration: 악보 업로드/삭제는 별도 channel-scoped endpoint
 * (`POST|DELETE /v1/songs/channel/:identifier/:songId/sheet-music`) 가 담당한다.
 * PATCH body 에 `sheetMusicUrl` / `sheetMusicType` 을 넣어도 backend 가 무시하고
 * warn log 를 남기므로 더 이상 전달하지 않는다.
 */
export type PatchSongsChannelIdentifierSongIdRequestBody =
  Partial<PostSongsChannelIdentifierRequestBody>;

export interface GetSongsAlbumArtSearchResponse {
  success: true;
  result: AlbumArtSearch;
}

export interface PostSongsAlbumArtBulkSearchRequestBody {
  songs: {
    title: string;
    artist: string;
  }[];
  includeDetails: boolean;
  onlyMatched: boolean;
}

export interface PostSongsAlbumArtBulkSearchResponse {
  success: true;
  totalRequested: number;
  successCount: number;
  failCount: number;
  results: {
    success: true;
    requestIndex: number;
    requestTitle: string;
    requestArtist: string;
    result: AlbumArtSearch;
    error: string | null;
  }[];
}

export type PostSongsChannelIdentifierBulkRequestBody = {
  songs: Array<
    {
      title: string;
      albumArt?: string;
      karaokeUrl?: string;
      coverUrl?: string | null;
      originalUrl?: string | null;
      difficulty?: number;
      proficiency?: number;
      songKey?: string;
      bpm?: number | null;
      lyricsLink?: string | null;
      lyricsText?: string | null;
      description?: string | null;
      currencyPrices?: Record<string, number | null> | null;
      autoSearchAlbumArt?: boolean;
    } & (
      | {
          artistName: string;
          categoryNames?: string[];
        }
      | {
          artistId: number;
          categoryIds?: number[];
        }
    )
  >;
};

export interface PostSongsChannelIdentifierBulkResponse {
  success: true;
  createdCount: number;
  skippedCount?: number;
  newArtistsCount: number;
  newCategoriesCount: number;
  songs: {
    id: number;
    title: string;
  }[];
  skippedSongs?: {
    title: string;
    artistName?: string;
    artistId?: number;
    reason: "duplicate_in_request" | "already_exists";
  }[];
}

export interface SongAutocompleteItem {
  id: number;
  title: string;
  artistId: number;
  artistName: string;
}

export interface SongAutocompleteResponse {
  suggestions: SongAutocompleteItem[];
}

export interface SongArtistSuggestion {
  artistId: number | null;
  artistName: string;
  isExisting: boolean;
  matchCount?: number;
}

export interface SongArtistSuggestResponse {
  suggestions: SongArtistSuggestion[];
  canCreateNew: boolean;
}

export interface SongAutocompleteItem {
  id: number;
  title: string;
  artistId: number;
  artistName: string;
}

export interface SongAutocompleteResponse {
  suggestions: SongAutocompleteItem[];
}

export interface SongArtistSuggestion {
  artistId: number | null;
  artistName: string;
  isExisting: boolean;
  matchCount?: number;
}

export interface SongArtistSuggestResponse {
  suggestions: SongArtistSuggestion[];
  canCreateNew: boolean;
}
