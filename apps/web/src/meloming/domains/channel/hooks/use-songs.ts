import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import type {
  UseQueryResult,
  UseInfiniteQueryResult,
} from "@tanstack/react-query";
import {
  getSongsAlbumArtSearch,
  getSongsChannelIdentifier,
  getSongsChannelIdentifierSongId,
  postSpotifySearch,
  getSongsChannelIdentifierRandom,
  postImageSearch,
  postSerperSearchVideo,
  postConsoleSerperSearchVideo,
  postSerperSearchWeb,
  getSongsFavoritesByChannelId,
  getSongTitleAutocomplete,
  getSongArtistSuggestions,
} from "@/meloming/domains/channel/apis/songs";
import { useChannelPermission } from "@/meloming/domains/channel/hooks/use-channel";
import type {
  Song,
  GetSongsChannelIdentifierResponse,
  GetSongsAlbumArtSearchResponse,
  SongAutocompleteResponse,
  SongArtistSuggestResponse,
} from "@/meloming/domains/channel/types/song";
import type {
  SpotifySearchRequest,
  SpotifySearchResponse,
} from "@/meloming/domains/channel/types/spotify";
import type {
  SerperVideoSearchRequest,
  SerperVideoSearchResponse,
  SerperWebSearchRequest,
  SerperWebSearchResponse,
} from "@/meloming/domains/channel/types/serper";
import type {
  ImageSearchRequest,
  ImageSearchResponse,
} from "@/meloming/domains/channel/types/image-search";

/**
 * Round 4 M3 (Codex security review):
 *
 * 백엔드가 role-suffixed cache 로 매니저/viewer 응답을 분리한다
 * (manager 는 draft/hidden 포함, viewer 는 public only). 프론트 TanStack Query
 * 는 key 에 role 이 없으면 같은 브라우저에서 권한 변경(예: 매니저 해제) 시 stale
 * manager 응답을 viewer 가 그대로 보게 된다 — 보안/정확성 문제.
 *
 * 해결: songsKeys 중 role-dependent 인 것들은 role 세그먼트를 key 에 포함.
 *
 * 설계:
 * - `publicUser(username)` 같은 invalidation prefix 함수는 role 없이 유지 —
 *   기존 invalidateQueries({ queryKey: songsKeys.publicUser(user) }) 가 모든 role
 *   bucket 을 prefix-match 로 함께 무효화할 수 있도록.
 * - hook 내부에서 사용하는 실제 query key (`publicUserByRole` 등) 에만 role
 *   세그먼트 추가.
 * - role 은 `useChannelSongsRole(identifier)` 가 `useChannelPermission` 에서
 *   자동 resolve. 권한 로딩 중이면 'unknown' 으로 처리 — 해당 key 로 캐시되므로
 *   권한 resolve 후 'manager' / 'viewer' key 로 자동 re-fetch.
 */
export type SongsCacheRole = "manager" | "viewer" | "unknown";

/**
 * useChannelPermission 결과로부터 songs 캐시의 role segment 를 결정한다.
 * 백엔드가 manager 응답을 돌려주는 조건은 `manageContent` (draft/hidden 접근
 * 권한) 과 동일하므로 여기서 그 값을 사용한다.
 */
export function useChannelSongsRole(
  identifier: string | undefined
): SongsCacheRole {
  const { data, isLoading } = useChannelPermission(identifier ?? "", {
    enabled: !!identifier,
  });
  if (!identifier) return "viewer"; // no channel context → viewer-ish
  if (isLoading || !data) return "unknown";
  return data.manageContent ? "manager" : "viewer";
}

// Query keys
export const songsKeys = {
  all: ["songs"] as const,
  // invalidation prefix (role 없음): role 분기된 모든 캐시를 함께 무효화할 수 있음
  publicUser: (username: string) =>
    [...songsKeys.all, "public", username] as const,
  // 실제 query key (role 포함): 매니저/viewer/unknown 별 독립 캐시
  publicUserByRole: (username: string, role: SongsCacheRole) =>
    [...songsKeys.all, "public", username, role] as const,
  publicUserWithParams: (
    username: string,
    role: SongsCacheRole,
    params: {
      page?: number;
      limit?: number;
      sortBy?: "newest" | "oldest" | "title" | "artist" | "likes_desc";
      categoryId?: string;
      artistId?: string;
      categoryIds?: string;
      artistIds?: string;
      difficulties?: string;
      proficiencies?: string;
      search?: string;
      difficulty?: number;
      proficiency?: number;
    }
  ) => [...songsKeys.publicUserByRole(username, role), params] as const,
  public: () => [...songsKeys.all, "public"] as const,
  publicWithParams: (params: {
    page?: number;
    limit?: number;
    sortBy?: "newest" | "oldest" | "title" | "artist" | "likes_desc";
    categoryId?: string;
    artistId?: string;
    categoryIds?: string;
    artistIds?: string;
    difficulties?: string;
    proficiencies?: string;
    search?: string;
    difficulty?: number;
    proficiency?: number;
  }) => [...songsKeys.public(), params] as const,
  infinitePublicUser: (
    username: string,
    role: SongsCacheRole,
    params: Omit<
      {
        page?: number;
        limit?: number;
        sortBy?: "newest" | "oldest" | "title" | "artist" | "likes_desc";
        categoryId?: string;
        artistId?: string;
        categoryIds?: string;
        artistIds?: string;
        difficulties?: string;
        proficiencies?: string;
        search?: string;
        difficulty?: number;
        proficiency?: number;
      },
      "page"
    >
  ) =>
    [...songsKeys.publicUserByRole(username, role), "infinite", params] as const,
  // invalidation prefix (role 없음): 모든 role bucket 을 함께 무효화
  detail: (identifier: string, songId: number) =>
    [...songsKeys.all, "detail", identifier, songId] as const,
  // 실제 query key (role 포함)
  detailByRole: (identifier: string, songId: number, role: SongsCacheRole) =>
    [...songsKeys.all, "detail", identifier, songId, role] as const,
  albumArtSearch: (keyword: string) =>
    [...songsKeys.all, "albumArtSearch", keyword] as const,
  spotifySearch: (body: SpotifySearchRequest) =>
    [...songsKeys.all, "spotifySearch", body.title, body.artist] as const,
  imageSearch: (body: ImageSearchRequest) =>
    [...songsKeys.all, "imageSearch", body.title, body.artist] as const,
  serperVideoSearch: (body: SerperVideoSearchRequest) =>
    [
      ...songsKeys.all,
      "serperVideoSearch",
      body.query,
      body.num ?? 20,
    ] as const,
  consoleSerperVideoSearch: (body: SerperVideoSearchRequest) =>
    [
      ...songsKeys.all,
      "consoleSerperVideoSearch",
      body.query,
      body.num ?? 20,
    ] as const,
  serperWebSearch: (body: SerperWebSearchRequest) =>
    [
      ...songsKeys.all,
      "serperWebSearch",
      body.query,
      body.num ?? 20,
    ] as const,
  autocomplete: (
    identifier: string,
    scope: string,
    query: string,
    limit: number
  ) => [...songsKeys.all, "autocomplete", identifier, scope, query, limit] as const,
  artistSuggest: (
    identifier: string,
    scope: string,
    title: string,
    limit: number
  ) => [...songsKeys.all, "artistSuggest", identifier, scope, title, limit] as const,
  randomByPublicUser: (
    username: string,
    role: SongsCacheRole,
    count: number,
    categoryIdsKey: string
  ) =>
    [
      ...songsKeys.publicUserByRole(username, role),
      "random",
      count,
      categoryIdsKey,
    ] as const,
  favoritesByChannelId: (channelId: number) =>
    [...songsKeys.all, "favorites", "channelId", channelId] as const,
  infiniteFavoritesByChannelId: (
    channelId: number,
    params: Omit<
      {
        page?: number;
        limit?: number;
        sortBy?: "newest" | "oldest" | "title" | "artist" | "likes_desc";
      },
      "page"
    >
  ) =>
    [...songsKeys.favoritesByChannelId(channelId), "infinite", params] as const,
};

function normalizeCategoryIds(
  categoryIds: readonly number[] | undefined
): number[] {
  if (!categoryIds || categoryIds.length === 0) {
    return [];
  }

  const unique = new Set<number>();
  for (const id of categoryIds) {
    if (Number.isInteger(id) && id > 0) {
      unique.add(id);
    }
  }

  return Array.from(unique).sort((a, b) => a - b);
}

function toCategoryIdsQueryValue(
  categoryIds: readonly number[] | undefined
): string | undefined {
  const normalized = normalizeCategoryIds(categoryIds);
  if (normalized.length === 0) {
    return undefined;
  }
  return normalized.join(",");
}

/**
 * 특정 사용자의 공개 노래 목록을 가져오는 훅
 * @param username - 사용자 이름
 * @param params - 검색 및 페이지네이션 파라미터
 * @param options - useQuery 옵션
 */
export function usePublicUserSongs(
  username: string,
  params: {
    page?: number;
    limit?: number;
    sortBy?: "newest" | "oldest" | "title" | "artist" | "likes_desc";
    categoryId?: string;
    artistId?: string;
    categoryIds?: string;
    artistIds?: string;
    difficulties?: string;
    proficiencies?: string;
    search?: string;
    difficulty?: number;
    proficiency?: number;
  } = {},
  options?: {
    enabled?: boolean;
    staleTime?: number;
    cacheTime?: number;
  }
): UseQueryResult<GetSongsChannelIdentifierResponse, Error> {
  const role = useChannelSongsRole(username || undefined);
  return useQuery({
    queryKey: songsKeys.publicUserWithParams(username, role, params),
    queryFn: () => getSongsChannelIdentifier(username, params),
    enabled: !!username && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // 5분
    gcTime: options?.cacheTime ?? 10 * 60 * 1000, // 10분 (구 cacheTime)
  });
}

/**
 * 특정 사용자의 공개 노래 목록을 무한스크롤로 가져오는 훅
 * @param username - 사용자 이름
 * @param params - 검색 파라미터 (page 제외)
 * @param options - useInfiniteQuery 옵션
 */
export function useInfinitePublicUserSongs(
  username: string,
  params: Omit<
    {
      page?: number;
      limit?: number;
      sortBy?: "newest" | "oldest" | "title" | "artist" | "likes_desc";
      categoryId?: string;
      artistId?: string;
      categoryIds?: string;
      artistIds?: string;
      difficulties?: string;
      proficiencies?: string;
      search?: string;
      difficulty?: number;
      proficiency?: number;
    },
    "page"
  > = {},
  options?: {
    enabled?: boolean;
    staleTime?: number;
    cacheTime?: number;
  }
): UseInfiniteQueryResult<GetSongsChannelIdentifierResponse, Error> {
  const role = useChannelSongsRole(username || undefined);
  return useInfiniteQuery({
    queryKey: songsKeys.infinitePublicUser(username, role, params),
    queryFn: ({ pageParam = 1 }) =>
      getSongsChannelIdentifier(username, {
        ...params,
        page: pageParam as number,
      }),
    enabled: !!username && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // 5분
    gcTime: options?.cacheTime ?? 10 * 60 * 1000, // 10분
    getNextPageParam: (lastPage) => {
      if (lastPage.page < lastPage.total / lastPage.limit) {
        return (lastPage.page as number) + 1;
      }
      return undefined; // 더 이상 페이지가 없음
    },
    initialPageParam: 1,
  });
}

/**
 * 모든 공개 노래 목록을 가져오는 훅
 * @param params - 검색 및 페이지네이션 파라미터
 * @param options - useQuery 옵션
 */
// 공개 전체 노래 목록 훅: 실제 API가 확정되면 추가하세요

/**
 * 채널 식별자와 곡 ID로 곡 상세 정보를 가져오는 훅
 */
export function useSongByChannelIdentifierSongId(
  identifier: string | undefined,
  songId: number | undefined,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    cacheTime?: number;
  }
): UseQueryResult<Song, Error> {
  const role = useChannelSongsRole(identifier);
  return useQuery({
    queryKey:
      identifier && songId
        ? songsKeys.detailByRole(identifier, songId, role)
        : [],
    queryFn: () =>
      getSongsChannelIdentifierSongId(identifier as string, songId as number),
    enabled: Boolean(identifier && songId) && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.cacheTime ?? 10 * 60 * 1000,
  });
}

/**
 * 앨범 아트 검색 훅
 */
export function useAlbumArtSearch(
  keyword: string,
  options?: { enabled?: boolean; staleTime?: number; cacheTime?: number }
): import("@tanstack/react-query").UseQueryResult<
  GetSongsAlbumArtSearchResponse,
  Error
> {
  return useQuery({
    queryKey: songsKeys.albumArtSearch(keyword),
    queryFn: () => getSongsAlbumArtSearch(keyword),
    enabled: Boolean(keyword) && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 60 * 1000,
    gcTime: options?.cacheTime ?? 5 * 60 * 1000,
  });
}

/**
 * Spotify 검색 훅
 * - 제목/가수 입력 후 트리거
 */
export function useSpotifySearch(
  body: SpotifySearchRequest | undefined,
  options?: { enabled?: boolean; staleTime?: number; cacheTime?: number }
): import("@tanstack/react-query").UseQueryResult<
  SpotifySearchResponse,
  Error
> {
  return useQuery({
    queryKey: body ? songsKeys.spotifySearch(body) : [],
    queryFn: () => {
      if (!body) {
        return Promise.reject(new Error("Spotify search body is undefined"));
      }
      return postSpotifySearch(body);
    },
    enabled:
      Boolean(body && body.title.trim() && body.artist.trim()) &&
      (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 60 * 1000,
    gcTime: options?.cacheTime ?? 5 * 60 * 1000,
  });
}

/**
 * DuckDuckGo/SearXNG 연관 이미지 검색 훅
 */
export function useImageSearch(
  body: ImageSearchRequest | undefined,
  options?: { enabled?: boolean; staleTime?: number; cacheTime?: number }
): import("@tanstack/react-query").UseQueryResult<ImageSearchResponse, Error> {
  return useQuery({
    queryKey: body ? songsKeys.imageSearch(body) : [],
    queryFn: () => {
      if (!body) {
        return Promise.reject(new Error("Image search body is undefined"));
      }
      return postImageSearch(body);
    },
    enabled:
      Boolean(body && body.title.trim() && body.artist.trim()) &&
      (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 60 * 1000,
    gcTime: options?.cacheTime ?? 5 * 60 * 1000,
  });
}

/**
 * Serper YouTube 영상 검색 훅
 * - query가 비어있으면 자동으로 비활성화
 * - 14일 서버 캐시 + React Query 5분 staleTime
 */
export function useSerperSearchVideo(
  body: SerperVideoSearchRequest | undefined,
  options?: { enabled?: boolean; staleTime?: number; cacheTime?: number }
): import("@tanstack/react-query").UseQueryResult<
  SerperVideoSearchResponse,
  Error
> {
  return useQuery({
    queryKey: body ? songsKeys.serperVideoSearch(body) : [],
    queryFn: () => {
      if (!body) {
        return Promise.reject(
          new Error("Serper video search body is undefined")
        );
      }
      return postSerperSearchVideo(body);
    },
    enabled:
      Boolean(body && body.query.trim()) && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.cacheTime ?? 30 * 60 * 1000,
  });
}

/**
 * 콘솔 경로(리모콘) YouTube 영상 검색 훅.
 *
 * 관리 콘솔(JWT)·팝업 콘솔(토큰) 양쪽에서 사용. 백엔드가 num 상한을 20 으로
 * 강제하므로 과도한 num 요청을 보내도 서버가 자동으로 clamp 한다.
 */
export function useConsoleSerperSearchVideo(
  body: SerperVideoSearchRequest | undefined,
  options?: { enabled?: boolean; staleTime?: number; cacheTime?: number }
): import("@tanstack/react-query").UseQueryResult<
  SerperVideoSearchResponse,
  Error
> {
  return useQuery({
    queryKey: body ? songsKeys.consoleSerperVideoSearch(body) : [],
    queryFn: () => {
      if (!body) {
        return Promise.reject(
          new Error("Console Serper video search body is undefined")
        );
      }
      return postConsoleSerperSearchVideo(body);
    },
    enabled:
      Boolean(body && body.query.trim()) && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.cacheTime ?? 30 * 60 * 1000,
  });
}

/**
 * Serper 일반 웹 검색 훅 (가사 링크 등 텍스트 검색 용)
 */
export function useSerperSearchWeb(
  body: SerperWebSearchRequest | undefined,
  options?: { enabled?: boolean; staleTime?: number; cacheTime?: number }
): import("@tanstack/react-query").UseQueryResult<
  SerperWebSearchResponse,
  Error
> {
  return useQuery({
    queryKey: body ? songsKeys.serperWebSearch(body) : [],
    queryFn: () => {
      if (!body) {
        return Promise.reject(
          new Error("Serper web search body is undefined")
        );
      }
      return postSerperSearchWeb(body);
    },
    enabled:
      Boolean(body && body.query.trim()) && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.cacheTime ?? 30 * 60 * 1000,
  });
}

/**
 * 노래 제목 자동완성 훅
 */
export function useSongTitleAutocomplete(
  identifier: string,
  params: { query?: string; limit?: number; scope?: "channel" | "global" } = {},
  options?: { enabled?: boolean; staleTime?: number; cacheTime?: number }
): import("@tanstack/react-query").UseQueryResult<
  SongAutocompleteResponse,
  Error
> {
  const query = (params.query ?? "").trim();
  const limit = params.limit ?? 8;
  const scope = params.scope ?? "channel";
  return useQuery({
    queryKey: songsKeys.autocomplete(identifier, scope, query, limit),
    queryFn: () => getSongTitleAutocomplete(identifier, { query, limit, scope }),
    enabled: !!identifier && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 30 * 1000,
    gcTime: options?.cacheTime ?? 5 * 60 * 1000,
  });
}

/**
 * 노래 제목 기반 아티스트 추천 훅
 */
export function useSongArtistSuggestions(
  identifier: string,
  params: {
    title?: string;
    limit?: number;
    scope?: "channel" | "global";
  } = {},
  options?: { enabled?: boolean; staleTime?: number; cacheTime?: number }
): import("@tanstack/react-query").UseQueryResult<
  SongArtistSuggestResponse,
  Error
> {
  const title = (params.title ?? "").trim();
  const limit = params.limit ?? 5;
  const scope = params.scope ?? "channel";
  return useQuery({
    queryKey: songsKeys.artistSuggest(identifier, scope, title, limit),
    queryFn: () => getSongArtistSuggestions(identifier, title, limit, scope),
    enabled:
      !!identifier && title.length > 0 && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 60 * 1000,
    gcTime: options?.cacheTime ?? 5 * 60 * 1000,
  });
}

export function useRandomPublicUserSongs(
  username: string,
  params: { count?: number; categoryIds?: readonly number[] } = {},
  options?: { enabled?: boolean; staleTime?: number; cacheTime?: number }
): UseQueryResult<GetSongsChannelIdentifierResponse, Error> {
  const { count = 5, categoryIds } = params;
  const categoryIdsQuery = toCategoryIdsQueryValue(categoryIds);
  const categoryIdsKey = categoryIdsQuery ?? "all";
  const role = useChannelSongsRole(username || undefined);

  return useQuery({
    queryKey: songsKeys.randomByPublicUser(
      username,
      role,
      count,
      categoryIdsKey
    ),
    queryFn: () =>
      getSongsChannelIdentifierRandom(username, {
        count,
        categoryIds: categoryIdsQuery,
      }),
    enabled: !!username && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 60 * 1000,
    gcTime: options?.cacheTime ?? 5 * 60 * 1000,
  });
}

/**
 * 특정 채널에서 내가 즐겨찾기한 노래 목록을 무한스크롤로 가져오는 훅
 * @param channelId - 채널 ID (숫자)
 * @param params - 검색 파라미터 (page 제외)
 * @param options - useInfiniteQuery 옵션
 */
export function useInfiniteFavoriteUserSongs(
  channelId: number | undefined,
  params: Omit<
    {
      page?: number;
      limit?: number;
      sortBy?: "newest" | "oldest" | "title" | "artist" | "likes_desc";
    },
    "page"
  > = {},
  options?: {
    enabled?: boolean;
    staleTime?: number;
    cacheTime?: number;
  }
): UseInfiniteQueryResult<GetSongsChannelIdentifierResponse, Error> {
  return useInfiniteQuery({
    queryKey:
      channelId !== undefined
        ? songsKeys.infiniteFavoritesByChannelId(channelId, params)
        : [],
    queryFn: ({ pageParam = 1 }) =>
      getSongsFavoritesByChannelId(channelId as number, {
        ...params,
        page: pageParam as number,
      }),
    enabled:
      channelId !== undefined &&
      !isNaN(channelId) &&
      (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // 5분
    gcTime: options?.cacheTime ?? 10 * 60 * 1000, // 10분
    getNextPageParam: (lastPage) => {
      if (lastPage.page < lastPage.total / lastPage.limit) {
        return (lastPage.page as number) + 1;
      }
      return undefined; // 더 이상 페이지가 없음
    },
    initialPageParam: 1,
  });
}
