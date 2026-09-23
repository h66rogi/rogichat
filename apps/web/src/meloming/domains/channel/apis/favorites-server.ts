import type {
  ChannelFavoritesCountResponse,
  GetFavoritesChannelsResponse,
  GetFavoritesSongsResponse,
  GetFavoriteChannelAnniversariesResponse,
} from "@/meloming/domains/channel/types/favorite";
import {
  fetchServerJson,
  fetchServerJsonWithAuth,
} from "@/meloming/shared/lib/server-api-client";

/**
 * 서버 컴포넌트에서 사용하는 즐겨찾기 API 함수들
 */

/**
 * GET /favorites/channels/{channelId}/count
 * 채널의 즐겨찾기 수를 조회합니다. (비인증)
 */
export async function getChannelFavoritesCountServer(
  channelId: number
): Promise<ChannelFavoritesCountResponse | null> {
  try {
    return await fetchServerJson<ChannelFavoritesCountResponse>(
      `/v1/favorites/channels/${channelId}/count`,
      {
        cache: "no-store",
      },
      "Failed to fetch channel favorites count"
    );
  } catch (error) {
    console.error("favorites-server fetch failed:", error);
    return null;
  }
}

/**
 * GET /favorites/channels
 * 내 즐겨찾기 채널 목록을 조회합니다. (인증 필요)
 */
export async function getFavoriteChannelsServer(params: {
  page?: number;
  limit?: number;
}): Promise<GetFavoritesChannelsResponse | null> {
  try {
    const queryParams: Record<string, string> = {};
    if (params.page !== undefined) {
      queryParams.page = String(params.page);
    }
    if (params.limit !== undefined) {
      queryParams.limit = String(params.limit);
    }

    return await fetchServerJsonWithAuth<GetFavoritesChannelsResponse>(
      "/v1/favorites/channels",
      {
        cache: "no-store",
        queryParams:
          Object.keys(queryParams).length > 0 ? queryParams : undefined,
      },
      "Failed to fetch favorite channels"
    );
  } catch (error) {
    console.error("favorites-server fetch failed:", error);
    return null;
  }
}

/**
 * GET /favorites/songs
 * 내 즐겨찾기 노래 목록을 조회합니다. (인증 필요)
 */
export async function getFavoriteSongsServer(params: {
  page?: number;
  limit?: number;
}): Promise<GetFavoritesSongsResponse | null> {
  try {
    const queryParams: Record<string, string> = {};
    if (params.page !== undefined) {
      queryParams.page = String(params.page);
    }
    if (params.limit !== undefined) {
      queryParams.limit = String(params.limit);
    }

    return await fetchServerJsonWithAuth<GetFavoritesSongsResponse>(
      "/v1/favorites/songs",
      {
        cache: "no-store",
        queryParams:
          Object.keys(queryParams).length > 0 ? queryParams : undefined,
      },
      "Failed to fetch favorite songs"
    );
  } catch (error) {
    console.error("favorites-server fetch failed:", error);
    return null;
  }
}

/**
 * GET /favorites/channels/anniversaries
 * 즐겨찾기 채널 기념일 목록 조회 (인증 필요)
 */
export async function getFavoriteChannelAnniversariesServer(): Promise<GetFavoriteChannelAnniversariesResponse | null> {
  try {
    return await fetchServerJsonWithAuth<GetFavoriteChannelAnniversariesResponse>(
      "/v1/favorites/channels/anniversaries",
      {
        cache: "force-cache",
        next: {
          revalidate: 300, // 5분
        },
      },
      "Failed to fetch favorite channel anniversaries"
    );
  } catch (error) {
    console.error("favorites-server fetch failed:", error);
    return null;
  }
}
