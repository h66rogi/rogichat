import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  Platform,
  StreamPlatform,
} from "@/meloming/domains/platform/types/platform";
import type {
  GetMyPlatformVerificationsResponse,
  VerifyPlatformRequestDto,
  VerifyPlatformResponseDto,
} from "@/meloming/domains/platform/types/platform-verification";

/**
 * GET /platform/verification/me
 * 내 플랫폼 인증 목록 조회
 */
export async function getMyPlatformVerifications(): Promise<GetMyPlatformVerificationsResponse> {
  const response = await apiClient.get<GetMyPlatformVerificationsResponse>(
    "/platform/verification/me",
    { withCredentials: true }
  );
  return response.data;
}

/**
 * POST /platform/verification/verify/{platform}
 * 플랫폼 인증 수행
 */
export async function verifyPlatform(
  platform: Platform,
  body: VerifyPlatformRequestDto
): Promise<VerifyPlatformResponseDto> {
  const response = await apiClient.post<VerifyPlatformResponseDto>(
    `/platform/verification/verify/${platform}`,
    body,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * DELETE /platform/verification/me/{platform}
 * 플랫폼 인증 해제
 */
export async function revokePlatformVerification(
  platform: StreamPlatform
): Promise<{ success: boolean }> {
  const response = await apiClient.delete<{ success: boolean }>(
    `/platform/verification/me/${platform}`,
    { withCredentials: true }
  );
  return response.data;
}
