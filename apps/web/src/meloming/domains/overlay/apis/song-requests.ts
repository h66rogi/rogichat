import { apiClient } from "@/meloming/shared/lib/api-client";
import type { PriceSource } from "@/meloming/domains/channel/types/pricing";

// Types
export type SongRequestStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'PLAYING' | 'COMPLETED';
export type SongRequestType = 'NORMAL' | 'RANDOM';

export interface SongRequestSongArtist {
  id: number;
  name: string;
}

export interface SongRequestSongCategory {
  id: number;
  name: string;
  color: string;
}

export interface SongRequestSong {
  id: number;
  title: string;
  artist: SongRequestSongArtist;
  albumArt?: string;
  karaokeUrl?: string;
  coverUrl?: string;
  originalUrl?: string;
  mrVideoUrl?: string | null;
  // 추가 Song 정보
  lyricsLink?: string | null;
  lyricsText?: string | null;
  description?: string | null;
  difficulty?: number | null;
  proficiency?: number | null;
  songKey?: string | null;
  bpm?: number | null;
  categories?: SongRequestSongCategory[];
  /** 콘솔 키 조절(pitch shift) 저장값. -12..+12 semitone (UI 는 ±6 클램프). */
  preferredPitchSemitones?: number | null;
  /** 콘솔 가사 sync 보정값(ms). -60000..+60000. */
  preferredLyricsOffsetMs?: number | null;
}

export interface SongRequest {
  id: number;
  liveSessionId: number;
  songId?: number;
  song?: SongRequestSong;
  rawArtist: string;
  rawTitle: string;
  rawMessage?: string;
  requesterPlatformId: string;
  requesterNickname: string;
  requestUserId?: number | null;
  status: SongRequestStatus;
  source: string;
  /** NORMAL | RANDOM (랜덤 신청은 백엔드가 노래책에서 1곡 추출) */
  requestType?: SongRequestType;
  donationAmount?: number;
  donationNativeAmount?: number | null;
  donationCurrency?: string | null;
  priority: number;
  queueOrder: number;
  // 가격 정보 (신청 시점)
  calculatedPrice?: number | null;
  priceSource?: PriceSource | null;
  formattedPrice?: string;
  playedAt?: string;
  completedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SongRequestQueue {
  sessionId: number;
  queue: SongRequest[];
  nowPlaying: SongRequest | null;
  totalCount: number;
}

interface SongRequestQueueResponse {
  requests: SongRequest[];
  total: number;
}

export type SongRequestInsertPosition = 'FRONT' | 'BACK' | 'AFTER';

export interface CreateSongRequestDto {
  liveSessionId: number;
  songId?: number;
  rawArtist: string;
  rawTitle: string;
  rawMessage?: string;
  /**
   * 공개 경로에서는 서버가 로그인 유저 ID / IP 해시로 재구성하므로 클라이언트 값은 무시됨.
   * 내부 디스패처 호환을 위해 시그니처만 유지.
   */
  requesterPlatformId: string;
  requesterNickname: string;
  source?: string;
  donationAmount?: number;
  donationNativeAmount?: number | null;
  donationCurrency?: string | null;
  /**
   * 비로그인 + 채널이 allowAnonymous=true 인 경우에만 사용.
   * 서버는 "익명 (웹신청) {입력값}" 형태로 requesterNickname에 저장한다.
   */
  anonymousNickname?: string;
  /**
   * 대기열 삽입 위치 (운영자/MANUAL 경로 전용). 일반 사용자 신청에서는 무시.
   * - 'FRONT': 다음 재생 위치(맨 앞)
   * - 'BACK' (기본): 맨 뒤
   * - 'AFTER': afterRequestId 다음
   */
  position?: SongRequestInsertPosition;
  /** position='AFTER' 일 때 직전 항목의 SongRequest ID */
  afterRequestId?: number;
  /**
   * 신청 타입. 'RANDOM' 이면 songId 없이도 통과 — 백엔드가 노래책에서 1곡 추출해 신청.
   * 미지정 시 NORMAL 로 처리.
   */
  requestType?: SongRequestType;
}

export interface CreateManualSongRequestDto {
  songId?: number;
  /** reviveFromRequestId 사용 시 무시되므로 빈 문자열 가능 */
  rawArtist: string;
  /** reviveFromRequestId 사용 시 무시되므로 빈 문자열 가능 */
  rawTitle: string;
  rawMessage?: string;
  position?: SongRequestInsertPosition;
  afterRequestId?: number;
  /** 같은 세션 내 기존 SongRequest의 곡 정보를 복사해 새 row를 생성 (부활) */
  reviveFromRequestId?: number;
}

/**
 * GET /v1/song-requests
 * 대기열을 조회합니다.
 */
export async function getSongRequestQueue(
  sessionId: number,
  includeCompleted = false
): Promise<SongRequestQueue> {
  const response = await apiClient.get<SongRequestQueueResponse>('/song-requests', {
    params: { sessionId, includeCompleted },
    withCredentials: true,
  });
  return {
    sessionId,
    queue: response.data.requests,
    nowPlaying: null,
    totalCount: response.data.total,
  };
}

/**
 * POST /v1/song-requests
 * 신청곡을 추가합니다.
 */
export async function createSongRequest(dto: CreateSongRequestDto): Promise<SongRequest> {
  const response = await apiClient.post<SongRequest>('/song-requests', dto, {
    withCredentials: true,
  });
  return response.data;
}

/**
 * POST /v1/song-live/sessions/:id/manual-requests
 * 스트리머/매니저가 수동으로 신청곡을 추가합니다.
 */
export async function createManualSongRequest(
  sessionId: number,
  dto: CreateManualSongRequestDto
): Promise<SongRequest> {
  const response = await apiClient.post<SongRequest>(
    `/song-live/sessions/${sessionId}/manual-requests`,
    dto,
    {
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * POST /v1/song-requests/play-next
 * 다음 곡을 재생합니다.
 */
export async function playNextSong(sessionId: number): Promise<SongRequest | null> {
  const response = await apiClient.post<SongRequest | null>(
    '/song-requests/play-next',
    {},
    {
      params: { sessionId },
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * POST /v1/song-requests/skip-current
 * 현재 곡을 스킵합니다.
 */
export async function skipCurrentSong(
  sessionId: number,
  reason?: string
): Promise<SongRequest | null> {
  const response = await apiClient.post<SongRequest | null>(
    '/song-requests/skip-current',
    {},
    {
      params: { sessionId, reason },
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * POST /v1/song-requests/:id/play-now
 * 특정 곡을 즉시 재생합니다.
 */
export async function playNowSong(requestId: number): Promise<SongRequest> {
  const response = await apiClient.post<SongRequest>(
    `/song-requests/${requestId}/play-now`,
    {},
    { withCredentials: true }
  );
  return response.data;
}

/**
 * PATCH /v1/song-requests/:id/status
 * 신청곡 상태를 변경합니다.
 */
export async function updateSongRequestStatus(
  requestId: number,
  status: SongRequestStatus,
  rejectionReason?: string
): Promise<SongRequest> {
  const response = await apiClient.patch<SongRequest>(
    `/song-requests/${requestId}/status`,
    { status, rejectionReason },
    { withCredentials: true }
  );
  return response.data;
}

/**
 * DELETE /v1/song-requests/:id
 * 신청곡을 삭제합니다.
 */
export async function deleteSongRequest(requestId: number): Promise<void> {
  await apiClient.delete(`/song-requests/${requestId}`, {
    withCredentials: true,
  });
}

/**
 * DELETE /v1/song-requests/:id/mine
 * 로그인한 본인이 신청한 PENDING 신청곡을 취소합니다.
 */
export async function cancelMySongRequest(requestId: number): Promise<void> {
  await apiClient.delete(`/song-requests/${requestId}/mine`, {
    withCredentials: true,
  });
}

/**
 * PATCH /v1/song-requests/:id/order
 * 대기열 순서를 변경합니다.
 */
export async function updateSongRequestOrder(
  requestId: number,
  newOrder: number
): Promise<void> {
  await apiClient.patch(
    `/song-requests/${requestId}/order`,
    { newOrder },
    { withCredentials: true }
  );
}

/**
 * GET /v1/song-requests/now-playing
 * 현재 재생 중인 곡을 조회합니다.
 */
export async function getNowPlaying(sessionId: number): Promise<SongRequest | null> {
  try {
    const response = await apiClient.get<SongRequest>('/song-requests/now-playing', {
      params: { sessionId },
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    const maybeError = error as { response?: { status?: number } };
    if (maybeError.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * DELETE /v1/song-requests/queue
 * 대기열을 초기화합니다.
 */
export async function clearSongRequestQueue(
  sessionId: number
): Promise<{ deletedCount: number; message: string }> {
  const response = await apiClient.delete<{ deletedCount: number; message: string }>(
    '/song-requests/queue',
    {
      params: { sessionId },
      withCredentials: true,
    }
  );
  return response.data;
}

// --- 곡별 신청 통계 ---

export interface SongRequestStats {
  totalRequestCount: number;
  lastRequestedAt: string | null;
}

/**
 * GET /v1/song-requests/stats
 * 곡별 신청 통계를 조회합니다.
 */
export async function getSongRequestStats(
  songId: number,
  channelId: number
): Promise<SongRequestStats> {
  const response = await apiClient.get<SongRequestStats>('/song-requests/stats', {
    params: { songId, channelId },
  });
  return response.data;
}

// --- 채널×곡 신청 이력 ---

export interface ChannelSongRequestHistoryItem {
  id: number;
  /** 익명 신청은 '익명', 탈퇴 사용자는 '(탈퇴한 사용자)' 로 마스킹되어 옴 */
  requesterNickname: string;
  isAnonymous: boolean;
  status: SongRequestStatus;
  /** CHAT / DONATION / MANUAL */
  source: string;
  /** KRW 환산. DONATION 신청만 값 존재 */
  donationAmount: number | null;
  donationCurrency: string | null;
  /** ISO 8601 */
  createdAt: string;
}

export interface ChannelSongRequestHistoryPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ChannelSongRequestHistoryResponse {
  requests: ChannelSongRequestHistoryItem[];
  pagination: ChannelSongRequestHistoryPagination;
}

export interface ChannelSongRequestHistoryQuery {
  songId: number;
  channelId: number;
  page?: number;
  limit?: number;
}

/**
 * GET /v1/song-requests/history
 * 채널×곡 단위 신청 이력을 시간 역순 + 페이지네이션으로 조회.
 * REJECTED 상태는 응답에서 제외됨.
 */
export async function getChannelSongRequestHistory(
  query: ChannelSongRequestHistoryQuery
): Promise<ChannelSongRequestHistoryResponse> {
  const response = await apiClient.get<ChannelSongRequestHistoryResponse>(
    '/song-requests/history',
    {
      params: {
        songId: query.songId,
        channelId: query.channelId,
        ...(query.page !== undefined ? { page: query.page } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      },
    },
  );
  return response.data;
}

// --- 신청곡 운영자 권한 ---

export interface SongRequestOperatorStatusResponse {
  isOperator: boolean;
}

/**
 * GET /v1/song-requests/operator-status
 * 현재 사용자가 해당 채널의 신청곡 운영자(소유자/활성 매니저/사이트 관리자)인지 조회.
 * 비로그인 시 isOperator=false. 운영자는 모든 신청 제한을 우회할 수 있다.
 */
export async function getSongRequestOperatorStatus(
  channelId: number
): Promise<SongRequestOperatorStatusResponse> {
  const response = await apiClient.get<SongRequestOperatorStatusResponse>(
    '/song-requests/operator-status',
    {
      params: { channelId },
      withCredentials: true,
    }
  );
  return response.data;
}

// --- 세션의 신청된 곡 ID 목록 ---

export interface RequestedSongIdsResponse {
  songIds: number[];
}

/**
 * GET /v1/song-requests/requested-song-ids
 * 현재 세션에서 이미 신청된 곡 ID 목록을 조회합니다.
 */
export async function getRequestedSongIds(
  sessionId: number
): Promise<RequestedSongIdsResponse> {
  const response = await apiClient.get<RequestedSongIdsResponse>(
    '/song-requests/requested-song-ids',
    { params: { sessionId } }
  );
  return response.data;
}
