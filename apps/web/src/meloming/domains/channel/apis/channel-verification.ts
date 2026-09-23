import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  ChannelVerificationPreviewDto,
  ChannelVerificationDto,
  CreateChannelVerificationDto,
} from "@/meloming/domains/channel/types/channel-verification";
import type { StreamPlatform } from "@/meloming/domains/platform/types/platform";

/**
 * GET /channel/{identifier}/verification/preview
 * 채널 인증 미리보기 (자동 매칭 정보)
 */
export async function getChannelVerificationPreview(
  identifier: string,
  platform?: StreamPlatform
): Promise<ChannelVerificationPreviewDto> {
  const response = await apiClient.get<ChannelVerificationPreviewDto>(
    `/channel/${identifier}/verification/preview`,
    {
      withCredentials: true,
      params: platform ? { platform } : undefined,
    }
  );
  return response.data;
}

/**
 * GET /channel/{identifier}/verification
 * 채널 인증 상태 조회 (복수)
 */
export async function getChannelVerifications(
  identifier: string
): Promise<ChannelVerificationDto[]> {
  const response = await apiClient.get<ChannelVerificationDto[]>(
    `/channel/${identifier}/verification`,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * POST /channel/{identifier}/verification
 * 채널 인증 신청
 */
export async function createChannelVerification(
  identifier: string,
  body: CreateChannelVerificationDto
): Promise<ChannelVerificationDto> {
  const response = await apiClient.post<ChannelVerificationDto>(
    `/channel/${identifier}/verification`,
    body,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * DELETE /channel/{identifier}/verification/{platform}
 * 특정 플랫폼 인증 해제
 */
export async function revokeChannelVerification(
  identifier: string,
  platform: StreamPlatform
): Promise<void> {
  await apiClient.delete(`/channel/${identifier}/verification/${platform}`, {
    withCredentials: true,
  });
}
