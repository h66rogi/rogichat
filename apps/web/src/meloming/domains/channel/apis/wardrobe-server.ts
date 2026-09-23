import type { ChannelWardrobe } from "@/meloming/domains/channel/types/wardrobe";
import { throwApiResponseError } from "@/meloming/shared/lib/api-error";
import { fetchServer } from "@/meloming/shared/lib/server-api-client";

export async function getChannelWardrobeServer(
  identifier: string,
): Promise<ChannelWardrobe | null> {
  const response = await fetchServer(
    `/v1/channel/${encodeURIComponent(identifier)}/wardrobe`,
    {
      cache: "no-store",
    }
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    await throwApiResponseError(response, "옷장 정보를 불러오지 못했습니다");
  }

  return (await response.json()) as ChannelWardrobe;
}
