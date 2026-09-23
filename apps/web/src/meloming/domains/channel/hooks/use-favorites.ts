import {
  useMutation,
  useQuery,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";
import type {
  UseMutationResult,
  UseQueryResult,
  UseInfiniteQueryResult,
  InfiniteData,
} from "@tanstack/react-query";
import {
  deleteFavoriteChannel,
  deleteFavoriteSong,
  getChannelFavoritesCount,
  getChannelFavoriteUsers,
  getFavoriteChannelStatus,
  getFavoriteChannels,
  getFavoriteSongStatus,
  getFavoriteSongs,
  getFavoritesStats,
  getSongFavoritesCount,
  putFavoriteChannelToggle,
  putFavoriteSongToggle,
  getFavoriteChannelAnniversaries,
  patchReorderFavoriteChannels,
} from "@/meloming/domains/channel/apis/favorites";
import type {
  ChannelFavoritesCountResponse,
  FavoriteStatusResponse,
  FavoritesStatsResponse,
  GetFavoritesChannelsResponse,
  GetFavoritesSongsResponse,
  GetFavoritesChannelUsersResponse,
  SongFavoritesCountResponse,
  FavoriteToggleResponse,
  GetFavoriteChannelAnniversariesResponse,
} from "@/meloming/domains/channel/types/favorite";

// Query keys
export const favoritesKeys = {
  all: ["favorites"] as const,
  channels: () => [...favoritesKeys.all, "channels"] as const,
  songs: () => [...favoritesKeys.all, "songs"] as const,
  channelsList: (params: { page?: number; limit?: number } = {}) =>
    [...favoritesKeys.channels(), "list", params] as const,
  songsList: (params: { page?: number; limit?: number } = {}) =>
    [...favoritesKeys.songs(), "list", params] as const,
  channelStatus: (channelId: number) =>
    [...favoritesKeys.channels(), "status", channelId] as const,
  songStatus: (songId: number) =>
    [...favoritesKeys.songs(), "status", songId] as const,
  stats: () => [...favoritesKeys.all, "stats"] as const,
  songCount: (songId: number) =>
    [...favoritesKeys.songs(), "count", songId] as const,
  channelCount: (channelId: number) =>
    [...favoritesKeys.channels(), "count", channelId] as const,
  channelUsers: (
    channelId: number,
    params: { page?: number; limit?: number } = {}
  ) => [...favoritesKeys.channels(), channelId, "users", params] as const,
  channelAnniversaries: () =>
    [...favoritesKeys.channels(), "anniversaries"] as const,
} as const;

export function useFavoriteChannels(
  params: { page?: number; limit?: number } = {},
  options?: { enabled?: boolean; staleTime?: number; cacheTime?: number }
): UseQueryResult<GetFavoritesChannelsResponse, Error> {
  return useQuery({
    queryKey: favoritesKeys.channelsList(params),
    queryFn: () => getFavoriteChannels(params),
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.cacheTime ?? 10 * 60 * 1000,
  });
}

export function useFavoriteSongs(
  params: { page?: number; limit?: number } = {},
  options?: { enabled?: boolean; staleTime?: number; cacheTime?: number }
): UseQueryResult<GetFavoritesSongsResponse, Error> {
  return useQuery({
    queryKey: favoritesKeys.songsList(params),
    queryFn: () => getFavoriteSongs(params),
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.cacheTime ?? 10 * 60 * 1000,
  });
}

// Infinite queries for pagination
export function useInfiniteFavoriteChannels(
  params: { limit?: number } = {},
  options?: {
    enabled?: boolean;
    staleTime?: number;
    cacheTime?: number;
    initialData?: InfiniteData<GetFavoritesChannelsResponse>;
  }
): UseInfiniteQueryResult<GetFavoritesChannelsResponse, Error> {
  const hasInitialData = !!options?.initialData;
  
  return useInfiniteQuery({
    queryKey: [...favoritesKeys.channels(), "infinite", params] as const,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      getFavoriteChannels({ page: pageParam as number, limit: params.limit }),
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
    enabled: options?.enabled ?? true,
    // initialData가 있으면 매우 긴 staleTime을 설정하여 데이터가 stale하지 않다고 간주
    staleTime: hasInitialData ? Infinity : (options?.staleTime ?? 5 * 60 * 1000),
    gcTime: options?.cacheTime ?? 10 * 60 * 1000,
    initialData: options?.initialData,
    // initialData가 있으면 모든 자동 refetch를 방지하여 hydration 에러 방지
    refetchOnMount: hasInitialData ? false : undefined,
    refetchOnWindowFocus: hasInitialData ? false : undefined,
    refetchOnReconnect: hasInitialData ? false : undefined,
  });
}

export function useInfiniteFavoriteSongs(
  params: { limit?: number } = {},
  options?: {
    enabled?: boolean;
    staleTime?: number;
    cacheTime?: number;
    initialData?: InfiniteData<GetFavoritesSongsResponse>;
  }
): UseInfiniteQueryResult<GetFavoritesSongsResponse, Error> {
  const hasInitialData = !!options?.initialData;
  
  return useInfiniteQuery({
    queryKey: [...favoritesKeys.songs(), "infinite", params] as const,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      getFavoriteSongs({ page: pageParam as number, limit: params.limit }),
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
    enabled: options?.enabled ?? true,
    // initialData가 있으면 매우 긴 staleTime을 설정하여 데이터가 stale하지 않다고 간주
    staleTime: hasInitialData ? Infinity : (options?.staleTime ?? 5 * 60 * 1000),
    gcTime: options?.cacheTime ?? 10 * 60 * 1000,
    initialData: options?.initialData,
    // initialData가 있으면 모든 자동 refetch를 방지하여 hydration 에러 방지
    refetchOnMount: hasInitialData ? false : undefined,
    refetchOnWindowFocus: hasInitialData ? false : undefined,
    refetchOnReconnect: hasInitialData ? false : undefined,
  });
}

export function useFavoriteChannelStatus(
  channelId: number | undefined,
  options?: { enabled?: boolean; staleTime?: number; cacheTime?: number }
): UseQueryResult<FavoriteStatusResponse, Error> {
  return useQuery({
    queryKey:
      typeof channelId === "number"
        ? favoritesKeys.channelStatus(channelId)
        : [],
    queryFn: () => getFavoriteChannelStatus(channelId as number),
    enabled: typeof channelId === "number" && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.cacheTime ?? 10 * 60 * 1000,
  });
}

export function useFavoriteSongStatus(
  songId: number | undefined,
  options?: { enabled?: boolean; staleTime?: number; cacheTime?: number }
): UseQueryResult<FavoriteStatusResponse, Error> {
  return useQuery({
    queryKey:
      typeof songId === "number" ? favoritesKeys.songStatus(songId) : [],
    queryFn: () => getFavoriteSongStatus(songId as number),
    enabled: typeof songId === "number" && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.cacheTime ?? 10 * 60 * 1000,
  });
}

export function useFavoritesStats(options?: {
  enabled?: boolean;
  staleTime?: number;
  cacheTime?: number;
}): UseQueryResult<FavoritesStatsResponse, Error> {
  return useQuery({
    queryKey: favoritesKeys.stats(),
    queryFn: () => getFavoritesStats(),
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.cacheTime ?? 10 * 60 * 1000,
  });
}

export function useSongFavoritesCount(
  songId: number | undefined,
  options?: { enabled?: boolean; staleTime?: number; cacheTime?: number }
): UseQueryResult<SongFavoritesCountResponse, Error> {
  return useQuery({
    queryKey: typeof songId === "number" ? favoritesKeys.songCount(songId) : [],
    queryFn: () => getSongFavoritesCount(songId as number),
    enabled: typeof songId === "number" && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 60 * 1000,
    gcTime: options?.cacheTime ?? 5 * 60 * 1000,
  });
}

export function useChannelFavoritesCount(
  channelId: number | undefined,
  options?: { enabled?: boolean; staleTime?: number; cacheTime?: number }
): UseQueryResult<ChannelFavoritesCountResponse, Error> {
  return useQuery({
    queryKey:
      typeof channelId === "number"
        ? favoritesKeys.channelCount(channelId)
        : [],
    queryFn: () => getChannelFavoritesCount(channelId as number),
    enabled: typeof channelId === "number" && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 60 * 1000,
    gcTime: options?.cacheTime ?? 5 * 60 * 1000,
  });
}

export function useChannelFavoriteUsers(
  channelId: number | undefined,
  params: { page?: number; limit?: number } = {},
  options?: { enabled?: boolean; staleTime?: number; cacheTime?: number }
): UseQueryResult<GetFavoritesChannelUsersResponse, Error> {
  return useQuery({
    queryKey:
      typeof channelId === "number"
        ? favoritesKeys.channelUsers(channelId, params)
        : [],
    queryFn: () => getChannelFavoriteUsers(channelId as number, params),
    enabled: typeof channelId === "number" && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 60 * 1000,
    gcTime: options?.cacheTime ?? 5 * 60 * 1000,
  });
}

export function useToggleFavoriteChannel(): UseMutationResult<
  FavoriteToggleResponse,
  Error,
  { channelId: number }
> {
  return useMutation({
    mutationFn: ({ channelId }) => putFavoriteChannelToggle(channelId),
  });
}

export function useUnfavoriteChannel(): UseMutationResult<
  FavoriteToggleResponse,
  Error,
  { channelId: number }
> {
  return useMutation({
    mutationFn: ({ channelId }) => deleteFavoriteChannel(channelId),
  });
}

export function useToggleFavoriteSong(): UseMutationResult<
  FavoriteToggleResponse,
  Error,
  { songId: number }
> {
  return useMutation({
    mutationFn: ({ songId }) => putFavoriteSongToggle(songId),
  });
}

export function useUnfavoriteSong(): UseMutationResult<
  FavoriteToggleResponse,
  Error,
  { songId: number }
> {
  return useMutation({
    mutationFn: ({ songId }) => deleteFavoriteSong(songId),
  });
}

/**
 * 즐겨찾기 채널 기념일 목록을 가져오는 훅
 */
export function useFavoriteChannelAnniversaries(options?: {
  enabled?: boolean;
  staleTime?: number;
  cacheTime?: number;
}): UseQueryResult<GetFavoriteChannelAnniversariesResponse, Error> {
  return useQuery({
    queryKey: favoritesKeys.channelAnniversaries(),
    queryFn: () => getFavoriteChannelAnniversaries(),
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.cacheTime ?? 10 * 60 * 1000,
  });
}

export function useReorderFavoriteChannels() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (channelIds: number[]) =>
      patchReorderFavoriteChannels(channelIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: favoritesKeys.channels() });
    },
  });
}
