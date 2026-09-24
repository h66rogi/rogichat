import { apiClient } from '@/shared/lib/api-client';

/**
 * Overlay 앱이 OBS embed 안에서 가사를 fetch 하기 위한 API.
 *
 * `GET /v1/overlay-api/songs/:songId/lyrics?token=<overlayToken>`
 * - overlay token query 로 owner channel resolve
 * - songId 가 다른 채널 song 이면 404 (cross-channel enumeration 차단)
 * - Cache-Control: no-store
 * - tracking.script: null (서버에서 강제)
 */

export type OverlayLyricsStatus =
  | 'OK'
  | 'UNLINKED'
  | 'UNMATCHED'
  | 'PENDING_LYRICS'
  | 'NO_LYRICS'
  | 'RESTRICTED'
  | 'INSTRUMENTAL'
  | 'ERROR';

export interface OverlayLyricsSong {
  id: number;
  title: string;
  artist: string;
  karaokeUrl: string | null;
}

export interface OverlayLyricsLine {
  startMs: number;
  text: string;
  koPron: string | null;
  translation: string | null;
}

export interface OverlayLyricsBody {
  body: string;
  bodyKoPron: string | null;
  bodyTranslation: string | null;
  bodyTranslationLanguage: string | null;
  language: string | null;
  synced: { format: 'lrc' | null; lines: OverlayLyricsLine[] | null };
  hasRichsync: boolean;
  richsync: unknown | null;
  copyrightLine: string | null;
  shareUrl: string | null;
  tracking: { script: string | null; pixel: string | null };
  fetchedAt: string;
  updatedAt: string;
}

export interface OverlayLyricsResponse {
  status: OverlayLyricsStatus;
  song: OverlayLyricsSong;
  globalSong?: {
    id: number;
    title: string;
    artist: string;
    albumArt: string | null;
    mxmAlbumName: string | null;
    mxmTrackLengthSec: number | null;
    primaryIsrc: string | null;
    language: string | null;
  };
  lyrics?: OverlayLyricsBody;
}

export async function getOverlayLyrics(
  token: string,
  songId: number,
): Promise<OverlayLyricsResponse> {
  const response = await apiClient.get<OverlayLyricsResponse>(
    `/overlay-api/songs/${songId}/lyrics`,
    {
      params: { token, _origin: Date.now().toString() },
    },
  );
  return response.data;
}
