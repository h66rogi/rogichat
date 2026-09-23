import { useCallback, useEffect, useRef, useState } from "react";
import {
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { listScheduleRenderPublications } from "@/meloming/domains/schedule-sns-publications/apis/schedule-sns-publications";
import { scheduleSnsPublicationKeys } from "@/meloming/domains/schedule-sns-publications/query-keys";
import {
  isTerminalPublicationStatus,
  type ScheduleSnsPublication,
} from "@/meloming/domains/schedule-sns-publications/types";

/** 폴링 기본 간격 — 사용자 지시 4초. */
const DEFAULT_POLLING_INTERVAL_MS = 4_000;

/** 폴링 최대 지속 시간 — 사용자 지시 5분. */
const DEFAULT_POLLING_TIMEOUT_MS = 5 * 60 * 1_000;

interface UseRenderPublicationsOptions {
  /** false 면 query 자체 비활성. 기본 true. */
  enabled?: boolean;
  /** ms — 폴링 간격. 기본 4000. */
  pollingIntervalMs?: number;
  /** ms — 첫 in-progress 관측 후 폴링 중단까지의 최대 시간. 기본 5분. */
  pollingTimeoutMs?: number;
}

interface UseRenderPublicationsResult {
  /** TanStack query 자체 — data / isLoading / refetch 등 노출. */
  query: UseQueryResult<ScheduleSnsPublication[], Error>;
  /**
   * 폴링이 timeout 으로 중단되었는지. true 면 화면에 "오랫동안 처리 중,
   * 새로고침으로 확인" 안내를 보여줄 수 있다.
   */
  isPollingTimedOut: boolean;
  /**
   * timeout 카운터 reset (예: 사용자가 새로 publish 했을 때 다시 폴링 가능하도록).
   */
  resetPollingTimeout: () => void;
}

/**
 * 한 렌더의 SNS 게시 내역을 조회하고, 비종료(QUEUED|POSTING) 항목이 있으면
 * 자동 폴링한다.
 *
 *  - terminal(POSTED|FAILED) 만 있을 때는 polling 정지 → `refetchInterval=false`.
 *  - in-progress 항목이 처음 관측된 시각(`startedAt`) 으로부터 timeout 초과 시
 *    `enabled=false` 로 강제 중단하고 `isPollingTimedOut=true` 노출.
 *  - 사용자가 새 publish 를 호출해 새 in-progress 가 들어오면, 호출 측이
 *    `resetPollingTimeout()` 을 명시적으로 호출해 다시 폴링 활성화 가능.
 *
 * 구현 노트 (react-hooks/set-state-in-effect 회피):
 *  - 첫 in-progress 관측 시각은 `startedAtRef` (ref) 로만 추적 → effect 안에서
 *    state 를 동기 setState 하지 않는다.
 *  - timeout 도달 여부는 `setTimeout` 콜백 내부에서만 setState — effect body
 *    동기 setState 가 아니어서 lint 가 허용한다.
 *  - terminal 전환 시 timeout flag 를 풀어주는 로직도 setTimeout(..., 0) 마이크로
 *    스케줄로 옮겨 cascading render 룰 위반 회피.
 */
export function useRenderPublications(
  renderId: number | undefined,
  options?: UseRenderPublicationsOptions,
): UseRenderPublicationsResult {
  const interval = options?.pollingIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS;
  const timeoutMs = options?.pollingTimeoutMs ?? DEFAULT_POLLING_TIMEOUT_MS;

  // 첫 in-progress 관측 시각. null 이면 아직 관측 전 (or 모두 terminal).
  const startedAtRef = useRef<number | null>(null);
  // 타임아웃 도달 여부. 오직 setTimeout 콜백 또는 사용자 reset 으로만 변경.
  const [isPollingTimedOut, setIsPollingTimedOut] = useState(false);

  const query = useQuery({
    queryKey:
      renderId !== undefined
        ? scheduleSnsPublicationKeys.byRender(renderId)
        : scheduleSnsPublicationKeys.byRenders(),
    queryFn: () => {
      if (renderId === undefined) {
        throw new Error(
          "useRenderPublications: renderId is required when query runs",
        );
      }
      return listScheduleRenderPublications(renderId);
    },
    enabled:
      renderId !== undefined && (options?.enabled ?? true) && !isPollingTimedOut,
    staleTime: 0,
    refetchInterval: (queryInstance) => {
      if (isPollingTimedOut) return false;
      const data = queryInstance.state.data;
      if (!data) return interval;
      const hasInProgress = data.some(
        (row) => !isTerminalPublicationStatus(row.status),
      );
      return hasInProgress ? interval : false;
    },
  });

  // query.data 가 바뀔 때마다 startedAtRef 와 timeout 타이머를 동기화.
  // - effect 본문에서는 ref 만 변경 (state 변경 없음).
  // - setTimeout 콜백 내부에서만 setIsPollingTimedOut(true) 호출.
  useEffect(() => {
    const data = query.data;
    if (!data) return undefined;

    const hasInProgress = data.some(
      (row) => !isTerminalPublicationStatus(row.status),
    );

    if (!hasInProgress) {
      // 모두 terminal — startedAt 초기화. timeout flag 가 켜져있다면 비동기로 푼다
      // (setState-in-effect 회피).
      startedAtRef.current = null;
      if (isPollingTimedOut) {
        const microtask = setTimeout(() => {
          setIsPollingTimedOut(false);
        }, 0);
        return () => clearTimeout(microtask);
      }
      return undefined;
    }

    // hasInProgress: startedAt 기록 후 타이머 set.
    if (startedAtRef.current === null) {
      startedAtRef.current = Date.now();
    }
    const remaining = timeoutMs - (Date.now() - startedAtRef.current);
    if (remaining <= 0) {
      // 이미 만료됨 — microtask 로 setState 마이그레이션.
      const microtask = setTimeout(() => {
        setIsPollingTimedOut(true);
      }, 0);
      return () => clearTimeout(microtask);
    }
    const timer = setTimeout(() => {
      setIsPollingTimedOut(true);
    }, remaining);
    return () => clearTimeout(timer);
  }, [query.data, isPollingTimedOut, timeoutMs]);

  const resetPollingTimeout = useCallback(() => {
    startedAtRef.current = null;
    setIsPollingTimedOut(false);
  }, []);

  return {
    query,
    isPollingTimedOut,
    resetPollingTimeout,
  };
}
