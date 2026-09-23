import type { Platform } from "@/meloming/domains/platform/types/platform";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

/**
 * 플랫폼 OAuth URL 생성
 * 백엔드 OAuth 시작 엔드포인트로 리다이렉트
 */
export function getPlatformOAuthUrl(platform: Platform): string {
  const platformLower = platform.toLowerCase();
  return `${API_BASE_URL}/v1/platform/oauth/${platformLower}`;
}

/**
 * OAuth 팝업 창 열기
 * @returns 팝업 윈도우 객체
 */
export function openOAuthPopup(platform: Platform): Window | null {
  const url = getPlatformOAuthUrl(platform);
  const width = 500;
  const height = 700;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;

  return window.open(
    url,
    `${platform}_oauth`,
    `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
  );
}

/**
 * OAuth 콜백 메시지 타입
 */
export interface OAuthCallbackMessage {
  type: "OAUTH_SUCCESS" | "OAUTH_ERROR";
  platform: Platform;
  accessToken?: string;
  refreshToken?: string;
  error?: string;
}

/**
 * OAuth 콜백 메시지 유효성 검사
 */
export function isOAuthCallbackMessage(
  data: unknown
): data is OAuthCallbackMessage {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const message = data as Record<string, unknown>;

  return (
    (message.type === "OAUTH_SUCCESS" || message.type === "OAUTH_ERROR") &&
    typeof message.platform === "string"
  );
}
