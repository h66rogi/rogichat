import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  getChannelSchedules,
  getFavoriteSchedules,
  getMySchedules,
  getSchedule,
  createChannelSchedule,
  updateSchedule,
  deleteSchedule,
  getUpcomingHighlights,
} from "@/meloming/domains/schedule/apis/schedules";
import { channelCalendarKeys } from "@/meloming/domains/calendar/hooks/use-channel-calendar";
import type {
  Schedule,
  CreateScheduleRequest,
  UpdateScheduleRequest,
  GetSchedulesQuery,
  GetSchedulesResponse,
} from "@/meloming/domains/schedule/types/schedule";

// Query keys
export const scheduleKeys = {
  all: ["schedules"] as const,
  channel: (channelId: number, query?: GetSchedulesQuery) =>
    [...scheduleKeys.all, "channel", channelId, query] as const,
  favorites: (query?: GetSchedulesQuery) =>
    [...scheduleKeys.all, "favorites", query] as const,
  mine: (query?: GetSchedulesQuery) =>
    [...scheduleKeys.all, "mine", query] as const,
  detail: (id: number) => [...scheduleKeys.all, "detail", id] as const,
  upcomingHighlights: () =>
    [...scheduleKeys.all, "upcoming-highlights"] as const,
};

function invalidateCalendarQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({
    queryKey: channelCalendarKeys.all,
  });
}

/**
 * 채널 일정 목록을 가져오는 훅
 */
export function useChannelSchedules(
  channelId: number,
  query?: GetSchedulesQuery,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    gcTime?: number;
  }
): UseQueryResult<GetSchedulesResponse, Error> {
  return useQuery({
    queryKey: scheduleKeys.channel(channelId, query),
    queryFn: () => getChannelSchedules(channelId, query),
    enabled: !!channelId && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 1 * 60 * 1000, // 1분
    gcTime: options?.gcTime ?? 5 * 60 * 1000, // 5분
  });
}

/**
 * 즐겨찾기 채널 일정 목록을 가져오는 훅
 */
export function useFavoriteSchedules(
  query?: GetSchedulesQuery,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    gcTime?: number;
  }
): UseQueryResult<GetSchedulesResponse, Error> {
  return useQuery({
    queryKey: scheduleKeys.favorites(query),
    queryFn: () => getFavoriteSchedules(query),
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 1 * 60 * 1000,
    gcTime: options?.gcTime ?? 5 * 60 * 1000,
  });
}

/**
 * 내 채널 + 내가 매니저인 채널의 일정 목록을 가져오는 훅
 */
export function useMySchedules(
  query?: GetSchedulesQuery,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    gcTime?: number;
  }
): UseQueryResult<GetSchedulesResponse, Error> {
  return useQuery({
    queryKey: scheduleKeys.mine(query),
    queryFn: () => getMySchedules(query),
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 1 * 60 * 1000,
    gcTime: options?.gcTime ?? 5 * 60 * 1000,
  });
}

/**
 * 일정 단건 조회 훅
 */
export function useSchedule(
  id: number,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    gcTime?: number;
  }
): UseQueryResult<Schedule, Error> {
  return useQuery({
    queryKey: scheduleKeys.detail(id),
    queryFn: () => getSchedule(id),
    enabled: !!id && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 1 * 60 * 1000,
    gcTime: options?.gcTime ?? 5 * 60 * 1000,
  });
}

/**
 * 채널 일정 생성 훅
 */
export function useCreateChannelSchedule(): UseMutationResult<
  Schedule,
  Error,
  { channelId: number; body: CreateScheduleRequest }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ channelId, body }) => createChannelSchedule(channelId, body),
    onSuccess: (_, variables) => {
      // 해당 채널의 모든 일정 목록 무효화 (쿼리 파라미터 무관)
      queryClient.invalidateQueries({
        queryKey: [...scheduleKeys.all, "channel", variables.channelId],
      });
      invalidateCalendarQueries(queryClient);
      // 내 일정 목록 무효화
      queryClient.invalidateQueries({
        queryKey: [...scheduleKeys.all, "mine"],
      });
    },
  });
}

/**
 * 일정 수정 훅
 */
export function useUpdateSchedule(): UseMutationResult<
  Schedule,
  Error,
  { id: number; body: UpdateScheduleRequest }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }) => updateSchedule(id, body),
    onSuccess: (data, variables) => {
      // 해당 일정 상세 무효화
      queryClient.invalidateQueries({
        queryKey: scheduleKeys.detail(variables.id),
      });
      // 해당 채널의 모든 일정 목록 무효화 (쿼리 파라미터 무관)
      queryClient.invalidateQueries({
        queryKey: [...scheduleKeys.all, "channel", data.channelId],
      });
      invalidateCalendarQueries(queryClient);
      // 내 일정 목록 무효화
      queryClient.invalidateQueries({
        queryKey: [...scheduleKeys.all, "mine"],
      });
      // 즐겨찾기 일정 목록 무효화
      queryClient.invalidateQueries({
        queryKey: [...scheduleKeys.all, "favorites"],
      });
    },
  });
}

/**
 * 일정 삭제 훅
 */
export function useDeleteSchedule(): UseMutationResult<
  void,
  Error,
  { id: number; channelId: number }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }) => deleteSchedule(id),
    onSuccess: (_, variables) => {
      // 해당 일정 상세 무효화
      queryClient.invalidateQueries({
        queryKey: scheduleKeys.detail(variables.id),
      });
      // 해당 채널의 모든 일정 목록 무효화 (쿼리 파라미터 무관)
      queryClient.invalidateQueries({
        queryKey: [...scheduleKeys.all, "channel", variables.channelId],
      });
      invalidateCalendarQueries(queryClient);
      // 내 일정 목록 무효화
      queryClient.invalidateQueries({
        queryKey: [...scheduleKeys.all, "mine"],
      });
      // 즐겨찾기 일정 목록 무효화
      queryClient.invalidateQueries({
        queryKey: [...scheduleKeys.all, "favorites"],
      });
    },
  });
}

/**
 * 다가오는 주요 일정을 가져오는 훅
 * 홈 화면용 (랜덤 7일 이내, LIVE/COLLAB)
 */
export function useUpcomingHighlights(options?: {
  enabled?: boolean;
  staleTime?: number;
  gcTime?: number;
}): UseQueryResult<Schedule[], Error> {
  return useQuery({
    queryKey: scheduleKeys.upcomingHighlights(),
    queryFn: () => getUpcomingHighlights(),
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // 5분
    gcTime: options?.gcTime ?? 10 * 60 * 1000, // 10분
  });
}
