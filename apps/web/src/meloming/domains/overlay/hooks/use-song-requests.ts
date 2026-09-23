import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getSongRequestQueue,
  createSongRequest,
  createManualSongRequest,
  playNextSong,
  skipCurrentSong,
  playNowSong,
  updateSongRequestStatus,
  deleteSongRequest,
  cancelMySongRequest,
  updateSongRequestOrder,
  getNowPlaying,
  clearSongRequestQueue,
  getSongRequestStats,
  getChannelSongRequestHistory,
  getRequestedSongIds,
  getSongRequestOperatorStatus,
  type CreateSongRequestDto,
  type CreateManualSongRequestDto,
  type SongRequest,
  type SongRequestStatus,
  type ChannelSongRequestHistoryResponse,
} from "../apis/song-requests";

import type { QueryClient } from "@tanstack/react-query";

// recording-worker 가 클립 추출 boundary 정확도를 위해 사용하는 이벤트.
// session_id + request_id + 사용자 click 시점을 captureTime 으로 PostHog 에 적재.
function captureSongPlay(
  sessionId: number,
  data: SongRequest | null,
  action: "play_next" | "play_now",
) {
  void sessionId; void data; void action;
}

function captureSongComplete(
  sessionId: number,
  data: SongRequest | null,
  reason: "completed" | "skipped",
) {
  void sessionId; void data; void reason;
}

export const songRequestKeys = {
  all: ["song-requests"] as const,
  queue: (sessionId: number) => [...songRequestKeys.all, "queue", sessionId] as const,
  nowPlaying: (sessionId: number) => [...songRequestKeys.all, "now-playing", sessionId] as const,
  stats: (songId: number, channelId: number) => [...songRequestKeys.all, "stats", songId, channelId] as const,
  requestedSongIds: (sessionId: number) => [...songRequestKeys.all, "requested-song-ids", sessionId] as const,
  operatorStatus: (channelId: number, userId: number | null) =>
    [...songRequestKeys.all, "operator-status", channelId, userId] as const,
  channelHistory: (
    songId: number,
    channelId: number,
    page: number,
    limit: number,
  ) =>
    [
      ...songRequestKeys.all,
      "channel-history",
      songId,
      channelId,
      page,
      limit,
    ] as const,
  channelHistoryAll: () =>
    [...songRequestKeys.all, "channel-history"] as const,
  statsAll: () => [...songRequestKeys.all, "stats"] as const,
};

/**
 * 신청/취소 mutation 성공 시 호출.
 * 채널 노래책 모달이 켜져있는 곡의 history + stats 캐시를 즉시 갱신.
 * mutation 응답이 song.channelId 를 노출하지 않아 prefix 만으로 invalidate.
 * 모달 외에서는 hook 이 unmount 상태라 fetch trigger 없음 — 광범위 invalidate 의 비용 무시 가능.
 */
function invalidateSongRequestHistoryCaches(queryClient: QueryClient) {
  queryClient.invalidateQueries({
    queryKey: songRequestKeys.channelHistoryAll(),
  });
  queryClient.invalidateQueries({
    queryKey: songRequestKeys.statsAll(),
  });
}

/**
 * 대기열을 조회하는 훅
 */
export function useSongRequestQueue(sessionId: number | null, includeCompleted = false) {
  return useQuery({
    queryKey: songRequestKeys.queue(sessionId ?? 0),
    queryFn: () => getSongRequestQueue(sessionId!, includeCompleted),
    enabled: !!sessionId,
  });
}

/**
 * 현재 재생 중인 곡을 조회하는 훅
 */
export function useNowPlaying(sessionId: number | null) {
  return useQuery({
    queryKey: songRequestKeys.nowPlaying(sessionId ?? 0),
    queryFn: () => getNowPlaying(sessionId!),
    enabled: !!sessionId,
    refetchInterval: 5000, // 5초마다 폴링
  });
}

/**
 * 신청곡을 추가하는 뮤테이션 훅
 */
export function useCreateSongRequest(sessionId: number | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: Omit<CreateSongRequestDto, 'liveSessionId'>) =>
      createSongRequest({ ...dto, liveSessionId: sessionId! }),
    onSuccess: () => {
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: songRequestKeys.queue(sessionId) });
        queryClient.invalidateQueries({ queryKey: songRequestKeys.requestedSongIds(sessionId) });
      }
      invalidateSongRequestHistoryCaches(queryClient);
    },
  });
}

/**
 * 스트리머/매니저 수동 신청곡 추가 뮤테이션 훅
 */
export function useCreateManualSongRequest(sessionId: number | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateManualSongRequestDto) =>
      createManualSongRequest(sessionId!, dto),
    onSuccess: () => {
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: songRequestKeys.queue(sessionId) });
      }
      invalidateSongRequestHistoryCaches(queryClient);
    },
  });
}

/**
 * 다음 곡 재생 뮤테이션 훅
 */
export function usePlayNext(sessionId: number | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => playNextSong(sessionId!),
    onMutate: () => {
      if (!sessionId) return;
      // 직전 nowPlaying = 자연 종료된 직전 곡. 클립 추출 boundary 정밀화에 필수.
      const prev = queryClient.getQueryData<SongRequest | null>(
        songRequestKeys.nowPlaying(sessionId),
      );
      captureSongComplete(sessionId, prev ?? null, "completed");
    },
    onSuccess: (data) => {
      if (sessionId) {
        captureSongPlay(sessionId, data, "play_next");
        queryClient.invalidateQueries({ queryKey: songRequestKeys.queue(sessionId) });
        queryClient.invalidateQueries({ queryKey: songRequestKeys.nowPlaying(sessionId) });
      }
    },
  });
}

/**
 * 현재 곡 스킵 뮤테이션 훅
 */
export function useSkipCurrent(sessionId: number | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (reason?: string) => skipCurrentSong(sessionId!, reason),
    onSuccess: (data) => {
      if (sessionId) {
        captureSongComplete(sessionId, data, "skipped");
        queryClient.invalidateQueries({ queryKey: songRequestKeys.queue(sessionId) });
        queryClient.invalidateQueries({ queryKey: songRequestKeys.nowPlaying(sessionId) });
      }
    },
  });
}

/**
 * 특정 곡 즉시 재생 뮤테이션 훅
 */
export function usePlayNow(sessionId: number | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (requestId: number) => playNowSong(requestId),
    onMutate: () => {
      if (!sessionId) return;
      // 직전 nowPlaying = 다음 곡으로 cut-over 되는 직전 곡. 자연 종료로 기록.
      const prev = queryClient.getQueryData<SongRequest | null>(
        songRequestKeys.nowPlaying(sessionId),
      );
      captureSongComplete(sessionId, prev ?? null, "completed");
    },
    onSuccess: (data) => {
      if (sessionId) {
        captureSongPlay(sessionId, data, "play_now");
        queryClient.invalidateQueries({ queryKey: songRequestKeys.queue(sessionId) });
        queryClient.invalidateQueries({ queryKey: songRequestKeys.nowPlaying(sessionId) });
      }
    },
  });
}

/**
 * 신청곡 상태 변경 뮤테이션 훅
 */
export function useUpdateSongRequestStatus(sessionId: number | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      requestId,
      status,
      rejectionReason,
    }: {
      requestId: number;
      status: SongRequestStatus;
      rejectionReason?: string;
    }) => updateSongRequestStatus(requestId, status, rejectionReason),
    onSuccess: () => {
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: songRequestKeys.queue(sessionId) });
        queryClient.invalidateQueries({ queryKey: songRequestKeys.nowPlaying(sessionId) });
      }
    },
  });
}

/**
 * 신청곡 삭제 뮤테이션 훅
 */
export function useDeleteSongRequest(sessionId: number | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (requestId: number) => deleteSongRequest(requestId),
    onSuccess: () => {
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: songRequestKeys.queue(sessionId) });
        queryClient.invalidateQueries({ queryKey: songRequestKeys.requestedSongIds(sessionId) });
      }
    },
  });
}

/**
 * 내 신청곡 취소 뮤테이션 훅 (본인 PENDING 요청만)
 */
export function useCancelMySongRequest(sessionId: number | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (requestId: number) => cancelMySongRequest(requestId),
    onSuccess: () => {
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: songRequestKeys.queue(sessionId) });
        queryClient.invalidateQueries({ queryKey: songRequestKeys.requestedSongIds(sessionId) });
      }
      invalidateSongRequestHistoryCaches(queryClient);
    },
  });
}

/**
 * 대기열 순서 변경 뮤테이션 훅
 */
export function useUpdateSongRequestOrder(sessionId: number | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ requestId, newOrder }: { requestId: number; newOrder: number }) =>
      updateSongRequestOrder(requestId, newOrder),
    onSuccess: () => {
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: songRequestKeys.queue(sessionId) });
        queryClient.invalidateQueries({ queryKey: songRequestKeys.requestedSongIds(sessionId) });
      }
    },
  });
}

/**
 * 대기열 초기화 뮤테이션 훅
 */
export function useClearQueue(sessionId: number | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => clearSongRequestQueue(sessionId!),
    onSuccess: () => {
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: songRequestKeys.queue(sessionId) });
      }
    },
  });
}

/**
 * 곡별 신청 통계를 조회하는 훅
 */
export function useSongRequestStats(songId: number | undefined, channelId: number | undefined) {
  return useQuery({
    queryKey: songRequestKeys.stats(songId ?? 0, channelId ?? 0),
    queryFn: () => getSongRequestStats(songId!, channelId!),
    enabled: !!songId && !!channelId,
    staleTime: 30 * 1000,
  });
}

/**
 * 채널×곡 단위 신청 이력 조회 훅 (페이지네이션).
 * - 같은 (songId, channelId) 안에서 page 만 바뀔 때는 이전 페이지 유지(깜빡임 방지)
 * - songId/channelId 가 바뀌면 queryKey 가 달라져 새 query 로 취급
 * - staleTime 30s + 신청/취소 mutation 시 invalidate (즉시 갱신)
 */
export function useChannelSongRequestHistory(
  songId: number | undefined,
  channelId: number | undefined,
  page: number,
  limit: number = 20,
) {
  return useQuery<ChannelSongRequestHistoryResponse>({
    queryKey: songRequestKeys.channelHistory(
      songId ?? 0,
      channelId ?? 0,
      page,
      limit,
    ),
    queryFn: () =>
      getChannelSongRequestHistory({
        songId: songId!,
        channelId: channelId!,
        page,
        limit,
      }),
    enabled:
      typeof songId === "number" && typeof channelId === "number",
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * 채널에 대한 신청곡 운영자 권한을 조회하는 훅.
 * 운영자(채널 소유자/활성 매니저/사이트 관리자)는 신청 제한을 모두 우회할 수 있다.
 *
 * @param channelId 채널 ID. null이면 비활성.
 * @param userId 로그인 사용자 ID. null이면 비활성(비로그인 → 항상 false라 호출 불필요).
 *   userId를 키에 포함하여 사용자 전환 시 캐시 충돌 방지.
 */
export function useSongRequestOperatorStatus(
  channelId: number | null,
  userId: number | null,
) {
  return useQuery({
    queryKey: songRequestKeys.operatorStatus(channelId ?? 0, userId),
    queryFn: () => getSongRequestOperatorStatus(channelId!),
    enabled: !!channelId && !!userId,
    // 권한 회수 직후 UI가 빠르게 반응하도록 짧게 유지.
    // 보안상 백엔드가 최종 차단하므로 이 캐시가 잠깐 stale이어도 위험 없음.
    staleTime: 15 * 1000,
  });
}

/**
 * 세션에서 이미 신청된 곡 ID 목록을 조회하는 훅
 */
export function useRequestedSongIds(sessionId: number | null, enabled = true) {
  return useQuery({
    queryKey: songRequestKeys.requestedSongIds(sessionId ?? 0),
    queryFn: () => getRequestedSongIds(sessionId!),
    enabled: !!sessionId && enabled,
    staleTime: 10 * 1000,
    refetchInterval: 5000,
  });
}
