import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getScheduleTemplates } from "@/meloming/domains/schedule-template/apis/schedule-templates";
import { scheduleTemplateKeys } from "@/meloming/domains/schedule-template/query-keys";
import type { ScheduleTemplate } from "@/meloming/domains/schedule-template/types";

/**
 * 특정 채널의 주간 시간표 템플릿 목록을 가져오는 훅.
 *
 * 백엔드: `GET /v1/schedule-templates?channelId={channelId}` — 채널 소유자/매니저만.
 * Feature flag: `channelScheduleTemplate` (F2 UI gate 에서 사용. 이 훅 자체는 gate 안 함).
 */
export function useScheduleTemplates(
  channelId: number,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    gcTime?: number;
  }
): UseQueryResult<ScheduleTemplate[], Error> {
  return useQuery({
    queryKey: scheduleTemplateKeys.list(channelId),
    queryFn: () => getScheduleTemplates({ channelId }),
    enabled: !!channelId && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 60_000,
    gcTime: options?.gcTime ?? 5 * 60_000,
  });
}
