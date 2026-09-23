import type { SnsPlatform } from "@/meloming/domains/sns-credentials/types/sns-platform";

/**
 * SNS 게시 상태.
 *
 * 백엔드 정합: meloming-back `ScheduleSnsPublication.status` (Prisma enum).
 * - QUEUED: 큐 적재 직후
 * - POSTING: Processor 가 외부 API 호출 시작
 * - POSTED: 외부 API 가 게시글 ID 를 반환한 시점
 * - FAILED: sanitized 에러 메시지를 errorMessage 에 담아 종료
 */
export type ScheduleSnsPublicationStatus =
  | "QUEUED"
  | "POSTING"
  | "POSTED"
  | "FAILED";

/**
 * 네이버 카페 전용 게시 대상 메타.
 *
 * 백엔드 정합: meloming-back `ScheduleSnsPublicationTargetMetaDto`.
 * - cafeId / menuId / subject 는 NAVER_CAFE 에서 필수 (백엔드 service 검증)
 * - openYn 은 미지정 시 provider 기본값(true)
 *
 * X 플랫폼 사용 시 전체 필드 미사용. (서비스 검증)
 */
export interface ScheduleSnsPublicationTargetMeta {
  cafeId?: string;
  menuId?: string;
  subject?: string;
  openYn?: boolean;
}

/**
 * `POST /v1/schedule-renders/:renderId/publish` 요청 바디.
 *
 * 백엔드 정합: meloming-back `CreateScheduleSnsPublicationRequestDto`.
 */
export interface CreateScheduleSnsPublicationRequest {
  platform: SnsPlatform;
  publishBody: string;
  targetMeta?: ScheduleSnsPublicationTargetMeta;
}

/**
 * `GET /v1/schedule-sns-publications/:id` 와
 * `POST /v1/schedule-renders/:renderId/publish`,
 * `GET /v1/schedule-renders/:renderId/publications` 응답 항목.
 *
 * 보안: accessToken 등 자격증명은 절대 포함되지 않음.
 *
 * 백엔드 정합: meloming-back `ScheduleSnsPublicationResponseDto`.
 *
 * NOTE — 백엔드 DTO 의 `publishedAt` 필드를 그대로 노출. 프론트 사용자
 * 지시문에는 `postedAt` 으로 적혀 있으나, source-of-truth 는 backend
 * 코드(ScheduleSnsPublicationResponseDto)이며 그 필드명이 `publishedAt` 임.
 */
export interface ScheduleSnsPublication {
  id: number;
  renderId: number;
  channelId: number;
  userId: number;
  platform: SnsPlatform;
  status: ScheduleSnsPublicationStatus;
  externalPostId: string | null;
  externalPostUrl: string | null;
  publishBody: string | null;
  targetMeta: Record<string, unknown> | null;
  errorMessage: string | null;
  jobId: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 폴링 종료 조건 — `POSTED` 또는 `FAILED` 도달.
 */
export function isTerminalPublicationStatus(
  status: ScheduleSnsPublicationStatus,
): boolean {
  return status === "POSTED" || status === "FAILED";
}
