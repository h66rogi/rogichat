import { apiClient } from "@/meloming/shared/lib/api-client";
import type { ChannelEmoticon, PublicEmoticon } from "../types";

export async function getApprovedEmoticons(
  channelId: number,
): Promise<PublicEmoticon[]> {
  const { data } = await apiClient.get<PublicEmoticon[]>(
    `/channels/${channelId}/emoticons`,
  );
  return data;
}

export async function getMyEmoticons(
  channelId: number,
): Promise<ChannelEmoticon[]> {
  const { data } = await apiClient.get<ChannelEmoticon[]>(
    `/channels/${channelId}/emoticons/mine`,
  );
  return data;
}

export async function uploadEmoticon(
  channelId: number,
  form: FormData,
): Promise<ChannelEmoticon> {
  const { data } = await apiClient.post<ChannelEmoticon>(
    `/channels/${channelId}/emoticons`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return data;
}

export async function softDeleteEmoticon(
  channelId: number,
  emoticonId: number,
): Promise<void> {
  await apiClient.delete(`/channels/${channelId}/emoticons/${emoticonId}`);
}
