import type { TemplateSpecV1 } from "./template-spec";

/**
 * GET /v1/schedule-templates/:id, POST /v1/schedule-templates 응답.
 *
 * 백엔드 정합: meloming-back
 * `src/schedule-templates/dto/response/schedule-template.response.dto.ts`
 *
 * `templateSpec` 은 백엔드가 Json 그대로 반환하므로 런타임 검증이 없다.
 * 프론트는 편집 UX 를 위해 `TemplateSpecV1` 로 구조화해 사용하되,
 * 네트워크 경계(응답 파싱 지점)에서는 `unknown` 로 받고 사용처에서
 * 타입 가드/캐스팅 한다.
 */
export interface ScheduleTemplate {
  id: number;
  channelId: number;
  name: string;
  isDefault: boolean;
  baseImageUrl: string;
  baseImageW: number;
  baseImageH: number;
  /**
   * 백엔드 `Record<string, unknown>` 와 대응. 편집/렌더 시
   * `TemplateSpecV1` 로 해석되나 스키마 검증은 호출 측 책임.
   */
  templateSpec: unknown;
  originalPsdUrl: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * `ScheduleTemplate.templateSpec` 을 `TemplateSpecV1` 로 좁히는 간단한 타입 가드.
 * 구조가 틀리면 false 를 반환 — 호출 측에서 기본값으로 대체하도록 한다.
 */
export function isTemplateSpecV1(spec: unknown): spec is TemplateSpecV1 {
  if (!spec || typeof spec !== "object") return false;
  const candidate = spec as { version?: unknown; slots?: unknown };
  if (candidate.version !== 1) return false;
  if (!Array.isArray(candidate.slots)) return false;
  return true;
}

/**
 * POST /v1/schedule-templates 요청 body.
 *
 * 백엔드 정합: `src/schedule-templates/dto/request/create-schedule-template.request.dto.ts`
 *
 * - `templateSpec` 은 MVP 에서 빈 `{}` 또는 `{ version: 1, slots: [] }`.
 * - nullable(PSD/thumb)은 미전송(undefined) 만 허용. 생성 시 null 전송은 지원 X.
 */
export interface CreateScheduleTemplateRequest {
  channelId: number;
  name: string;
  isDefault?: boolean;
  baseImageUrl: string;
  baseImageW: number;
  baseImageH: number;
  templateSpec: TemplateSpecV1 | Record<string, unknown>;
  originalPsdUrl?: string;
  thumbnailUrl?: string;
}

/**
 * PATCH /v1/schedule-templates/:id 요청 body.
 *
 * 백엔드 정합: `src/schedule-templates/dto/request/update-schedule-template.request.dto.ts`
 *
 * 필드 처리 규약:
 * - non-null 필드 (name, isDefault, baseImage*, templateSpec):
 *   undefined → 미변경. null 전송 → 400 Bad Request.
 * - nullable 필드 (originalPsdUrl, thumbnailUrl):
 *   undefined → 미변경. null 전송 → DB clear(null 저장). 그래서 타입에 `| null` 포함.
 *
 * 주의: TS 의 `JSON.stringify` 는 `undefined` 키를 생략하고 `null` 키는 그대로
 * 직렬화하므로 별도 수작업 없이 의도대로 전송된다.
 */
export interface UpdateScheduleTemplateRequest {
  name?: string;
  isDefault?: boolean;
  baseImageUrl?: string;
  baseImageW?: number;
  baseImageH?: number;
  templateSpec?: TemplateSpecV1 | Record<string, unknown>;
  originalPsdUrl?: string | null;
  thumbnailUrl?: string | null;
}

/**
 * GET /v1/schedule-templates query.
 *
 * 백엔드 정합: `src/schedule-templates/dto/request/list-schedule-templates.query.dto.ts`
 */
export interface ListScheduleTemplatesQuery {
  channelId: number;
}

/**
 * DELETE /v1/schedule-templates/:id 응답.
 * 백엔드 controller 는 `{ success: true }` 를 반환한다.
 */
export interface DeleteScheduleTemplateResponse {
  success: true;
}

/**
 * POST /v1/schedule-templates/psd-parse 응답 (F8 Phase 1).
 *
 * 백엔드 정합: meloming-back
 * `src/schedule-templates/dto/response/psd-parse.response.dto.ts`
 *
 * - `templateSpec` 은 자동 추출된 TemplateSpecV1. 서버에서 v1 보장하지만
 *   백엔드 DTO 는 `Record<string, unknown>` 으로 선언되어 있어 사용 측에서
 *   `coerceTemplateSpec`/`isTemplateSpecV1` 로 검증 후 사용한다.
 * - `warnings` 는 치명적이지 않은 정보 메시지 (e.g. 폰트 fallback). 빈 배열 가능.
 */
export interface ParsePsdResponse {
  originalPsdUrl: string;
  baseImageUrl: string;
  baseImageW: number;
  baseImageH: number;
  /**
   * 서버는 항상 `{ version: 1, slots: [...] }` 형태를 반환하지만 DTO 가
   * `Record<string, unknown>` 이라 전송 경계에서는 unknown 으로 받는다.
   * 사용처에서 `coerceTemplateSpec` 으로 안전하게 좁힌다.
   */
  templateSpec: unknown;
  warnings: string[];
}
