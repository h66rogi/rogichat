import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getScheduleTemplate } from "@/meloming/domains/schedule-template/apis/schedule-templates";
import { scheduleTemplateKeys } from "@/meloming/domains/schedule-template/query-keys";
import type { ScheduleTemplate } from "@/meloming/domains/schedule-template/types";

/**
 * 템플릿 단건(편집용) 을 가져오는 훅.
 *
 * 백엔드: `GET /v1/schedule-templates/:id` — 채널 소유자/매니저만.
 * Feature flag: `channelScheduleTemplate` (F2 UI gate 에서 사용).
 */
export function useScheduleTemplate(
  id: number | undefined,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    gcTime?: number;
  }
): UseQueryResult<ScheduleTemplate, Error> {
  return useQuery({
    queryKey: scheduleTemplateKeys.detail(id ?? 0),
    queryFn: () => {
      if (!id) throw new Error("useScheduleTemplate: id is required");
      return getScheduleTemplate(id);
    },
    enabled: !!id && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 60_000,
    gcTime: options?.gcTime ?? 5 * 60_000,
  });
}
