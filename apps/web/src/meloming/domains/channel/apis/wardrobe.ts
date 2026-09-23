import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  ChannelWardrobe,
  CreateWardrobeCategoryInput,
  CreateWardrobeItemInput,
  UpdateWardrobeCategoryInput,
  UpdateWardrobeItemInput,
} from "@/meloming/domains/channel/types/wardrobe";

export async function getChannelWardrobe(
  identifier: string
): Promise<ChannelWardrobe> {
  const response = await apiClient.get<ChannelWardrobe>(
    `/channel/${identifier}/wardrobe`
  );
  return response.data;
}

export async function getChannelWardrobeManage(
  identifier: string
): Promise<ChannelWardrobe> {
  const response = await apiClient.get<ChannelWardrobe>(
    `/channel/${identifier}/wardrobe/manage`,
    { withCredentials: true }
  );
  return response.data;
}

export async function createWardrobeCategory(
  identifier: string,
  input: CreateWardrobeCategoryInput
): Promise<ChannelWardrobe> {
  const response = await apiClient.post<ChannelWardrobe>(
    `/channel/${identifier}/wardrobe/categories`,
    input,
    { withCredentials: true }
  );
  return response.data;
}

export async function updateWardrobeCategory(
  identifier: string,
  categoryId: number,
  input: UpdateWardrobeCategoryInput
): Promise<ChannelWardrobe> {
  const response = await apiClient.patch<ChannelWardrobe>(
    `/channel/${identifier}/wardrobe/categories/${categoryId}`,
    input,
    { withCredentials: true }
  );
  return response.data;
}

export async function deleteWardrobeCategory(
  identifier: string,
  categoryId: number
): Promise<ChannelWardrobe> {
  const response = await apiClient.delete<ChannelWardrobe>(
    `/channel/${identifier}/wardrobe/categories/${categoryId}`,
    { withCredentials: true }
  );
  return response.data;
}

export async function createWardrobeItem(
  identifier: string,
  input: CreateWardrobeItemInput
): Promise<ChannelWardrobe> {
  const response = await apiClient.post<ChannelWardrobe>(
    `/channel/${identifier}/wardrobe/items`,
    input,
    { withCredentials: true }
  );
  return response.data;
}

export async function updateWardrobeItem(
  identifier: string,
  itemId: number,
  input: UpdateWardrobeItemInput
): Promise<ChannelWardrobe> {
  const response = await apiClient.patch<ChannelWardrobe>(
    `/channel/${identifier}/wardrobe/items/${itemId}`,
    input,
    { withCredentials: true }
  );
  return response.data;
}

export async function deleteWardrobeItem(
  identifier: string,
  itemId: number
): Promise<ChannelWardrobe> {
  const response = await apiClient.delete<ChannelWardrobe>(
    `/channel/${identifier}/wardrobe/items/${itemId}`,
    { withCredentials: true }
  );
  return response.data;
}
