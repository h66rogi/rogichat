import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  SnsCredentialResponse,
  OauthAuthorizeResponse,
} from "@/meloming/domains/sns-credentials/types/sns-credential";
import type { SnsPlatform } from "@/meloming/domains/sns-credentials/types/sns-platform";

/**
 * GET /v1/sns-credentials
 * 내 SNS 연동 상태 목록 (X, NAVER_CAFE 각 1건).
 */
export async function getSnsCredentials(): Promise<SnsCredentialResponse[]> {
  const response = await apiClient.get<SnsCredentialResponse[]>(
    "/sns-credentials",
    { withCredentials: true },
  );
  return response.data;
}

/**
 * POST /v1/sns-credentials/:platform/connect
 * SNS OAuth 시작 — provider authorize URL 발급.
 *
 * 호출 후 프론트에서 `window.location.href = authorizeUrl` 로 이동시킨다.
 */
export async function startSnsOauth(
  platform: SnsPlatform,
): Promise<OauthAuthorizeResponse> {
  const response = await apiClient.post<OauthAuthorizeResponse>(
    `/sns-credentials/${platform}/connect`,
    {},
    { withCredentials: true },
  );
  return response.data;
}

/**
 * DELETE /v1/sns-credentials/:platform
 * SNS 연동 해제.
 */
export async function disconnectSns(platform: SnsPlatform): Promise<void> {
  await apiClient.delete(`/sns-credentials/${platform}`, {
    withCredentials: true,
  });
}
