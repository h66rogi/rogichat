/**
 * Gateway Playback URL API
 *
 * YouTube 영상을 meloming-media-gateway-cdn 으로 우회시키는 백엔드
 * 엔드포인트. 백엔드가 resolver 호출 + HMAC 서명 + gateway URL 조립을
 * 모두 처리한다. 브라우저는 resolver·signing secret을 알 필요 없음.
 *
 * 인증: JwtOrConsoleTokenGuard — 관리 콘솔(JWT) + 팝업 콘솔(?token=)
 * 양쪽 지원.
 */
import { apiClient } from '@/meloming/shared/lib/api-client';

export interface GatewayPlaybackResponse {
  /** gateway가 서명한 /proxy 또는 /cached URL */
  playbackUrl: string;
  /** signed URL 만료 시각 (ISO-8601) */
  expiresAt: string;
  title?: string;
  duration?: number;
  /** 'cached' = R2/CDN 경유, 'proxy' = origin live fetch */
  source: 'cached' | 'proxy';
}

/**
 * @param songId - Song.id. 있으면 backend가 R2 cache hit 우선 + 첫 재생 시 lazy warm.
 *                 없으면 매번 origin live fetch (/proxy).
 */
export async function fetchGatewayPlaybackUrl(
  sessionId: number,
  videoUrl: string,
  songId?: number | null,
): Promise<GatewayPlaybackResponse> {
  const body: { videoUrl: string; songId?: number } = { videoUrl };
  if (songId != null) body.songId = songId;
  const response = await apiClient.post<GatewayPlaybackResponse>(
    `/console-api/sessions/${sessionId}/playback-url`,
    body,
    { withCredentials: true },
  );
  return response.data;
}
