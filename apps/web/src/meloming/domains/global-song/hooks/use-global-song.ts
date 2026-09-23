import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import {
  getGlobalSongClips,
  getGlobalSongDetail,
  getGlobalSongMyRegistrations,
  getGlobalSongsByArtist,
  getMyRegisteredGlobalSongIds,
} from "@/meloming/domains/global-song/apis/global-song";
import type {
  GlobalSongByArtistResponse,
  GlobalSongClipResponse,
  GlobalSongClipSort,
  GlobalSongDetailResponse,
  GlobalSongMyRegistrationsResponse,
} from "@/meloming/domains/global-song/types/global-song";

export const globalSongKeys = {
  all: ["global-song"] as const,
  detail: (id: number) => [...globalSongKeys.all, "detail", id] as const,
  clips: (id: number, sort: GlobalSongClipSort) =>
    [...globalSongKeys.all, "clips", id, sort] as const,
  byArtist: (id: number, limit: number) =>
    [...globalSongKeys.all, "by-artist", id, limit] as const,
  myRegistrations: (id: number) =>
    [...globalSongKeys.all, "my-registrations", id] as const,
  myRegisteredIds: () =>
    [...globalSongKeys.all, "my-registered-ids"] as const,
} as const;

const DEFAULT_CLIP_LIMIT = 20;

/**
 * GlobalSong detail + channel list.
 *
 * Accepts optional `initialData` so the server component can hydrate the
 * query cache without triggering a client-side refetch on first render.
 */
export function useGlobalSongDetail(
  id: number,
  options?: {
    enabled?: boolean;
    initialData?: GlobalSongDetailResponse;
    staleTime?: number;
  },
) {
  return useQuery<GlobalSongDetailResponse, Error>({
    queryKey: globalSongKeys.detail(id),
    queryFn: () => getGlobalSongDetail(id),
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    initialData: options?.initialData,
  });
}

/**
 * Infinite clip feed for a global song.
 *
 * - Sort changes produce a new `queryKey` so React Query starts fresh
 *   (no cursor leakage between `popular` and `recent`).
 * - The first page can be seeded via `initialData` when coming from SSR.
 */
export function useGlobalSongClips(
  id: number,
  sort: GlobalSongClipSort,
  options?: {
    enabled?: boolean;
    limit?: number;
    initialData?: GlobalSongClipResponse;
  },
) {
  const limit = options?.limit ?? DEFAULT_CLIP_LIMIT;

  return useInfiniteQuery<
    GlobalSongClipResponse,
    Error,
    InfiniteData<GlobalSongClipResponse, string | undefined>,
    ReturnType<typeof globalSongKeys.clips>,
    string | undefined
  >({
    queryKey: globalSongKeys.clips(id, sort),
    queryFn: ({ pageParam }) =>
      getGlobalSongClips(id, {
        sort,
        cursor: pageParam,
        limit,
      }),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
    initialData: options?.initialData
      ? {
          pages: [options.initialData],
          pageParams: [undefined],
        }
      : undefined,
  });
}

/**
 * Other songs by the same GlobalArtist (channelCount > 0, self excluded).
 * Powers the "이 아티스트의 다른 노래" rail at the bottom of /song/:id.
 */
export function useGlobalSongsByArtist(
  id: number,
  options?: { enabled?: boolean; limit?: number },
) {
  const limit = options?.limit ?? 10;
  return useQuery<GlobalSongByArtistResponse, Error>({
    queryKey: globalSongKeys.byArtist(id, limit),
    queryFn: () => getGlobalSongsByArtist(id, limit),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Caller's channel ids (any visibility) that already registered this song.
 * Drives the "이미 노래책에 있어요" indicator and the picker filter on
 * `/song/:id`. Disabled when the caller is not authenticated — the endpoint
 * is JWT-guarded and would 401.
 */
export function useGlobalSongMyRegistrations(
  id: number,
  options?: { enabled?: boolean },
) {
  return useQuery<GlobalSongMyRegistrationsResponse, Error>({
    queryKey: globalSongKeys.myRegistrations(id),
    queryFn: () => getGlobalSongMyRegistrations(id),
    enabled: options?.enabled ?? true,
    staleTime: 60_000,
  });
}

/**
 * Bulk fetch of every GlobalSong id the caller has registered. Cached at
 * domain level via globalSongKeys.myRegisteredIds() so 70 SongCards on a
 * popular page share one query. Disabled when the caller is not signed in.
 */
export function useMyRegisteredGlobalSongIds(options?: {
  enabled?: boolean;
}) {
  return useQuery<{ registeredGlobalSongIds: number[] }, Error>({
    queryKey: globalSongKeys.myRegisteredIds(),
    queryFn: () => getMyRegisteredGlobalSongIds(),
    enabled: options?.enabled ?? true,
    staleTime: 60_000,
  });
}

export function markGlobalSongAsRegistered(
  queryClient: QueryClient,
  globalSongId: number,
  channelId?: number,
) {
  queryClient.setQueryData<{ registeredGlobalSongIds: number[] }>(
    globalSongKeys.myRegisteredIds(),
    (current) => {
      const ids = current?.registeredGlobalSongIds ?? [];
      if (ids.includes(globalSongId)) {
        return current ?? { registeredGlobalSongIds: ids };
      }
      return { registeredGlobalSongIds: [...ids, globalSongId] };
    },
  );

  if (channelId === undefined) return;

  queryClient.setQueryData<GlobalSongMyRegistrationsResponse>(
    globalSongKeys.myRegistrations(globalSongId),
    (current) => {
      if (!current) {
        return {
          globalSongId,
          mergedFrom: null,
          registeredChannelIds: [channelId],
        };
      }
      if (current.registeredChannelIds.includes(channelId)) return current;
      return {
        ...current,
        registeredChannelIds: [...current.registeredChannelIds, channelId],
      };
    },
  );
}
