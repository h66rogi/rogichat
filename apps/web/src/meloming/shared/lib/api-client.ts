import axios from "axios";
import type {
  AxiosError,
  AxiosInstance,
  InternalAxiosRequestConfig,
} from "axios";
import { normalizeAxiosErrorMessage } from "./api-error";
import { emitAuthRefreshed } from "./auth-events";

const API_BASE_URL = `${process.env.NEXT_PUBLIC_API_BASE_URL}`;

export const apiClient = axios.create({
  baseURL: `${API_BASE_URL}/v1`,
  withCredentials: true,
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
});

export const apiV2Client = axios.create({
  baseURL: `${API_BASE_URL}/v2`,
  withCredentials: true,
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
});

// ---------------------------------------------------------------------------
// Global 401 -> refresh handling (single-flight, retry-once, cookie-based)
// ---------------------------------------------------------------------------

// 동시 갱신을 방지하기 위한 단일 비행 Promise
let refreshPromise: Promise<unknown> | null = null;

// 요청이 재시도되었는지 추적하기 위한 커스텀 플래그 키
const RETRIED_FLAG = "__retriedAfterRefresh" as const;

function isAuthPath(url: string | undefined): boolean {
  if (!url) return false;
  // '/auth/...' 경로는 refresh 시도 대상에서 제외 (루프 방지)
  return /\/auth\//.test(url);
}

const AUTH_COOKIE_NAMES = ["accessToken", "refreshToken"];
const WRONG_DOMAINS = [
  "api.meloming.pri.sbalyd.com",
  ".api.meloming.pri.sbalyd.com",
  "api.meloming.com",
  ".api.meloming.com",
];

/**
 * 잘못된 도메인으로 설정된 인증 쿠키만 삭제합니다.
 * refresh 성공 후 호출 — 현재 도메인의 유효한 쿠키는 유지합니다.
 */
function deleteWrongDomainCookies(): void {
  if (typeof document === "undefined") return;
  for (const cookieName of AUTH_COOKIE_NAMES) {
    for (const wrongDomain of WRONG_DOMAINS) {
      document.cookie = `${cookieName}=; path=/; domain=${wrongDomain}; max-age=0`;
    }
  }
}

/**
 * 인증 쿠키(accessToken, refreshToken)를 모두 삭제합니다.
 * 현재 도메인 + 잘못된 도메인 모두 삭제 — refresh 실패 시에만 호출합니다.
 */
function deleteAuthCookies(): void {
  if (typeof document === "undefined") return;
  for (const cookieName of AUTH_COOKIE_NAMES) {
    document.cookie = `${cookieName}=; path=/; max-age=0`;
    document.cookie = `${cookieName}=; path=/; domain=${window.location.hostname}; max-age=0`;
    for (const wrongDomain of WRONG_DOMAINS) {
      document.cookie = `${cookieName}=; path=/; domain=${wrongDomain}; max-age=0`;
    }
  }
}

// '/v1/auth/refresh' 호출 유틸 (쿠키 기반)
async function callRefresh(): Promise<void> {
  const clientForRefresh = apiClient; // v1 엔드포인트 기준
  await clientForRefresh.post("/auth/refresh", {}, { withCredentials: true });

  // refresh 성공 후 잘못된 도메인 쿠키만 삭제 (현재 도메인 쿠키는 유지)
  deleteWrongDomainCookies();

  // 인증 상태 의존 React Query/RSC가 stale로 남지 않도록 broadcast.
  // listener는 AuthRefreshListener 참고.
  emitAuthRefreshed();
}

// 응답 인터셉터 공통 로직을 주입하는 함수.
// 다른 axios 인스턴스 (cross-host live-service 등) 도 동일한 401 -> /auth/refresh
// 단일 비행 -> retry-once 흐름을 갖도록 export 한다.
export function attachResponseInterceptor(instance: AxiosInstance): void {
  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const rejectNormalized = () => {
        normalizeAxiosErrorMessage(error);
        return Promise.reject(error);
      };

      const response = error.response;
      const config = error.config as
        | (InternalAxiosRequestConfig & {
            [RETRIED_FLAG]?: boolean;
          })
        | undefined;

      // 네트워크/응답 없는 에러는 그대로 전달
      if (!response || !config) {
        return rejectNormalized();
      }

      const status = response.status;
      const requestUrl = config.url;

      // 401이 아니거나, 이미 한 번 재시도한 요청이면 그대로 리젝트
      if (status !== 401 || config[RETRIED_FLAG]) {
        return rejectNormalized();
      }

      // auth 관련 경로는 refresh 시도하지 않음 (무한 루프 방지)
      if (isAuthPath(requestUrl)) {
        return rejectNormalized();
      }

      try {
        // 단일 비행 보장: 기존 refreshPromise가 있으면 그걸 기다리고, 없으면 새로 실행
        if (!refreshPromise) {
          refreshPromise = callRefresh().finally(() => {
            refreshPromise = null;
          });
        }
        await refreshPromise;

        // 토큰 갱신 성공 시, 원래 요청 한 번만 재시도
        config[RETRIED_FLAG] = true;
        // withCredentials가 필요한 API가 다수이므로 기본적으로 유지
        const retryConfig: InternalAxiosRequestConfig = {
          ...config,
          withCredentials: true,
        } as InternalAxiosRequestConfig;

        return instance.request(retryConfig);
      } catch (refreshError) {
        // refresh 실패 → 만료된 토큰 쿠키 삭제 후 원본 에러 전달.
        // refresh 실패 자체는 별도 로깅(401 무한 loop 디버깅 시 원인 파악용).
        if (process.env.NODE_ENV !== "production" || typeof window !== "undefined") {
          console.warn(
            "[api-client] auth refresh failed:",
            refreshError instanceof Error ? refreshError.message : refreshError,
          );
        }
        deleteAuthCookies();
        return rejectNormalized();
      }
    }
  );
}

// 두 클라이언트 모두에 인터셉터 장착
attachResponseInterceptor(apiClient);
attachResponseInterceptor(apiV2Client);
