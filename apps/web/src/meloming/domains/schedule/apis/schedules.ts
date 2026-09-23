import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  Schedule,
  CreateScheduleRequest,
  UpdateScheduleRequest,
  GetSchedulesQuery,
  GetSchedulesResponse,
} from "@/meloming/domains/schedule/types/schedule";

/**
 * POST /schedules/channel/{channelId}
 * 채널 일정 생성 (소유자/매니저)
 */
export async function createChannelSchedule(
  channelId: number,
  body: CreateScheduleRequest
): Promise<Schedule> {
  const response = await apiClient.post<Schedule>(
    `/schedules/channel/${channelId}`,
    body,
    {
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * GET /schedules/channel/{channelId}
 * 채널 일정 목록 (공개, 권한자면 비공개 포함)
 */
export async function getChannelSchedules(
  channelId: number,
  query?: GetSchedulesQuery
): Promise<GetSchedulesResponse> {
  const params: Record<string, string | number | undefined> = {
    ym: query?.ym,
    page: query?.page,
    limit: query?.limit,
    from: query?.from,
    to: query?.to,
  };

  // channelIds를 여러 개의 쿼리 파라미터로 전달
  const config = {
    params,
    ...(query?.channelIds && query.channelIds.length > 0
      ? {
          paramsSerializer: (params: Record<string, unknown>) => {
            const parts: string[] = [];
            Object.entries(params).forEach(([key, value]) => {
              if (value !== undefined && value !== null) {
                parts.push(`${key}=${value}`);
              }
            });
            if (query.channelIds) {
              query.channelIds.forEach((id) => {
                parts.push(`channelIds=${id}`);
              });
            }
            return parts.join("&");
          },
        }
      : {}),
    withCredentials: true,
  };

  const response = await apiClient.get<GetSchedulesResponse>(
    `/schedules/channel/${channelId}`,
    config
  );
  return response.data;
}

/**
 * GET /schedules/favorites
 * 즐겨찾기 채널 일정 목록 (기본 공개만, 내 채널만 보기 옵션 시 비공개 포함)
 */
export async function getFavoriteSchedules(
  query?: GetSchedulesQuery
): Promise<GetSchedulesResponse> {
  const params: Record<string, string | number | undefined> = {
    ym: query?.ym,
    page: query?.page,
    limit: query?.limit,
    from: query?.from,
    to: query?.to,
  };

  const config = {
    params,
    ...(query?.channelIds && query.channelIds.length > 0
      ? {
          paramsSerializer: (params: Record<string, unknown>) => {
            const parts: string[] = [];
            Object.entries(params).forEach(([key, value]) => {
              if (value !== undefined && value !== null) {
                parts.push(`${key}=${value}`);
              }
            });
            if (query.channelIds) {
              query.channelIds.forEach((id) => {
                parts.push(`channelIds=${id}`);
              });
            }
            return parts.join("&");
          },
        }
      : {}),
    withCredentials: true,
  };

  const response = await apiClient.get<GetSchedulesResponse>(
    `/schedules/favorites`,
    config
  );
  return response.data;
}

/**
 * GET /schedules/mine
 * 내 채널 + 내가 매니저인 채널의 일정 목록 (비공개 포함)
 */
export async function getMySchedules(
  query?: GetSchedulesQuery
): Promise<GetSchedulesResponse> {
  const params: Record<string, string | number | undefined> = {
    ym: query?.ym,
    page: query?.page,
    limit: query?.limit,
    from: query?.from,
    to: query?.to,
  };

  const config = {
    params,
    ...(query?.channelIds && query.channelIds.length > 0
      ? {
          paramsSerializer: (params: Record<string, unknown>) => {
            const parts: string[] = [];
            Object.entries(params).forEach(([key, value]) => {
              if (value !== undefined && value !== null) {
                parts.push(`${key}=${value}`);
              }
            });
            if (query.channelIds) {
              query.channelIds.forEach((id) => {
                parts.push(`channelIds=${id}`);
              });
            }
            return parts.join("&");
          },
        }
      : {}),
    withCredentials: true,
  };

  const response = await apiClient.get<GetSchedulesResponse>(
    `/schedules/mine`,
    config
  );
  return response.data;
}

/**
 * GET /schedules/{id}
 * 일정 단건 조회 (공개/권한자)
 */
export async function getSchedule(id: number): Promise<Schedule> {
  const response = await apiClient.get<Schedule>(`/schedules/${id}`, {
    withCredentials: true,
  });
  return response.data;
}

/**
 * PATCH /schedules/{id}
 * 일정 수정 (소유자/매니저)
 */
export async function updateSchedule(
  id: number,
  body: UpdateScheduleRequest
): Promise<Schedule> {
  const response = await apiClient.patch<Schedule>(`/schedules/${id}`, body, {
    withCredentials: true,
  });
  return response.data;
}

/**
 * DELETE /schedules/{id}
 * 일정 삭제 (소유자/매니저, soft delete)
 */
export async function deleteSchedule(id: number): Promise<void> {
  await apiClient.delete(`/schedules/${id}`, {
    withCredentials: true,
  });
}

/**
 * GET /schedules/upcoming-highlights
 * 홈 화면용 다가오는 주요 일정 (랜덤 7일 이내, LIVE/COLLAB)
 */
export async function getUpcomingHighlights(): Promise<Schedule[]> {
  const response = await apiClient.get<Schedule[]>(
    `/schedules/upcoming-highlights`,
    {
      withCredentials: true,
    }
  );
  return response.data;
}
