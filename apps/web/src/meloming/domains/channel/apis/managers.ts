import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  GetChannelsChannelIdManagersResponse,
  GetChannelsChannelIdManagersSearchUsersRequestQuery,
  GetChannelsChannelIdManagersSearchUsersResponse,
  PatchChannelsChannelIdManagersManagerIdRequestBody,
  PostChannelsChannelIdManagersRequestBody,
  ToggleManagerActiveResponse,
  Manager,
} from "@/meloming/domains/channel/types/manager";

/**
 * GET /channels/{channelId}/managers/search-users
 */
export async function getChannelsChannelIdManagersSearchUsers(
  channelId: number,
  query: GetChannelsChannelIdManagersSearchUsersRequestQuery
): Promise<GetChannelsChannelIdManagersSearchUsersResponse> {
  const response =
    await apiClient.get<GetChannelsChannelIdManagersSearchUsersResponse>(
      `/channels/${channelId}/managers/search-users`,
      {
        params: { nickname: query.nickname },
        withCredentials: true,
      }
    );

  return response.data;
}

/**
 * GET /channels/{channelId}/managers
 */
export async function getChannelsChannelIdManagers(
  channelId: number
): Promise<GetChannelsChannelIdManagersResponse> {
  const response = await apiClient.get<GetChannelsChannelIdManagersResponse>(
    `/channels/${channelId}/managers`,
    { withCredentials: true }
  );

  return response.data;
}

/**
 * POST /channels/{channelId}/managers
 */
export async function postChannelsChannelIdManagers(
  channelId: number,
  body: PostChannelsChannelIdManagersRequestBody
): Promise<Manager> {
  const response = await apiClient.post<Manager>(
    `/channels/${channelId}/managers`,
    body,
    { withCredentials: true }
  );

  return response.data;
}

/**
 * PATCH /channels/{channelId}/managers/{managerId}/permissions
 */
export async function patchChannelsChannelIdManagersManagerId(
  channelId: number,
  managerId: number,
  body: PatchChannelsChannelIdManagersManagerIdRequestBody
): Promise<Manager> {
  const response = await apiClient.patch<Manager>(
    `/channels/${channelId}/managers/${managerId}/permissions`,
    body,
    { withCredentials: true }
  );

  return response.data;
}

/**
 * DELETE /channels/{channelId}/managers/{managerId}
 */
export async function deleteChannelsChannelIdManagersManagerId(
  channelId: number,
  managerId: number
): Promise<void> {
  await apiClient.delete(`/channels/${channelId}/managers/${managerId}`, {
    withCredentials: true,
  });
}

/**
 * PATCH /channels/{channelId}/managers/{managerId}/active
 * 매니저 활성화/비활성화 토글
 */
export async function patchChannelsChannelIdManagersActive(
  channelId: number,
  managerId: number,
  isActive: boolean
): Promise<ToggleManagerActiveResponse> {
  const response = await apiClient.patch<ToggleManagerActiveResponse>(
    `/channels/${channelId}/managers/${managerId}/active`,
    { isActive },
    { withCredentials: true }
  );

  return response.data;
}
