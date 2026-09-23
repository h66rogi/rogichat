import type {
  GetFamousChannelsRequestQuery,
  GetFamousChannelsResponse,
  GetRecentChannelsRequestQuery,
  GetRecentChannelsResponse,
  GetAllChannelsResponse,
  Channel,
  GetChannelIdentifierPermissionResponse,
} from "@/meloming/domains/channel/types/channel";
import {
  DEFAULT_CHANNEL_FEATURE_SETTINGS,
  type ChannelFeatureSettings,
} from "@/meloming/domains/channel/types/channel-tab";
import {
  fetchServer,
  fetchServerJson,
  fetchServerWithAuth,
} from "@/meloming/shared/lib/server-api-client";
import { throwApiResponseError } from "@/meloming/shared/lib/api-error";

const normalizeNullableNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const encodeChannelIdentifier = (identifier: string): string =>
  encodeURIComponent(identifier);

/**
 * 서버 컴포넌트에서 사용하는 채널 API 함수들
 * 쿠키를 자동으로 전달합니다.
 */

/**
 * GET /channel/{identifier} - 채널 정보 조회 (비인증)
 * 서버 컴포넌트에서 사용하며, SEO 메타데이터 생성에 사용됩니다.
 *
 * 진짜 404(채널 없음)는 `null` 반환 → 호출 측 `notFound()`.
 * 그 외 비 2xx 응답은 throw → `error.tsx` 가 처리.
 */
export async function getChannelIdentifierServer(
  identifier: string
): Promise<Channel | null> {
  const response = await fetchServer(
    `/v1/channel/${encodeChannelIdentifier(identifier)}`,
    {
      cache: "no-store",
    }
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    await throwApiResponseError(response, "채널 정보를 불러오지 못했습니다");
  }

  return (await response.json()) as Channel;
}

/**
 * GET /channel/list/famous - 인기 채널 목록 조회 (비인증)
 */
export async function getFamousChannelsServer(
  query?: GetFamousChannelsRequestQuery
): Promise<GetFamousChannelsResponse> {
  const params = query?.limit ? { limit: String(query.limit) } : undefined;

  try {
    const data = await fetchServerJson<GetFamousChannelsResponse>(
      "/v1/channel/list/famous",
      {
        // 인기 채널은 유저별로 완전히 달라지지 않는 비개인화 데이터이므로
        // 서버 Data Cache에 5분간 캐싱하고, 이후에는 백그라운드에서 재검증합니다.
        cache: "force-cache",
        next: {
          revalidate: 300,
        },
        queryParams: params,
      },
      "Failed to fetch famous channels"
    );

    // 데이터 검증 및 정규화
    if (!Array.isArray(data)) {
      return [];
    }

    // 각 채널의 숫자 필드를 정규화 (문자열을 숫자로 변환, null은 유지, undefined는 null로)
    return data.map((channel) => ({
      ...channel,
      songsCount: normalizeNullableNumber(
        channel.songsCount ?? channel._count?.songs
      ),
      favoritesCount: normalizeNullableNumber(channel.favoritesCount),
      songLikesCount: normalizeNullableNumber(channel.songLikesCount),
      popularityScore: normalizeNullableNumber(channel.popularityScore),
      // PRO 구독자 필드 명시적으로 포함
      isOwnerProSubscriber: channel.isOwnerProSubscriber ?? false,
      // 앰배서더 필드 명시적으로 포함
      isOwnerAmbassador: channel.isOwnerAmbassador ?? false,
    }));
  } catch (error) {
    console.error("Failed to fetch famous channels:", error);
    return [];
  }
}

/**
 * GET /channel/list/recent - 최근 채널 목록 조회 (비인증)
 */
export async function getRecentChannelsServer(
  query?: GetRecentChannelsRequestQuery
): Promise<GetRecentChannelsResponse> {
  const params = query?.limit ? { limit: String(query.limit) } : undefined;

  return fetchServerJson<GetRecentChannelsResponse>(
    "/v1/channel/list/recent",
    {
      cache: "force-cache",
      queryParams: params,
    },
    "Failed to fetch recent channels"
  );
}

/**
 * GET /channel/list/all - 전체 채널 목록 조회 (비인증)
 */
export async function getAllChannelsServer(): Promise<GetAllChannelsResponse> {
  return fetchServerJson<GetAllChannelsResponse>(
    "/v1/channel/list/all",
    {
      cache: "force-cache",
    },
    "Failed to fetch all channels"
  );
}

/**
 * GET /channel/{identifier}/permission - 채널 권한 조회 (인증 필요)
 * 서버 컴포넌트에서 사용하며, 쿠키를 자동으로 전달합니다.
 *
 * 401/403(미인증·권한 없음) → `null`. 404 → `null` (채널 없음). 그 외 비 2xx → throw.
 */
export async function getChannelIdentifierPermissionServer(
  identifier: string
): Promise<GetChannelIdentifierPermissionResponse | null> {
  const response = await fetchServerWithAuth(
    `/v1/channel/${encodeChannelIdentifier(identifier)}/permission`,
    { cache: "no-store" }
  );

  // fetchServerWithAuth 가 401/403 을 null 로 변환
  if (response === null) return null;

  if (response.status === 404) return null;

  if (!response.ok) {
    await throwApiResponseError(
      response,
      "채널 권한 정보를 불러오지 못했습니다"
    );
  }

  return (await response.json()) as GetChannelIdentifierPermissionResponse;
}

/**
 * GET /channel/{identifier}/guestbook-settings - 채널 방명록 설정 조회 (비인증)
 *
 * 진짜 404 → 기본값(`guestbookEnabled: true`). 그 외 비 2xx → throw.
 * 채널 자체가 없는 케이스는 layout 의 `getChannelIdentifierServer` 가 먼저 잡으므로
 * 여기서는 fail-open 이 안전.
 */
export async function getChannelGuestbookSettingsServer(
  identifier: string
): Promise<{ guestbookEnabled: boolean }> {
  const response = await fetchServer(
    `/v1/channel/${encodeChannelIdentifier(identifier)}/guestbook-settings`,
    { cache: "no-store" }
  );

  if (response.status === 404) {
    return { guestbookEnabled: true };
  }

  if (!response.ok) {
    await throwApiResponseError(
      response,
      "방명록 설정을 불러오지 못했습니다"
    );
  }

  return (await response.json()) as { guestbookEnabled: boolean };
}

/**
 * GET /channel/{identifier}/feature-settings - 채널 공개 메뉴 설정 조회 (비인증)
 *
 * 설정 API가 없거나 채널이 없는 404는 기본 탭 구성으로 fail-open.
 * 채널 없음은 보통 layout 의 `getChannelIdentifierServer` 가 먼저 처리한다.
 */
export async function getChannelFeatureSettingsServer(
  identifier: string
): Promise<ChannelFeatureSettings> {
  const response = await fetchServer(
    `/v1/channel/${encodeChannelIdentifier(identifier)}/feature-settings`,
    { cache: "no-store" }
  );

  if (response.status === 404) {
    return DEFAULT_CHANNEL_FEATURE_SETTINGS;
  }

  if (!response.ok) {
    await throwApiResponseError(
      response,
      "채널 기능 설정을 불러오지 못했습니다"
    );
  }

  return (await response.json()) as ChannelFeatureSettings;
}
