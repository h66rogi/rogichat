import { fetchServerJson } from "@/meloming/shared/lib/server-api-client";
import type { PublicSetlistAvailabilityResponse } from "../types/setlist";

/**
 * GET /v1/song-live/public/setlists/availability
 * 채널 layout SSR에서 셋리스트 탭 노출 여부 결정용. 가벼운 COUNT 쿼리.
 */
export async function getChannelSetlistAvailabilityServer(
  identifier: string
): Promise<PublicSetlistAvailabilityResponse> {
  try {
    return await fetchServerJson<PublicSetlistAvailabilityResponse>(
      "/v1/song-live/public/setlists/availability",
      {
        cache: "no-store",
        queryParams: { identifier },
      },
      "Failed to fetch setlist availability"
    );
  } catch (error) {
    // 채널 layout 의 탭 노출 여부 결정용. 페이지 자체를 죽이지 않게 fail-open
    // (탭 안 보이는 쪽으로 graceful) 하되, BE 장애를 로그로 가시화.
    console.error("setlist availability fetch failed:", error);
    return { available: false, count: 0 };
  }
}
