import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  getRecurringSchedules,
  saveRecurringSchedules,
} from "@/meloming/domains/schedule/apis/recurring-schedules";
import type {
  RecurringSchedulesResponse,
  SaveRecurringSchedulesRequest,
} from "@/meloming/domains/schedule/types/recurring-schedule";
import { scheduleKeys } from "./use-schedules";

// Query keys for recurring schedules
export const recurringScheduleKeys = {
  all: ["recurring-schedules"] as const,
  channel: (channelId: number) =>
    [...recurringScheduleKeys.all, "channel", channelId] as const,
};

/**
 * 채널 반복 일정 목록을 가져오는 훅
 */
export function useRecurringSchedules(
  channelId: number,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    gcTime?: number;
  }
): UseQueryResult<RecurringSchedulesResponse, Error> {
  return useQuery({
    queryKey: recurringScheduleKeys.channel(channelId),
    queryFn: () => getRecurringSchedules(channelId),
    enabled: !!channelId && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 1 * 60 * 1000, // 1분
    gcTime: options?.gcTime ?? 5 * 60 * 1000, // 5분
  });
}

/**
 * 채널 반복 일정 저장 훅
 */
export function useSaveRecurringSchedules(): UseMutationResult<
  RecurringSchedulesResponse,
  Error,
  { channelId: number; body: SaveRecurringSchedulesRequest }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ channelId, body }) =>
      saveRecurringSchedules(channelId, body),
    onSuccess: (_, variables) => {
      // 해당 채널의 반복 일정 목록 무효화
      queryClient.invalidateQueries({
        queryKey: recurringScheduleKeys.channel(variables.channelId),
      });
      // 해당 채널의 모든 일정 목록 무효화 (자동 생성된 일정 반영)
      queryClient.invalidateQueries({
        queryKey: [...scheduleKeys.all, "channel", variables.channelId],
      });
      // 내 일정 목록 무효화
      queryClient.invalidateQueries({
        queryKey: [...scheduleKeys.all, "mine"],
      });
    },
  });
}
