import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getScheduleSnsPublication } from "@/meloming/domains/schedule-sns-publications/apis/schedule-sns-publications";
import { scheduleSnsPublicationKeys } from "@/meloming/domains/schedule-sns-publications/query-keys";
import {
  isTerminalPublicationStatus,
  type ScheduleSnsPublication,
} from "@/meloming/domains/schedule-sns-publications/types";

const DEFAULT_POLLING_INTERVAL_MS = 4_000;

/**
 * 단일 게시 레코드 폴링 훅 (deep-link/공유용 fallback).
 *
 * 일반 화면에서는 `useRenderPublications` 가 list 단위로 폴링하므로 이 훅을
 * 직접 쓰지 않는 경우가 많지만, 게시 ID 만 알고 렌더 ID 를 모를 때 유용.
 *
 * `staleTime: 0` + 비종료 시 4초 폴링, `POSTED|FAILED` 도달 시 자동 중단.
 */
export function usePublication(
  id: number | undefined,
  options?: {
    enabled?: boolean;
    pollingIntervalMs?: number;
  },
): UseQueryResult<ScheduleSnsPublication, Error> {
  const interval = options?.pollingIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS;

  return useQuery({
    queryKey: scheduleSnsPublicationKeys.detail(id ?? 0),
    queryFn: () => {
      if (id === undefined) {
        throw new Error("usePublication: id is required when query runs");
      }
      return getScheduleSnsPublication(id);
    },
    enabled: id !== undefined && (options?.enabled ?? true),
    staleTime: 0,
    refetchInterval: (queryInstance) => {
      const status = queryInstance.state.data?.status;
      if (!status) return interval;
      return isTerminalPublicationStatus(status) ? false : interval;
    },
  });
}
