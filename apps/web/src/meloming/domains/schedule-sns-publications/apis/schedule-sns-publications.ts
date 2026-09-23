import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  CreateScheduleSnsPublicationRequest,
  ScheduleSnsPublication,
} from "@/meloming/domains/schedule-sns-publications/types";

/**
 * POST /v1/schedule-renders/:renderId/publish
 *
 * 백엔드 정합: meloming-back ScheduleSnsPublicationsController#createPublication.
 * 202 Accepted — QUEUED 상태로 레코드 생성, 반환된 id 로 폴링 시작.
 */
export async function publishScheduleRender(
  renderId: number,
  body: CreateScheduleSnsPublicationRequest,
): Promise<ScheduleSnsPublication> {
  const response = await apiClient.post<ScheduleSnsPublication>(
    `/schedule-renders/${renderId}/publish`,
    body,
    {
      withCredentials: true,
    },
  );
  return response.data;
}

/**
 * GET /v1/schedule-sns-publications/:id
 *
 * 단일 게시 레코드 — 폴링/상세 조회용.
 * 일반 폴링은 list 캐시에 누적되므로 잘 안 쓰지만, 깊은 링크/공유에 대비해 노출.
 */
export async function getScheduleSnsPublication(
  id: number,
): Promise<ScheduleSnsPublication> {
  const response = await apiClient.get<ScheduleSnsPublication>(
    `/schedule-sns-publications/${id}`,
    {
      withCredentials: true,
    },
  );
  return response.data;
}

/**
 * GET /v1/schedule-renders/:renderId/publications
 *
 * 특정 렌더의 SNS 게시 내역 (오너/매니저). 화면에서 status badge 목록으로 사용.
 */
export async function listScheduleRenderPublications(
  renderId: number,
): Promise<ScheduleSnsPublication[]> {
  const response = await apiClient.get<ScheduleSnsPublication[]>(
    `/schedule-renders/${renderId}/publications`,
    {
      withCredentials: true,
    },
  );
  return response.data;
}
