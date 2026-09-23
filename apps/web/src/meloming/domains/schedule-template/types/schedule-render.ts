/**
 * 주간 시간표 이미지 렌더 상태.
 * 백엔드 Prisma enum 정합 (`QUEUED|RENDERING|DONE|FAILED`).
 */
export type ScheduleImageRenderStatus =
  | "QUEUED"
  | "RENDERING"
  | "DONE"
  | "FAILED";

/**
 * GET /v1/schedule-renders/:id, POST /v1/schedule-renders 응답.
 *
 * 백엔드 정합: meloming-back
 * `src/schedule-renders/dto/response/schedule-render.response.dto.ts`
 */
export interface ScheduleImageRender {
  id: number;
  channelId: number;
  /** 템플릿 삭제 시 null */
  templateId: number | null;
  /** ISO8601. 렌더 대상 주간 시작 시각 */
  weekStartAt: string;
  status: ScheduleImageRenderStatus;
  /** 완료 시 이미지 URL */
  imageUrl: string | null;
  /** 완료 시 이미지 가로 픽셀 */
  width: number | null;
  /** 완료 시 이미지 세로 픽셀 */
  height: number | null;
  /** 실패 시 에러 메시지 */
  errorMessage: string | null;
  /** BullMQ job id */
  jobId: string | null;
  /** 요청자 User ID */
  requestedBy: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * POST /v1/schedule-renders 요청 body.
 *
 * 백엔드 정합: `src/schedule-renders/dto/request/create-schedule-render.request.dto.ts`
 *
 * `weekStartAt` 은 ISO8601 문자열. 서버에서 Date 로 변환되어 저장된다.
 */
export interface CreateScheduleRenderRequest {
  channelId: number;
  templateId: number;
  weekStartAt: string;
}
