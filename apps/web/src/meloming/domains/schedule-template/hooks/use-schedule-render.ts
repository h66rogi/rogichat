import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getScheduleRender } from "@/meloming/domains/schedule-template/apis/schedule-renders";
import { scheduleRenderKeys } from "@/meloming/domains/schedule-template/query-keys";
import type { ScheduleImageRender } from "@/meloming/domains/schedule-template/types";

const DEFAULT_POLLING_INTERVAL_MS = 2_000;

/**
 * 렌더 작업 상태 폴링 훅.
 *
 * 백엔드: `GET /v1/schedule-renders/:id`.
 * 상태가 `QUEUED` | `RENDERING` 인 동안 기본 2초 간격 폴링하고
 * `DONE` 또는 `FAILED` 에 도달하면 자동으로 중단된다. `staleTime: 0`
 * 은 폴링마다 fresh fetch 를 강제해 cache 가 오래된 QUEUED 상태를
 * 계속 노출하지 않도록 한다.
 *
 * Feature flag: `channelScheduleTemplate`.
 */
export function useScheduleRender(
  renderId: number | undefined,
  options?: {
    enabled?: boolean;
    /** 폴링 간격 ms. default 2000 */
    pollingIntervalMs?: number;
  }
): UseQueryResult<ScheduleImageRender, Error> {
  const interval = options?.pollingIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS;

  return useQuery({
    queryKey: scheduleRenderKeys.detail(renderId ?? 0),
    queryFn: () => {
      if (!renderId) throw new Error("useScheduleRender: renderId is required");
      return getScheduleRender(renderId);
    },
    enabled: !!renderId && (options?.enabled ?? true),
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "DONE" || status === "FAILED") {
        return false;
      }
      return interval;
    },
  });
}
