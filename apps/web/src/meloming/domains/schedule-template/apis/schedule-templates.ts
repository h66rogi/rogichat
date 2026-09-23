import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  CreateScheduleTemplateRequest,
  DeleteScheduleTemplateResponse,
  ListScheduleTemplatesQuery,
  ParsePsdResponse,
  ScheduleTemplate,
  UpdateScheduleTemplateRequest,
} from "@/meloming/domains/schedule-template/types";

/**
 * GET /v1/schedule-templates?channelId={channelId}
 * 채널별 템플릿 목록 (채널 소유자/매니저만)
 * Feature flag: `channelScheduleTemplate` (F2 이후 UI gate)
 */
export async function getScheduleTemplates(
  query: ListScheduleTemplatesQuery
): Promise<ScheduleTemplate[]> {
  const response = await apiClient.get<ScheduleTemplate[]>(
    `/schedule-templates`,
    {
      params: { channelId: query.channelId },
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * GET /v1/schedule-templates/:id
 * 템플릿 상세 (편집용)
 */
export async function getScheduleTemplate(
  id: number
): Promise<ScheduleTemplate> {
  const response = await apiClient.get<ScheduleTemplate>(
    `/schedule-templates/${id}`,
    {
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * POST /v1/schedule-templates
 * 템플릿 생성 (채널 소유자/매니저)
 */
export async function createScheduleTemplate(
  body: CreateScheduleTemplateRequest
): Promise<ScheduleTemplate> {
  const response = await apiClient.post<ScheduleTemplate>(
    `/schedule-templates`,
    body,
    {
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * PATCH /v1/schedule-templates/:id
 * 템플릿 수정 (채널 소유자/매니저)
 *
 * - non-null 필드(name, isDefault, baseImage*, templateSpec)는 null 전송 시 400.
 *   → `undefined` 로 남겨두면 됨(JSON.stringify 가 자동 생략).
 * - nullable 필드(originalPsdUrl, thumbnailUrl)는 `null` 을 명시 전송하면 clear 됨.
 *   → JS/TS 에서는 `null` 그대로 body 에 넣으면 된다(별도 수동 직렬화 불필요).
 */
export async function updateScheduleTemplate(
  id: number,
  body: UpdateScheduleTemplateRequest
): Promise<ScheduleTemplate> {
  const response = await apiClient.patch<ScheduleTemplate>(
    `/schedule-templates/${id}`,
    body,
    {
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * DELETE /v1/schedule-templates/:id
 * 템플릿 삭제 (soft delete). 서버는 `{ success: true }` 를 반환한다.
 */
export async function deleteScheduleTemplate(
  id: number
): Promise<DeleteScheduleTemplateResponse> {
  const response = await apiClient.delete<DeleteScheduleTemplateResponse>(
    `/schedule-templates/${id}`,
    {
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * 서버는 PSD 파싱에 최대 30초까지 사용한다 (worker timeout).
 * 기본 axios timeout(10초)을 그대로 쓰면 클라이언트가 먼저 끊겨
 * "ECONNABORTED" 로 떨어지므로 여유 있게 60초까지 허용한다.
 *
 * 이보다 더 오래 걸리면 서버에서 PSD_PARSE_TIMEOUT(504) 으로 응답하므로
 * 클라이언트 timeout 으로는 절대 잡지 않는다 — error 코드 분기를 하기 위해서.
 */
const PSD_PARSE_REQUEST_TIMEOUT_MS = 60_000;

/**
 * POST /v1/schedule-templates/psd-parse
 * PSD 업로드 + flatten PNG 생성 + 텍스트 슬롯 자동 추출 (F8 Phase 1).
 *
 * 서버 contract:
 *  - field: `file` (multipart, .psd, max 300MB)
 *  - 200: `ParsePsdResponse`
 *  - 400 INVALID_FILE_TYPE / PSD_INVALID / PSD_UNSUPPORTED_DEPTH
 *  - 413 PSD_OVERSIZED
 *  - 500 PSD_WORKER_INIT_ERROR
 *  - 503 PSD_QUEUE_FULL (Retry-After: 5)
 *  - 504 PSD_PARSE_TIMEOUT
 *
 * Content-Type 은 axios 가 FormData boundary 를 자동 채우도록 명시하지 않는다.
 * (`multipart/form-data` 만 적으면 boundary 가 빠져 서버가 파싱 실패함.)
 */
export async function parsePsd(
  file: File,
  options?: { signal?: AbortSignal }
): Promise<ParsePsdResponse> {
  const formData = new FormData();
  formData.append("file", file);

  // apiClient 의 default header `Content-Type: application/json` 이 박혀 있어
  // FormData 를 넘겨도 axios 가 multipart boundary 를 자동 생성하지 못한다.
  // 명시적으로 Content-Type 을 undefined 로 두어 axios 가 FormData 를 감지해
  // `multipart/form-data; boundary=...` 를 직접 붙이도록 강제한다.
  const response = await apiClient.post<ParsePsdResponse>(
    `/schedule-templates/psd-parse`,
    formData,
    {
      withCredentials: true,
      signal: options?.signal,
      timeout: PSD_PARSE_REQUEST_TIMEOUT_MS,
      headers: { "Content-Type": undefined },
    }
  );
  return response.data;
}
