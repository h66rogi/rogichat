import { apiClient } from "@/meloming/shared/lib/api-client";

export type SongRequestMode = 'EVERYONE';

export interface PublicLiveSessionSettings {
  requestEnabled: boolean;
  paused: boolean;
  requestCommand: string;
  maxQueueSize: number;
  donationPriorityEnabled: boolean;
  requestMode: SongRequestMode;
  chatRequestEnabled: boolean;
  donationRequestEnabled: boolean;
  requireSongMatch: boolean;
  preventDuplicateSongs: boolean;
  blockedCategoryIds: number[];
  donationOnlyEnabled: boolean;
  /**
   * 익명 웹 신청 허용 여부. 로그인 없이 닉네임만 입력하여 신청할 수 있다.
   */
  allowAnonymous?: boolean;
  /**
   * 웹 랜덤 신청 허용 여부. false면 랜덤신청 버튼을 노출하지 않는다.
   * 기본 true (prisma default). 백엔드 prod 미배포 시점엔 undefined.
   */
  randomRequestEnabled?: boolean;
  karaokePlaybackMode?: 'DIRECT' | 'YOUTUBE';
  karaokeVideoType?: 'KARAOKE' | 'ORIGINAL';
}

export interface PublicLiveSessionResponse {
  sessionId: number | null;
  isLive: boolean;
  settings: PublicLiveSessionSettings | null;
  queueCount: number;
  canManage?: boolean;
  isPracticeMode?: boolean;
}

/**
 * GET /v1/song-live/public/active
 * 공개용 활성 세션 조회
 */
export async function getPublicActiveSession(
  identifier: string
): Promise<PublicLiveSessionResponse> {
  const response = await apiClient.get<PublicLiveSessionResponse>(
    "/song-live/public/active",
    { params: { identifier }, withCredentials: true }
  );
  return response.data;
}
