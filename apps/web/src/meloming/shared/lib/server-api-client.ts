import { cookies } from "next/headers";
import { throwApiResponseError } from "./api-error";

const API_BASE_URL = normalizeApiBaseUrl(
  process.env.API_INTERNAL_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL
);

function normalizeApiBaseUrl(value: string | undefined): string {
  return value?.replace(/\/$/, "") ?? "";
}

/**
 * 서버 컴포넌트에서 사용하는 API 클라이언트 유틸리티
 *
 * 주의:
 * - Next.js 16에서는 서버 컴포넌트/일반 서버 유틸에서는 쿠키를 "읽기"만 허용합니다.
 * - 토큰 refresh 및 쿠키 갱신은 클라이언트(Axios 인터셉터, useAuth) 또는
 *   Route Handler / Server Action에서만 처리해야 합니다.
 * - 따라서 이 모듈은 "현재 요청에 실려 온 쿠키" 기준으로만 인증을 판단하고,
 *   401/403이 반환되면 단순히 "비로그인(null)"로 처리합니다.
 */

/**
 * 쿠키 스토어에서 쿠키 헤더 문자열을 생성합니다.
 * @returns 쿠키 헤더 문자열 (예: "name1=value1; name2=value2")
 */
export async function getCookieHeader(): Promise<string> {
  const cookieStore = await cookies();
  return cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

/**
 * API URL을 빌드합니다.
 * @param path API 경로 (예: "/v1/app/attendance/list")
 * @param queryParams 쿼리 파라미터 객체 (선택)
 * @returns 완전한 API URL
 */
export function buildApiUrl(
  path: string,
  queryParams?: Record<string, string>
): string {
  const url = `${API_BASE_URL}${path}`;
  if (!queryParams || Object.keys(queryParams).length === 0) {
    return url;
  }

  const params = new URLSearchParams(queryParams);
  return `${url}?${params.toString()}`;
}

/**
 * 서버 컴포넌트에서 사용하는 기본 fetch 옵션
 */
interface ServerFetchOptions extends RequestInit {
  /**
   * 인증이 필요한 요청인지 여부 (기본값: false)
   * true인 경우 쿠키를 자동으로 헤더에 추가합니다.
   */
  requiresAuth?: boolean;
  /**
   * 캐시 전략 (기본값: "no-store")
   */
  cache?: RequestCache;
  /**
   * 쿼리 파라미터 객체
   */
  queryParams?: Record<string, string>;
  /**
   * Next.js Data Cache 관련 옵션
   * - revalidate: 데이터 재검증 주기(초)
   * - tags: 온디맨드 무효화를 위한 태그 목록
   */
  next?: {
    revalidate?: number;
    tags?: string[];
  };
  /**
   * fetch 타임아웃 (ms). 기본값 15000.
   * 0 또는 음수면 타임아웃 적용 안 함.
   */
  timeoutMs?: number;
}

/** 서버 컴포넌트 fetch 의 기본 타임아웃 (ms). */
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

/**
 * 서버 컴포넌트에서 API를 호출하는 공통 fetch 함수
 * @param path API 경로 (예: "/v1/app/attendance/list")
 * @param options fetch 옵션
 * @param retried 재시도 여부 (내부 사용)
 * @returns Response 객체
 */
export async function fetchServer(
  path: string,
  options: ServerFetchOptions = {},
  // retried 파라미터는 더 이상 사용하지 않지만, 기존 시그니처 호환을 위해 유지
  // (내부에서는 refresh 재시도를 하지 않습니다)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  retried = false
): Promise<Response> {
  const {
    requiresAuth = false,
    cache = "no-store",
    headers = {},
    queryParams,
    next,
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    signal: callerSignal,
    ...restOptions
  } = options;

  const url = buildApiUrl(path, queryParams);

  // 인증이 필요한 경우 쿠키 헤더 추가 및 캐시 무조건 no-store로 강제
  const cookieHeader = requiresAuth ? await getCookieHeader() : null;
  const requestHeaders: HeadersInit = {
    "Content-Type": "application/json",
    ...(cookieHeader && { Cookie: cookieHeader }),
    ...headers,
  };

  // 인증이 필요한 경우 무조건 no-store로 처리
  const finalCache = requiresAuth ? "no-store" : cache;

  // 타임아웃 + 호출자 signal 결합. AbortSignal.any 미지원 환경 대비 fallback.
  const signal = combineAbortSignals(callerSignal, timeoutMs);

  const response = await fetch(url, {
    ...restOptions,
    method: restOptions.method ?? "GET",
    headers: requestHeaders,
    cache: finalCache,
    ...(next ? { next } : {}),
    ...(signal ? { signal } : {}),
  });

  return response;
}

function combineAbortSignals(
  callerSignal: AbortSignal | null | undefined,
  timeoutMs: number
): AbortSignal | undefined {
  const timeoutSignal =
    timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
  if (!callerSignal && !timeoutSignal) return undefined;
  if (!callerSignal) return timeoutSignal;
  if (!timeoutSignal) return callerSignal;

  const anyFn = (
    AbortSignal as typeof AbortSignal & {
      any?: (signals: AbortSignal[]) => AbortSignal;
    }
  ).any;
  if (typeof anyFn === "function") {
    return anyFn([callerSignal, timeoutSignal]);
  }

  // AbortSignal.any 미지원 환경: 호출자 signal 우선 (timeout 무시).
  return callerSignal;
}

/**
 * 인증이 필요한 API 호출을 위한 헬퍼 함수
 * 401 또는 403 응답의 경우 null을 반환합니다 (에러가 아닌 것으로 처리).
 * 인증이 필요한 경우 캐시는 무조건 "no-store"로 처리됩니다.
 * refresh 로직은 서버에서 수행하지 않습니다.
 * @param path API 경로
 * @param options fetch 옵션 (cache 옵션은 무시되고 "no-store"로 처리됨)
 * @returns Response 객체 또는 null (인증 실패 시)
 */
export async function fetchServerWithAuth(
  path: string,
  options: Omit<ServerFetchOptions, "requiresAuth"> = {}
): Promise<Response | null> {
  const response = await fetchServer(path, {
    ...options,
    requiresAuth: true,
  });

  // 401/403이면 인증 실패로 처리
  if (response.status === 401 || response.status === 403) {
    return null;
  }

  return response;
}

/**
 * JSON 응답을 파싱하고 에러를 처리하는 헬퍼 함수
 * @param response Response 객체
 * @param errorMessage 에러 메시지 (기본값: "Failed to fetch")
 * @returns 파싱된 JSON 데이터
 * @throws 에러가 발생한 경우
 */
export async function parseJsonResponse<T>(
  response: Response,
  errorMessage = "Failed to fetch"
): Promise<T> {
  if (!response.ok) {
    await throwApiResponseError(response, errorMessage);
  }

  return response.json();
}

/**
 * 인증이 필요 없는 API 호출 헬퍼 (JSON 응답)
 * @param path API 경로
 * @param options fetch 옵션
 * @param errorMessage 커스텀 에러 메시지
 * @returns 파싱된 JSON 데이터
 */
export async function fetchServerJson<T>(
  path: string,
  options: ServerFetchOptions = {},
  errorMessage?: string
): Promise<T> {
  const response = await fetchServer(path, options);
  return parseJsonResponse<T>(response, errorMessage);
}

/**
 * 인증이 필요한 API 호출 헬퍼 (JSON 응답)
 * 401 또는 403 응답의 경우 null을 반환합니다.
 * 인증이 필요한 경우 캐시는 무조건 "no-store"로 처리됩니다.
 * refresh 로직은 서버에서 수행하지 않습니다.
 * @param path API 경로
 * @param options fetch 옵션 (cache 옵션은 무시되고 "no-store"로 처리됨)
 * @param errorMessage 커스텀 에러 메시지
 * @returns 파싱된 JSON 데이터 또는 null (인증 실패 시)
 */
export async function fetchServerJsonWithAuth<T>(
  path: string,
  options: Omit<ServerFetchOptions, "requiresAuth"> = {},
  errorMessage?: string
): Promise<T | null> {
  const response = await fetchServerWithAuth(path, options);
  if (!response) {
    return null;
  }

  return parseJsonResponse<T>(response, errorMessage);
}
