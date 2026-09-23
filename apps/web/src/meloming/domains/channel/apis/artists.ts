import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  DeleteArtistsChannelChannelIdArtistsArtistsIdResponse,
  GetArtistsChannelChannelIdArtistsResponse,
  GetArtistsPublicWebPathResponse,
  PostArtistsChannelChannelIdArtistsRequestBody,
  PostArtistsChannelChannelIdArtistsResponse,
  PutArtistsChannelChannelIdArtistsArtistsIdRequestBody,
  PutArtistsChannelChannelIdArtistsArtistsIdResponse,
} from "@/meloming/domains/channel/types/artist";

/**
 * Get /artists/public/{webPath}
 */
export async function getArtistsPublicWebPath(
  webPath: string
): Promise<GetArtistsPublicWebPathResponse> {
  const response = await apiClient.get<GetArtistsPublicWebPathResponse>(
    `/artists/public/${webPath}`
  );

  return response.data;
}

/**
 * Get /artists/channel/{channelId}/artists
 */
export async function getArtistsChannelChannelIdArtists(
  channelId: number
): Promise<GetArtistsChannelChannelIdArtistsResponse> {
  const response =
    await apiClient.get<GetArtistsChannelChannelIdArtistsResponse>(
      `/artists/channel/${channelId}/artists`,
      {
        withCredentials: true,
      }
    );

  return response.data;
}

/**
 * Post /artists/channel/{channelId}/artists
 */
export async function postArtistsChannelChannelIdArtists(
  channelId: number,
  body: PostArtistsChannelChannelIdArtistsRequestBody
): Promise<PostArtistsChannelChannelIdArtistsResponse> {
  const response =
    await apiClient.post<PostArtistsChannelChannelIdArtistsResponse>(
      `/artists/channel/${channelId}/artists`,
      body,
      {
        withCredentials: true,
      }
    );

  return response.data;
}

/**
 * Put /artists/channel/{channelId}/artists/{artistsId}
 */
export async function putArtistsChannelChannelIdArtistsArtistsId(
  channelId: number,
  artistsId: number,
  body: PutArtistsChannelChannelIdArtistsArtistsIdRequestBody
): Promise<PutArtistsChannelChannelIdArtistsArtistsIdResponse> {
  const response =
    await apiClient.put<PutArtistsChannelChannelIdArtistsArtistsIdResponse>(
      `/artists/channel/${channelId}/artists/${artistsId}`,
      body,
      {
        withCredentials: true,
      }
    );

  return response.data;
}

/**
 * Delete /artists/channel/{channelId}/artists/{artistsId}
 */
export async function deleteArtistsChannelChannelIdArtistsArtistsId(
  channelId: number,
  artistsId: number
): Promise<DeleteArtistsChannelChannelIdArtistsArtistsIdResponse> {
  const response =
    await apiClient.delete<DeleteArtistsChannelChannelIdArtistsArtistsIdResponse>(
      `/artists/channel/${channelId}/artists/${artistsId}`,
      {
        withCredentials: true,
      }
    );

  return response.data;
}
