import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  CalendarSearchResponse,
  ChannelCalendarResponse,
  GetCalendarSearchParams,
  GetChannelCalendarParams,
} from "@/meloming/domains/calendar/types/channel-calendar";

/**
 * GET /v1/channels/{identifier}/calendar
 * 채널 통합 캘린더 (예정 일정 + 방송 기록 + 노래방송 기록 + 기념일).
 *
 * 백엔드: meloming-back/src/channel/channel-calendar.controller.ts
 * - identifier: 숫자 ID 또는 webPath
 * - from / to: YYYY-MM-DD half-open `[from, to)`
 * - include* flags: 4종 데이터 부분 포함 (default true)
 *
 * 인증은 optional — withCredentials 로 본인/매니저 채널의 PRIVATE 일정도 받을 수 있다.
 */
export async function getChannelCalendar(
  params: GetChannelCalendarParams
): Promise<ChannelCalendarResponse> {
  const {
    identifier,
    from,
    to,
    includeBroadcasts,
    includeSetlists,
    includeAnniversaries,
    includeSchedules,
    includeClips,
  } = params;

  const queryParams: Record<string, string | boolean | undefined> = {
    from,
    to,
    // 백엔드 DTO 가 'true'/'false' 문자열을 boolean 으로 transform 하므로 그대로 전달.
    includeBroadcasts,
    includeSetlists,
    includeAnniversaries,
    includeSchedules,
    includeClips,
  };

  const response = await apiClient.get<ChannelCalendarResponse>(
    `/channels/${identifier}/calendar`,
    {
      params: queryParams,
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * GET /v1/channels/{identifier}/calendar/search
 * 채널 통합 캘린더 검색 (일정 + 방송 기록 + 노래방송 + 클립 + 기념일).
 *
 * 백엔드: meloming-back/src/channel/channel-calendar.controller.ts (searchCalendar)
 * - q: 검색 키워드 (필수)
 * - from / to: YYYY-MM-DD half-open `[from, to)` (13개월 상한)
 * - include* flags / limit: 옵셔널
 *
 * 인증은 optional — withCredentials 로 본인/매니저 채널의 PRIVATE 일정도 검색된다.
 */
export async function searchChannelCalendar(
  params: GetCalendarSearchParams
): Promise<CalendarSearchResponse> {
  const {
    identifier,
    q,
    from,
    to,
    includeBroadcasts,
    includeSetlists,
    includeAnniversaries,
    includeSchedules,
    includeClips,
    limit,
  } = params;

  const queryParams: Record<string, string | number | boolean | undefined> = {
    q,
    from,
    to,
    includeBroadcasts,
    includeSetlists,
    includeAnniversaries,
    includeSchedules,
    includeClips,
    limit,
  };

  const response = await apiClient.get<CalendarSearchResponse>(
    `/channels/${identifier}/calendar/search`,
    {
      params: queryParams,
      withCredentials: true,
    }
  );
  return response.data;
}
