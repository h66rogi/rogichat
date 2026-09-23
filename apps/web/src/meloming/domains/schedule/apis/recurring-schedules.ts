import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  RecurringSchedulesResponse,
  SaveRecurringSchedulesRequest,
} from "@/meloming/domains/schedule/types/recurring-schedule";

/**
 * GET /schedules/recurring/channel/{channelId}
 * 채널 반복 일정 조회
 */
export async function getRecurringSchedules(
  channelId: number
): Promise<RecurringSchedulesResponse> {
  const response = await apiClient.get<RecurringSchedulesResponse>(
    `/schedules/recurring/channel/${channelId}`,
    {
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * PUT /schedules/recurring/channel/{channelId}
 * 채널 반복 일정 저장 (일괄)
 */
export async function saveRecurringSchedules(
  channelId: number,
  body: SaveRecurringSchedulesRequest
): Promise<RecurringSchedulesResponse> {
  const response = await apiClient.put<RecurringSchedulesResponse>(
    `/schedules/recurring/channel/${channelId}`,
    body,
    {
      withCredentials: true,
    }
  );
  return response.data;
}
