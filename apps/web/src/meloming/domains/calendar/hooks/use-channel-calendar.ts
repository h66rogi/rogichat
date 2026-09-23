import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  getChannelCalendar,
  searchChannelCalendar,
} from "@/meloming/domains/calendar/apis/calendar";
import type {
  CalendarSearchResponse,
  ChannelCalendarResponse,
  GetChannelCalendarParams,
} from "@/meloming/domains/calendar/types/channel-calendar";

/**
 * Date 객체를 YYYY-MM-DD 로 변환 (KST 기준).
 *
 * `Date.toISOString().slice(0, 10)` 은 UTC 기반이라 KST 자정 직후의
 * 일자를 하루 전으로 표시하는 버그가 있다. 백엔드 캘린더는 KST 의미로
 * half-open `[from, to)` 를 받기 때문에 KST 의 연/월/일 을 그대로 보낸다.
 */
function toKSTDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Query key 안정성을 위한 정규화 함수. 같은 일자의 다른 시간 객체에도 같은 key 를 보장. */
export function buildChannelCalendarKey(
  identifier: string,
  from: Date,
  to: Date
) {
  return [
    "channel",
    "calendar",
    identifier,
    toKSTDateString(from),
    toKSTDateString(to),
  ] as const;
}

export const channelCalendarKeys = {
  all: ["channel", "calendar"] as const,
  byRange: (identifier: string, from: Date, to: Date) =>
    buildChannelCalendarKey(identifier, from, to),
};

/**
 * 채널 통합 캘린더 데이터를 가져오는 훅.
 *
 * - identifier: 숫자 ID 또는 webPath
 * - from / to: half-open `[from, to)` 범위. KST 의 연/월/일 기준으로 직렬화
 * - options: 부분 포함 플래그 + enabled / staleTime / gcTime
 */
export function useChannelCalendar(
  identifier: string,
  from: Date,
  to: Date,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    gcTime?: number;
    includeBroadcasts?: boolean;
    includeSetlists?: boolean;
    includeAnniversaries?: boolean;
    includeSchedules?: boolean;
    includeClips?: boolean;
  }
): UseQueryResult<ChannelCalendarResponse, Error> {
  const fromStr = toKSTDateString(from);
  const toStr = toKSTDateString(to);

  const params: GetChannelCalendarParams = {
    identifier,
    from: fromStr,
    to: toStr,
    includeBroadcasts: options?.includeBroadcasts,
    includeSetlists: options?.includeSetlists,
    includeAnniversaries: options?.includeAnniversaries,
    includeSchedules: options?.includeSchedules,
    includeClips: options?.includeClips,
  };

  return useQuery({
    queryKey: [
      "channel",
      "calendar",
      identifier,
      fromStr,
      toStr,
      options?.includeBroadcasts ?? null,
      options?.includeSetlists ?? null,
      options?.includeAnniversaries ?? null,
      options?.includeSchedules ?? null,
      options?.includeClips ?? null,
    ] as const,
    queryFn: () => getChannelCalendar(params),
    enabled: !!identifier && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 1 * 60 * 1000, // 1분
    gcTime: options?.gcTime ?? 5 * 60 * 1000, // 5분
  });
}

/**
 * 채널 통합 캘린더 검색 훅.
 *
 * 키워드 `keyword` 로 5종 데이터를 검색한다. 검색 범위는 "오늘"을 기준으로
 * 과거 ~300일 ~ 미래 +90일 (≈ 390일, 백엔드 13개월=403일 cap 이내) 로 고정 —
 * 과거 방송/노래방송/클립 기록과 가까운 미래 예정 일정을 모두 포괄한다.
 *
 * - keyword 는 trim 후 1자 이상일 때만 fetch (`enabled`).
 * - 범위는 mount 시 1회 계산하여 query key 를 안정화 (날짜 경계 흔들림 방지).
 * - 호출부(CalendarSearch)에서 debounce 한 값을 넘긴다.
 */
export function useChannelCalendarSearch(
  identifier: string,
  keyword: string,
  options?: { enabled?: boolean }
): UseQueryResult<CalendarSearchResponse, Error> {
  const term = keyword.trim();

  const range = useMemo(() => {
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - 300);
    const to = new Date(now);
    to.setDate(to.getDate() + 90);
    return { from: toKSTDateString(from), to: toKSTDateString(to) };
  }, []);

  return useQuery({
    queryKey: [
      "channel",
      "calendar",
      "search",
      identifier,
      term,
      range.from,
      range.to,
    ] as const,
    queryFn: () =>
      searchChannelCalendar({
        identifier,
        q: term,
        from: range.from,
        to: range.to,
      }),
    enabled: !!identifier && term.length >= 1 && (options?.enabled ?? true),
    staleTime: 30 * 1000, // 30초
    gcTime: 2 * 60 * 1000, // 2분
  });
}
