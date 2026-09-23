// Ported from meloming-front f8907f37 src/domains/channel/types/song.ts.

/**
 * Domain
 */

export interface SongArtist {
  id: number;
  name: string;
  channelId: string;
  createdAt: string;
}

export interface SongCategory {
  id: number;
  name: string;
  color: string;
  price?: number | null; // 카테고리별 신청곡 가격
  currencyPrices?: Record<string, number | null> | null; // 재화별 카테고리 신청곡 가격
  channelId: string;
  createdAt: string;
}

export interface SongChannel {
  id: string;
  name: string;
  webPath: string;
  themeColor: string;
  profileImageUrl?: string | null;
  user: {
    id: string;
    nickname: string;
  };
}

export interface Song {
  id: number;
  title: string;
  artistId: number;
  channelId: string;
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
  lyricsText?: string | null;
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
  sheetMusicType?: "PDF" | "IMAGE" | "MUSICXML" | null;
}

/**
 * Phase 2 — 단일 악보 슬롯. backend SheetMusicSlotResponse 와 동일.
 */
export interface SheetMusicSlot {
  id: number;
  url: string;
  type: "PDF" | "IMAGE" | "MUSICXML";
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


export type GetSongsChannelIdentifierResponse = { songs: Song[]; total: number; page: number; limit: number };
