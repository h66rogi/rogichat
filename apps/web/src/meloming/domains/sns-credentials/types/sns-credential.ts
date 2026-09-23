import type { SnsPlatform } from "./sns-platform";

/**
 * `GET /v1/sns-credentials` 응답 항목.
 *
 * 백엔드 `SnsCredentialResponseDto` 와 1:1 동기화.
 * 보안: accessToken / refreshToken 은 절대 포함되지 않음.
 */
export interface SnsCredentialResponse {
  /** SNS 플랫폼 식별자 */
  platform: SnsPlatform;
  /** 연동 레코드 존재 여부 */
  isConnected: boolean;
  /** 연동이 활성 상태인지 여부. 해제 시 false. */
  isActive: boolean;
  /** 외부 계정 핸들/닉네임 (예: '@meloming') */
  handle: string | null;
  /** 외부 사용자 ID */
  externalUserId: string | null;
  /** 최초 연동 시각 (ISO string) */
  connectedAt: string | null;
  /** 액세스 토큰 만료 시각 (ISO string) */
  expiresAt: string | null;
}

/**
 * `POST /v1/sns-credentials/:platform/connect` 응답.
 *
 * 백엔드 `OauthAuthorizeResponseDto` 와 1:1 동기화.
 * 프론트는 반환된 authorizeUrl 로 window.location 이동시킴.
 */
export interface OauthAuthorizeResponse {
  authorizeUrl: string;
}

/**
 * OAuth callback 후 backend 가 redirect URL 에 싣는 reason 코드.
 *
 * 백엔드 `OAUTH_CALLBACK_REASON` 과 1:1 동기화.
 * - 신규 코드 추가 시 양쪽을 모두 업데이트할 것.
 */
export const OAUTH_CALLBACK_REASONS = [
  "invalid_platform",
  "oauth_state_unavailable",
  "oauth_state_invalid",
  "oauth_provider_failed",
  "oauth_failed",
] as const;

export type OauthCallbackReason = (typeof OAUTH_CALLBACK_REASONS)[number];

export function isOauthCallbackReason(
  value: unknown,
): value is OauthCallbackReason {
  return (
    typeof value === "string" &&
    (OAUTH_CALLBACK_REASONS as readonly string[]).includes(value)
  );
}
