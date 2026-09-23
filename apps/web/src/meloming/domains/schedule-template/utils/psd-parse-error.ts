import { isAxiosError } from "@/meloming/shared/lib/axios-error";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";

/**
 * 백엔드 schedule-templates/psd-parse 에서 응답하는 에러 code 분류.
 *
 * 백엔드 정합 (meloming-back `schedule-templates.controller.ts` 참고):
 *  - 400 INVALID_FILE_TYPE / PSD_INVALID / PSD_UNSUPPORTED_DEPTH
 *  - 413 PSD_OVERSIZED
 *  - 500 PSD_WORKER_INIT_ERROR
 *  - 503 PSD_QUEUE_FULL  (Retry-After: 5)
 *  - 504 PSD_PARSE_TIMEOUT
 *
 * 프론트는 status + code 둘 다 보고 분기. 새 code 가 추가되면 fallback 으로
 * 일반 에러 메시지를 띄운다 (silent fail 금지).
 */
export type PsdParseErrorKind =
  | "INVALID_FILE_TYPE"
  | "PSD_INVALID"
  | "PSD_UNSUPPORTED_DEPTH"
  | "PSD_OVERSIZED"
  | "PSD_WORKER_INIT_ERROR"
  | "PSD_QUEUE_FULL"
  | "PSD_PARSE_TIMEOUT"
  | "ABORTED"
  | "UNKNOWN";

export interface PsdParseErrorInfo {
  kind: PsdParseErrorKind;
  /**
   * 사용자에게 노출할 한국어 메시지. PsdUpload 에서 toast 로 그대로 띄운다.
   */
  message: string;
  /**
   * Retry-After 헤더 (초). PSD_QUEUE_FULL 일 때만 의미가 있다.
   * 서버가 반드시 5를 보내지만 다른 값을 보낼 수도 있으므로 파싱해서 둔다.
   * 없으면 5초 default.
   */
  retryAfterSec?: number;
}

const MESSAGES: Record<Exclude<PsdParseErrorKind, "UNKNOWN">, string> = {
  INVALID_FILE_TYPE: ".psd 확장자 파일만 업로드 가능합니다.",
  PSD_INVALID:
    "PSD 파일을 읽을 수 없습니다. 파일이 손상되었거나 PSD가 아닙니다.",
  PSD_UNSUPPORTED_DEPTH:
    "8-bit PSD만 지원합니다. Image > Mode > 8 bits/Channel 에서 변환 후 다시 업로드해 주세요.",
  PSD_OVERSIZED:
    "PSD가 너무 큽니다(최대 1억 픽셀, 한 변 20000px). 더 작게 export 해 주세요.",
  PSD_WORKER_INIT_ERROR:
    "PSD 처리 서비스 일시 장애. 운영팀에 알려주세요.",
  PSD_QUEUE_FULL: "잠시 후 다시 시도해 주세요.",
  PSD_PARSE_TIMEOUT:
    "PSD 파싱 시간 초과(30초). 더 단순하거나 작은 PSD로 다시 시도해 주세요.",
  ABORTED: "PSD 파싱을 취소했습니다.",
};

/**
 * AbortError / CanceledError 를 식별. axios 0.27+ 에서는 `code === 'ERR_CANCELED'`
 * 또는 instanceof CanceledError. 표준 AbortError 도 같은 의미라 둘 다 처리.
 */
function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: unknown; code?: unknown };
  if (e.name === "AbortError" || e.name === "CanceledError") return true;
  if (e.code === "ERR_CANCELED") return true;
  return false;
}

function pickRetryAfter(headers: unknown): number | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const h = headers as Record<string, unknown>;
  // axios normalizes header names to lowercase but accept either form.
  const raw = h["retry-after"] ?? h["Retry-After"];
  if (typeof raw === "string") {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return undefined;
}

/**
 * 에러를 status + payload.code 기준으로 분류해서 사용자 메시지를 만든다.
 *
 * 분기 우선순위:
 *  1) abort (사용자 취소) → toast 띄우지 말고 호출측에서 무시 권장
 *  2) status + code 매핑 (백엔드 정합)
 *  3) 알려지지 않은 에러 → extractApiErrorMessage fallback
 */
export function classifyPsdParseError(error: unknown): PsdParseErrorInfo {
  if (isAbortError(error)) {
    return { kind: "ABORTED", message: MESSAGES.ABORTED };
  }

  if (!isAxiosError(error)) {
    return {
      kind: "UNKNOWN",
      message: extractApiErrorMessage(
        error,
        "PSD 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
      ),
    };
  }

  const response = error.response;
  const status = response?.status;
  const data = response?.data;
  const code =
    data && typeof data === "object" && "code" in data
      ? (data as { code?: unknown }).code
      : undefined;

  // Status + code 둘 다 알려진 조합으로 들어왔을 때 우선 처리.
  if (status === 413 || code === "PSD_OVERSIZED") {
    return { kind: "PSD_OVERSIZED", message: MESSAGES.PSD_OVERSIZED };
  }
  if (status === 504 || code === "PSD_PARSE_TIMEOUT") {
    return { kind: "PSD_PARSE_TIMEOUT", message: MESSAGES.PSD_PARSE_TIMEOUT };
  }
  if (status === 503 || code === "PSD_QUEUE_FULL") {
    const headers = (response as { headers?: unknown } | undefined)?.headers;
    return {
      kind: "PSD_QUEUE_FULL",
      message: MESSAGES.PSD_QUEUE_FULL,
      retryAfterSec: pickRetryAfter(headers) ?? 5,
    };
  }
  if (status === 500 || code === "PSD_WORKER_INIT_ERROR") {
    return {
      kind: "PSD_WORKER_INIT_ERROR",
      message: MESSAGES.PSD_WORKER_INIT_ERROR,
    };
  }
  if (status === 400) {
    if (code === "PSD_UNSUPPORTED_DEPTH") {
      return {
        kind: "PSD_UNSUPPORTED_DEPTH",
        message: MESSAGES.PSD_UNSUPPORTED_DEPTH,
      };
    }
    if (code === "PSD_INVALID") {
      return { kind: "PSD_INVALID", message: MESSAGES.PSD_INVALID };
    }
    if (code === "INVALID_FILE_TYPE") {
      return { kind: "INVALID_FILE_TYPE", message: MESSAGES.INVALID_FILE_TYPE };
    }
  }

  return {
    kind: "UNKNOWN",
    message: extractApiErrorMessage(
      error,
      "PSD 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
    ),
  };
}
