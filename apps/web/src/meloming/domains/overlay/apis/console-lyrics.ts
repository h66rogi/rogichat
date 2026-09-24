/**
 * 콘솔 가사 조회 API (Phase B1).
 *
 * 인증: JwtOrConsoleTokenGuard — 일반 매니저/owner는 JWT, 팝업 콘솔은
 * `/console/[user]?token=...` interceptor로 자동 부착.
 *
 * spec: docs/superpowers/specs/2026-04-29-musixmatch-console-lyrics-design.md
 */
import { apiClient } from '@/meloming/shared/lib/api-client';

export type ConsoleLyricsStatus =
  | 'OK'
  | 'UNLINKED'
  | 'UNMATCHED'
  | 'PENDING_LYRICS'
  | 'NO_LYRICS'
  | 'RESTRICTED'
  | 'INSTRUMENTAL'
  | 'ERROR';

export interface ConsoleLyricsLine {
  startMs: number;
  text: string;
  koPron: string | null;
  translation: string | null;
}

export interface ConsoleLyricsSong {
  id: number;
  title: string;
  artist: string;
  karaokeUrl: string | null;
}

export interface ConsoleLyricsGlobalSong {
  id: number;
  title: string;
  artist: string;
  albumArt: string | null;
  mxmAlbumName: string | null;
  mxmTrackLengthSec: number | null;
  primaryIsrc: string | null;
  language: string | null;
  genres: Array<{ id?: number; name?: string; vanity?: string }> | null;
}

export interface ConsoleLyricsBody {
  body: string;
  bodyKoPron: string | null;
  bodyTranslation: string | null;
  bodyTranslationLanguage: string | null;
  language: string | null;
  synced: {
    format: 'lrc' | null;
    lines: ConsoleLyricsLine[] | null;
  };
  hasRichsync: boolean;
  richsync: unknown | null;
  copyrightLine: string | null;
  shareUrl: string | null;
  tracking: { script: string | null; pixel: string | null };
  fetchedAt: string;
  updatedAt: string;
}

export interface ConsoleLyricsResponse {
  status: ConsoleLyricsStatus;
  song: ConsoleLyricsSong;
  globalSong?: ConsoleLyricsGlobalSong;
  lyrics?: ConsoleLyricsBody;
}

export async function getConsoleLyrics(
  identifier: string,
  songId: number,
  options: { includeRichsync?: boolean } = {},
): Promise<ConsoleLyricsResponse> {
  const params: Record<string, string> = { _origin: Date.now().toString() };
  if (options.includeRichsync) params.include = 'richsync';

  const response = await apiClient.get<ConsoleLyricsResponse>(
    `/console-api/songs/channel/${encodeURIComponent(identifier)}/${songId}/lyrics`,
    {
      params,
      withCredentials: true,
    },
  );
  return response.data;
}
