import { apiClient } from "@/meloming/shared/lib/api-client";
import type { SongRequestMode } from './public-session';

// Types
export type StreamPlatform = 'CHZZK' | 'SOOP' | 'TWITCH' | 'YOUTUBE' | 'AFREECA';
export type LiveSessionStatus = 'ACTIVE' | 'ENDED' | 'PAUSED';
export type KaraokePlaybackMode = 'DIRECT' | 'YOUTUBE';
export type KaraokeVideoType = 'KARAOKE' | 'ORIGINAL';

export interface StartSessionDto {
  platform?: StreamPlatform;
  platformChannelId?: string;
  practiceMode?: boolean;
}

export interface SessionSettings {
  id: number;
  requestEnabled: boolean;
  paused: boolean;
  requestCommand: string;
  maxQueueSize: number;
  donationPriorityEnabled: boolean;
  donationOnlyEnabled: boolean;
  chatRequestEnabled: boolean;
  donationRequestEnabled: boolean;
  enforceDonationMinimumPrice: boolean;
  requestMode: SongRequestMode;
  /** 익명 웹 신청 허용. PATCH 대상. */
  allowAnonymous: boolean;
  /** 웹 랜덤 신청 허용. 기본 true. */
  randomRequestEnabled: boolean;
  requireSongMatch: boolean;
  karaokePlaybackMode: KaraokePlaybackMode;
  karaokeVideoType: KaraokeVideoType;
  preventDuplicateSongs: boolean;
  blockedCategoryIds: number[];
  maxRequestsPerUser: number;
  maxTotalRequests: number;
  showRequesterName: boolean;
}

/**
 * 제거된 채팅·후원·본인인증 신청 정책의 하위 호환 값.
 *
 * 구버전 백엔드에 설정을 저장하더라도 레거시 정책이 웹 신청을 막거나
 * 후원 금액에 따라 순서를 바꾸지 않도록 명시적으로 함께 전송한다.
 */
export const LEGACY_DISABLED_REQUEST_SETTINGS = {
  requestCommand: '!신청',
  chatRequestEnabled: false,
  donationRequestEnabled: false,
  donationPriorityEnabled: false,
  donationOnlyEnabled: false,
  enforceDonationMinimumPrice: false,
  requestMode: 'EVERYONE',
} as const satisfies Pick<
  SessionSettings,
  | 'requestCommand'
  | 'chatRequestEnabled'
  | 'donationRequestEnabled'
  | 'donationPriorityEnabled'
  | 'donationOnlyEnabled'
  | 'enforceDonationMinimumPrice'
  | 'requestMode'
>;

export interface LiveSession {
  id: number;
  channelId: number;
  userId: number;
  platform: StreamPlatform;
  platformChannelId: string | null;
  status: LiveSessionStatus;
  visibility?: 'PUBLIC' | 'PRIVATE';
  overlayToken: string;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  settings?: SessionSettings;
}

export type PlaybackState = 'playing' | 'paused' | 'ended' | 'buffering' | 'unstarted';

/**
 * POST /v1/song-live/sessions
 * 신청곡 모드 세션을 시작합니다.
 */
export async function startLiveSession(
  dto: StartSessionDto,
  identifier?: string
): Promise<LiveSession> {
  const response = await apiClient.post<LiveSession>('/song-live/sessions', dto, {
    params: identifier ? { identifier } : undefined,
    withCredentials: true,
  });
  return response.data;
}

/**
 * GET /v1/song-live/sessions/active
 * 활성 세션을 조회합니다.
 */
export async function getActiveSession(
  identifier?: string
): Promise<LiveSession | null> {
  try {
    const response = await apiClient.get<LiveSession>('/song-live/sessions/active', {
      params: identifier ? { identifier } : undefined,
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    const maybeError = error as { response?: { status?: number } };
    // 404는 활성 세션 없음을 의미
    if (maybeError.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * POST /v1/song-live/sessions/:id/end
 * 신청곡 모드 세션을 종료합니다.
 */
export async function endLiveSession(sessionId: number): Promise<LiveSession> {
  const response = await apiClient.post<LiveSession>(
    `/song-live/sessions/${sessionId}/end`,
    {},
    { withCredentials: true }
  );
  return response.data;
}

/**
 * PATCH /v1/song-live/sessions/:id
 * 세션 설정을 업데이트합니다.
 */
export async function updateSessionSettings(
  sessionId: number,
  settings: Partial<Omit<SessionSettings, 'id'>>
): Promise<SessionSettings> {
  const response = await apiClient.patch<SessionSettings>(
    `/song-live/sessions/${sessionId}`,
    settings,
    { withCredentials: true }
  );
  return response.data;
}

export type LyricsPlaybackSource = 'video' | 'manual';

/**
 * 통합 anchor 모델 — video / manual 모두 동일 보간식 사용.
 *   재생 중: anchorAt 시점에 곡이 anchorMs 위치에 있었음 →
 *           `anchorMs + (now - anchorAt) * playbackRate` 로 보간
 *   정지: anchorAt = null → anchorMs 가 곧 현재 위치
 *   intent change(play/pause/seek/song change/rate change) 시에만 publish.
 */
export interface LyricsPlaybackStatePayload {
  songRequestId: number | null;
  playbackSource: LyricsPlaybackSource;
  anchorMs: number;
  anchorAt: string | null;
  playbackRate: number;
  /** 곡 총 길이(ms). nowsong widget progress bar 표시용. 0 = 미상. */
  durationMs: number;
  /** 영상-종속 사용자 보정값. song_video_preferences 와 동기화. */
  offsetMs: number;
  clientInstanceId: string;
}

/**
 * POST /v1/song-live/sessions/:id/lyrics-playback-state
 * 가사 재생 상태를 broadcast 하여 다른 콘솔/오버레이와 sync.
 */
export async function publishLyricsPlaybackState(
  sessionId: number,
  payload: LyricsPlaybackStatePayload,
): Promise<void> {
  await apiClient.post(
    `/song-live/sessions/${sessionId}/lyrics-playback-state`,
    payload,
    { withCredentials: true },
  );
}

// Session History Types
export interface SessionStats {
  totalRequests: number;
  completedCount: number;
  rejectedCount: number;
  totalDonation: number;
  pendingCount?: number;
  donationRequests?: number;
}

export interface SessionHistoryItem {
  id: number;
  platform: StreamPlatform;
  status: LiveSessionStatus;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  duration: number | null;
  stats: SessionStats;
  _count: {
    songRequests: number;
  };
}

export interface SessionHistoryResponse {
  sessions: SessionHistoryItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface SessionSongRequest {
  id: number;
  order: number;
  title: string;
  artist: string;
  requester: string;
  status: string;
  source: string;
  donationAmount: number | null;
  donationNativeAmount?: number | null;
  donationCurrency?: string | null;
  playedAt: string | null;
  completedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  albumArt?: string;
}

export interface SessionDetailResponse {
  id: number;
  platform: StreamPlatform;
  status: LiveSessionStatus;
  startedAt: string;
  endedAt: string | null;
  duration: number | null;
  channel: {
    id: number;
    name: string;
    webPath: string;
    profileImageUrl: string | null;
  };
  settings: SessionSettings | null;
  stats: SessionStats;
  songRequests: SessionSongRequest[];
}

/**
 * GET /v1/song-live/sessions/history
 * 세션 히스토리 목록을 조회합니다.
 */
export async function getSessionHistory(
  page: number = 1,
  limit: number = 10,
  identifier?: string
): Promise<SessionHistoryResponse> {
  const response = await apiClient.get<SessionHistoryResponse>(
    '/song-live/sessions/history',
    {
      params: {
        page,
        limit,
        ...(identifier ? { identifier } : {}),
      },
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * GET /v1/song-live/sessions/:id/detail
 * 세션 상세 정보를 조회합니다.
 */
export async function getSessionDetail(sessionId: number): Promise<SessionDetailResponse> {
  const response = await apiClient.get<SessionDetailResponse>(
    `/song-live/sessions/${sessionId}/detail`,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * POST /v1/song-live/sessions/:id/clone
 * 이전 세션의 설정과 신청곡을 복원하여 새 세션을 시작합니다.
 */
export async function cloneSession(
  sourceSessionId: number,
  identifier?: string
): Promise<LiveSession> {
  const response = await apiClient.post<LiveSession>(
    `/song-live/sessions/${sourceSessionId}/clone`,
    {},
    {
      params: identifier ? { identifier } : undefined,
      withCredentials: true,
    }
  );
  return response.data;
}
