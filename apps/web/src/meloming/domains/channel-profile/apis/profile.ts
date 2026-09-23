import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  GetChannelProfileResponse,
  PutChannelProfileRequestBody,
  PutChannelProfileResponse,
  PatchChannelProfileRequestBody,
  PatchChannelProfileResponse,
} from "@/meloming/domains/channel-profile/types/profile";

/**
 * GET /channel/{channelId}/profile
 * 채널 프로필 조회 (공개)
 */
export async function getChannelProfile(
  channelId: number
): Promise<GetChannelProfileResponse> {
  const response = await apiClient.get<GetChannelProfileResponse>(
    `/channel/${channelId}/profile`
  );
  return response.data;
}

/**
 * PUT /channel/{channelId}/profile
 * 채널 프로필 전체 업데이트 (소유자/관리자)
 */
export async function putChannelProfile(
  channelId: number,
  body: PutChannelProfileRequestBody
): Promise<PutChannelProfileResponse> {
  const response = await apiClient.put<PutChannelProfileResponse>(
    `/channel/${channelId}/profile`,
    body,
    {
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * PATCH /channel/{channelId}/profile
 * 채널 프로필 부분 업데이트 (소유자/관리자)
 */
export async function patchChannelProfile(
  channelId: number,
  body: PatchChannelProfileRequestBody
): Promise<PatchChannelProfileResponse> {
  const response = await apiClient.patch<PatchChannelProfileResponse>(
    `/channel/${channelId}/profile`,
    body,
    {
      withCredentials: true,
    }
  );
  return response.data;
}

