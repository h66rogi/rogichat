import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  DeleteCategoriesChannelChannelIdCategoriesCategoriesIdResponse,
  GetCategoriesChannelChannelIdCategoriesResponse,
  GetCategoriesPublicWebPathResponse,
  PostCategoriesChannelChannelIdCategoriesRequestBody,
  PostCategoriesChannelChannelIdCategoriesResponse,
  PostCategoriesChannelChannelIdCategoriesSwapOrderRequestBody,
  PostCategoriesChannelChannelIdCategoriesSwapOrderResponse,
  PutCategoriesChannelChannelIdCategoriesCategoriesIdRequestBody,
  PutCategoriesChannelChannelIdCategoriesCategoriesIdResponse,
} from "@/meloming/domains/channel/types/category";

/**
 * Get /categories/public/{webPath}
 */
export async function getCategoriesPublicWebPath(
  webPath: string
): Promise<GetCategoriesPublicWebPathResponse> {
  const response = await apiClient.get<GetCategoriesPublicWebPathResponse>(
    `/categories/public/${webPath}`
  );

  return response.data;
}

/**
 * Get /categories/channel/{channelId}/categories
 */
export async function getCategoriesChannelChannelIdCategories(
  channelId: number
): Promise<GetCategoriesChannelChannelIdCategoriesResponse> {
  const response =
    await apiClient.get<GetCategoriesChannelChannelIdCategoriesResponse>(
      `/categories/channel/${channelId}/categories`,
      {
        withCredentials: true,
      }
    );

  return response.data;
}

/**
 * Post /categories/channel/{channelId}/categories
 */
export async function postCategoriesChannelChannelIdCategories(
  channelId: number,
  body: PostCategoriesChannelChannelIdCategoriesRequestBody
): Promise<PostCategoriesChannelChannelIdCategoriesResponse> {
  const response =
    await apiClient.post<PostCategoriesChannelChannelIdCategoriesResponse>(
      `/categories/channel/${channelId}/categories`,
      body,
      {
        withCredentials: true,
      }
    );

  return response.data;
}

/**
 * Post /categories/channel/{channelId}/categories/swap-order
 */
export async function postCategoriesChannelChannelIdCategoriesSwapOrder(
  channelId: number,
  body: PostCategoriesChannelChannelIdCategoriesSwapOrderRequestBody
): Promise<PostCategoriesChannelChannelIdCategoriesSwapOrderResponse> {
  const response =
    await apiClient.post<PostCategoriesChannelChannelIdCategoriesSwapOrderResponse>(
      `/categories/channel/${channelId}/categories/swap-order`,
      body,
      {
        withCredentials: true,
      }
    );

  return response.data;
}

/**
 * Put /categories/channel/{channelId}/categories/{categoriesId}
 */
export async function putCategoriesChannelChannelIdCategoriesCategoriesId(
  channelId: number,
  categoriesId: number,
  body: PutCategoriesChannelChannelIdCategoriesCategoriesIdRequestBody
): Promise<PutCategoriesChannelChannelIdCategoriesCategoriesIdResponse> {
  const response =
    await apiClient.put<PutCategoriesChannelChannelIdCategoriesCategoriesIdResponse>(
      `/categories/channel/${channelId}/categories/${categoriesId}`,
      body,
      {
        withCredentials: true,
      }
    );

  return response.data;
}

/**
 * Delete /categories/channel/{channelId}/categories/{categoriesId}
 */
export async function deleteCategoriesChannelChannelIdCategoriesCategoriesId(
  channelId: number,
  categoriesId: number
): Promise<DeleteCategoriesChannelChannelIdCategoriesCategoriesIdResponse> {
  const response =
    await apiClient.delete<DeleteCategoriesChannelChannelIdCategoriesCategoriesIdResponse>(
      `/categories/channel/${channelId}/categories/${categoriesId}`,
      {
        withCredentials: true,
      }
    );

  return response.data;
}
