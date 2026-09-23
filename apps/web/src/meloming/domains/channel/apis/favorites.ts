import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  FavoriteToggleResponse,
  GetFavoritesChannelsResponse,
  GetFavoritesSongsResponse,
  FavoriteStatusResponse,
  FavoritesStatsResponse,
  SongFavoritesCountResponse,
  ChannelFavoritesCountResponse,
  GetFavoritesChannelUsersResponse,
  GetFavoriteChannelAnniversariesResponse,
} from "@/meloming/domains/channel/types/favorite";

/**
 * PUT /favorites/channels/{channelId}
 * 채널 즐겨찾기 토글
 */
export async function putFavoriteChannelToggle(
  channelId: number
): Promise<FavoriteToggleResponse> {
  const response = await apiClient.put<FavoriteToggleResponse>(
    `/favorites/channels/${channelId}`,
    undefined,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * DELETE /favorites/channels/{channelId}
 * 채널 즐겨찾기 해제
 */
export async function deleteFavoriteChannel(
  channelId: number
): Promise<FavoriteToggleResponse> {
  const response = await apiClient.delete<FavoriteToggleResponse>(
    `/favorites/channels/${channelId}`,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * PUT /favorites/songs/{songId}
 * 노래 즐겨찾기 토글
 */
export async function putFavoriteSongToggle(
  songId: number
): Promise<FavoriteToggleResponse> {
  const response = await apiClient.put<FavoriteToggleResponse>(
    `/favorites/songs/${songId}`,
    undefined,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * DELETE /favorites/songs/{songId}
 * 노래 즐겨찾기 해제
 */
export async function deleteFavoriteSong(
  songId: number
): Promise<FavoriteToggleResponse> {
  const response = await apiClient.delete<FavoriteToggleResponse>(
    `/favorites/songs/${songId}`,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * GET /favorites/channels
 * 내 즐겨찾기 채널 목록 (page, limit)
 */
export async function getFavoriteChannels(
  params: {
    page?: number;
    limit?: number;
  } = {}
): Promise<GetFavoritesChannelsResponse> {
  const response = await apiClient.get<GetFavoritesChannelsResponse>(
    "/favorites/channels",
    { params, withCredentials: true }
  );
  return response.data;
}

/**
 * GET /favorites/songs
 * 내 즐겨찾기 노래 목록 (page, limit)
 */
export async function getFavoriteSongs(
  params: {
    page?: number;
    limit?: number;
  } = {}
): Promise<GetFavoritesSongsResponse> {
  const response = await apiClient.get<GetFavoritesSongsResponse>(
    "/favorites/songs",
    { params, withCredentials: true }
  );
  return response.data;
}

/**
 * GET /favorites/channels/{channelId}/status
 */
export async function getFavoriteChannelStatus(
  channelId: number
): Promise<FavoriteStatusResponse> {
  const response = await apiClient.get<FavoriteStatusResponse>(
    `/favorites/channels/${channelId}/status`,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * GET /favorites/songs/{songId}/status
 */
export async function getFavoriteSongStatus(
  songId: number
): Promise<FavoriteStatusResponse> {
  const response = await apiClient.get<FavoriteStatusResponse>(
    `/favorites/songs/${songId}/status`,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * GET /favorites/stats
 */
export async function getFavoritesStats(): Promise<FavoritesStatsResponse> {
  const response = await apiClient.get<FavoritesStatsResponse>(
    "/favorites/stats",
    { withCredentials: true }
  );
  return response.data;
}

/**
 * GET /favorites/songs/{songId}/count
 */
export async function getSongFavoritesCount(
  songId: number
): Promise<SongFavoritesCountResponse> {
  const response = await apiClient.get<SongFavoritesCountResponse>(
    `/favorites/songs/${songId}/count`
  );
  return response.data;
}

/**
 * GET /favorites/channels/{channelId}/count
 */
export async function getChannelFavoritesCount(
  channelId: number
): Promise<ChannelFavoritesCountResponse> {
  const response = await apiClient.get<ChannelFavoritesCountResponse>(
    `/favorites/channels/${channelId}/count`
  );
  return response.data;
}

/**
 * GET /favorites/channels/{channelId}/users
 * 채널을 즐겨찾기한 사용자 목록 조회
 */
export async function getChannelFavoriteUsers(
  channelId: number,
  params: {
    page?: number;
    limit?: number;
  } = {}
): Promise<GetFavoritesChannelUsersResponse> {
  const response = await apiClient.get<GetFavoritesChannelUsersResponse>(
    `/favorites/channels/${channelId}/users`,
    { params, withCredentials: true }
  );
  return response.data;
}

/**
 * GET /favorites/channels/anniversaries
 * 즐겨찾기 채널 기념일 목록 조회
 */
export async function getFavoriteChannelAnniversaries(): Promise<GetFavoriteChannelAnniversariesResponse> {
  const response = await apiClient.get<GetFavoriteChannelAnniversariesResponse>(
    "/favorites/channels/anniversaries",
    { withCredentials: true }
  );
  return response.data;
}

/**
 * PATCH /favorites/channels/reorder
 * 즐겨찾기 채널 순서 변경
 */
export async function patchReorderFavoriteChannels(channelIds: number[]) {
  const response = await apiClient.patch<{ success: true }>(
    "/favorites/channels/reorder",
    { channelIds },
    { withCredentials: true }
  );
  return response.data;
}
