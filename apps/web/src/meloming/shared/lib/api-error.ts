import type { AxiosError } from "./axios-error";
import { isAxiosError } from "./axios-error";

/**
 * 서버 컴포넌트의 fetch가 non-2xx 응답을 받았을 때 throw 하는 에러.
 * status code 를 보존해서 호출 측이 진짜 404 와 5xx 를 구분할 수 있도록 한다.
 */
export class ApiResponseError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly payload: unknown;
  readonly url?: string;

  constructor(args: {
    status: number;
    statusText: string;
    message: string;
    payload?: unknown;
    url?: string;
  }) {
    super(args.message);
    this.name = "ApiResponseError";
    this.status = args.status;
    this.statusText = args.statusText;
    this.payload = args.payload;
    this.url = args.url;
  }
}

export function isApiResponseError(error: unknown): error is ApiResponseError {
  return error instanceof ApiResponseError;
}

const GENERIC_ERROR_MESSAGES = new Set([
  "Network Error",
  "Request failed",
  "Bad Request",
  "Bad Request Exception",
  "Unauthorized",
  "Unauthorized Exception",
  "Forbidden",
  "Forbidden Exception",
  "Not Found",
  "Not Found Exception",
  "Conflict",
  "Conflict Exception",
  "Internal Server Error",
  "Internal Server Error Exception",
]);

const CODE_MESSAGE_MAP: Record<string, string> = {
  PROMO_SOLD_OUT: "프로모션이 모두 판매되었습니다. 페이지를 새로고침해 주세요.",
  PROMO_NOT_ACTIVE:
    "프로모션이 종료되었거나 아직 시작되지 않았습니다. 페이지를 새로고침해 주세요.",
  PROMO_CAP_EXCEEDED: "구독 보유 가능 최대 기간(23개월)을 초과할 수 없습니다.",
  PROMO_METHOD_NOT_ALLOWED:
    "해당 결제수단은 프로모션에서 지원하지 않습니다. 결제수단을 변경해 주세요.",
  PROMO_COUPON_NOT_ALLOWED: "프로모션 상품에는 쿠폰을 적용할 수 없습니다.",
  PROMO_RECIPIENT_INVALID:
    "선물 수신자를 확인할 수 없습니다. 채널 인증 여부를 확인해 주세요.",
  PROMO_DISABLED:
    "프로모션이 현재 일시 중단 상태입니다. 잠시 후 다시 시도해 주세요.",
  FEATURE_DISABLED: "현재 사용할 수 없는 기능입니다.",
  PRO_REQUIRED: "프로 구독이 필요한 기능입니다.",
  TOO_MANY_TOKENS: "이모티콘 사용 개수를 줄여서 다시 시도해 주세요.",
  CONTENT_TOO_LONG: "내용이 너무 깁니다.",
  CONTENT_TOO_SHORT: "내용을 입력해 주세요.",
  INVALID_TOKENS:
    "사용할 수 없는 이모티콘이 포함되어 있습니다. 입력 내용을 확인해 주세요.",
  WITHDRAWAL_BLOCKED: "탈퇴할 수 없습니다.",
  WITHDRAWAL_VALIDATION_UNAVAILABLE:
    "일시적인 오류로 탈퇴 처리를 진행할 수 없습니다. 잠시 후 다시 시도해주세요.",
  VALIDATION_FAILED: "입력값을 다시 확인해 주세요.",
  MAX_EMOTICONS_REACHED:
    "이모티콘은 최대 10개까지 등록할 수 있어요. 기존 이모티콘을 삭제 후 다시 시도해 주세요.",
  SHORTCODE_DUPLICATED:
    "이미 사용 중인 이모티콘 코드에요. 다른 코드를 입력해 주세요.",
  UNSUPPORTED_FORMAT: "PNG, WebP, GIF 형식만 지원해요.",
  INVALID_IMAGE: "PNG, WebP, GIF 형식만 지원해요.",
  INVALID_SHORTCODE_FORMAT:
    "이모티콘 코드는 영문 소문자, 숫자, _만 사용할 수 있어요 (2~20자).",
  INVALID_DIMENSIONS: "이미지 크기는 정사각형 64~256px이어야 해요.",
  FILE_TOO_LARGE:
    "파일 크기가 너무 커요. 정적 이미지 256KB, 애니메이션 1MB까지 가능해요.",
  TOO_MANY_FRAMES: "GIF 프레임이 너무 많아요 (최대 60프레임).",
  EMOTICON_NOT_FOUND: "이모티콘을 찾을 수 없습니다.",
  REJECTION_REASON_REQUIRED: "거절 사유를 입력해 주세요.",
  ALREADY_DELETED_BY_OWNER: "이미 삭제된 이모티콘입니다.",
  ALREADY_REVIEWED: "이미 심사 처리된 이모티콘입니다.",
  PHONE_SEND_COOLDOWN: "잠시 후 다시 시도해주세요.",
  PHONE_OTP_INVALID: "인증번호가 올바르지 않거나 만료됐어요.",
  PHONE_NUMBER_UNUSABLE:
    "사용할 수 없는 전화번호예요. 다른 번호를 입력해주세요.",
  PHONE_ACCOUNT_LIMIT: "이 번호는 이미 2개 계정에서 사용 중이에요.",
  CONTENT_ANNOUNCEMENT_URL_DUPLICATE:
    "이미 등록된 콘텐츠 링크예요. 기존 콘텐츠를 확인하거나 다른 신청 주소를 입력해주세요.",
};

function toMessages(value: unknown): string[] {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? [normalized] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => toMessages(item));
  }

  if (value && typeof value === "object" && "message" in value) {
    return toMessages((value as { message?: unknown }).message);
  }

  return [];
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isGenericMessage(message: string): boolean {
  if (GENERIC_ERROR_MESSAGES.has(message)) return true;
  return /^Request failed with status code \d{3}$/i.test(message);
}

function getMessageFromCode(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return CODE_MESSAGE_MAP[code];
}

function getCodeFromPayload(
  payload: Record<string, unknown>,
): string | undefined {
  if (typeof payload.code === "string" && payload.code.length > 0) {
    return payload.code;
  }

  const codeFromMessage = dedupe([
    ...toMessages(payload.message),
    ...toMessages(payload.messages),
    ...toMessages(payload.error),
  ]).find((message) => getMessageFromCode(message) !== undefined);

  if (codeFromMessage) {
    return codeFromMessage;
  }

  return undefined;
}

export function extractApiErrorMessageFromPayload(
  payload: unknown,
): string | undefined {
  if (typeof payload === "string") {
    const normalized = payload.trim();
    return normalized || undefined;
  }

  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const code = getCodeFromPayload(record);
  const codeMessage = getMessageFromCode(code);
  const messages = dedupe([
    ...toMessages(record.message),
    ...toMessages(record.messages),
    ...toMessages(record.error),
  ]);

  if (messages.length === 0) {
    return codeMessage;
  }

  const primary = messages[0];
  if (codeMessage && (isGenericMessage(primary) || primary === code)) {
    return codeMessage;
  }

  return primary;
}

export function extractApiErrorMessage(
  error: unknown,
  fallback = "요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
): string {
  if (isAxiosError(error)) {
    const payloadMessage = extractApiErrorMessageFromPayload(
      error.response?.data,
    );
    if (payloadMessage) return payloadMessage;

    if (
      typeof error.message === "string" &&
      error.message.trim() &&
      !isGenericMessage(error.message)
    ) {
      return error.message;
    }
    return fallback;
  }

  if (error instanceof Error) {
    if (error.message.trim() && !isGenericMessage(error.message)) {
      return error.message;
    }
    return fallback;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
}

export function isRestrictedNicknameErrorMessage(message: string): boolean {
  return message.includes("서비스명 또는 플랫폼명과 혼동");
}

export function normalizeAxiosErrorMessage(error: unknown): void {
  if (!isAxiosError(error)) return;
  const normalized = extractApiErrorMessage(error, error.message);
  (error as AxiosError).message = normalized;
}

export async function throwApiResponseError(
  response: Response,
  fallbackMessage = "요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
): Promise<never> {
  let payload: unknown;
  try {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      payload = await response.json();
    } else {
      payload = await response.text();
    }
  } catch {
    payload = undefined;
  }

  const backendMessage = extractApiErrorMessageFromPayload(payload);
  const statusFallback = response.statusText
    ? `${fallbackMessage}: ${response.statusText}`
    : `${fallbackMessage} (HTTP ${response.status})`;

  throw new ApiResponseError({
    status: response.status,
    statusText: response.statusText,
    message: backendMessage ?? statusFallback,
    payload,
    url: response.url,
  });
}
