import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  CreateScheduleRenderRequest,
  ScheduleImageRender,
} from "@/meloming/domains/schedule-template/types";

/**
 * POST /v1/schedule-renders
 * 주간 시간표 이미지 렌더 요청 (채널 소유자/매니저). 202 Accepted.
 * ScheduleImageRender 레코드가 QUEUED 로 생성되어 반환된다. 실제 이미지 생성은
 * Processor 가 수행하므로 `GET /v1/schedule-renders/:id` 로 폴링해야 한다.
 */
export async function createScheduleRender(
  body: CreateScheduleRenderRequest
): Promise<ScheduleImageRender> {
  const response = await apiClient.post<ScheduleImageRender>(
    `/schedule-renders`,
    body,
    {
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * GET /v1/schedule-renders/:id
 * 렌더 작업 상태 조회 (폴링용, 채널 소유자/매니저).
 * status 가 QUEUED|RENDERING 인 동안 2초 간격 폴링 → DONE|FAILED 에서 종료.
 */
export async function getScheduleRender(
  id: number
): Promise<ScheduleImageRender> {
  const response = await apiClient.get<ScheduleImageRender>(
    `/schedule-renders/${id}`,
    {
      withCredentials: true,
    }
  );
  return response.data;
}
