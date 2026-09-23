import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getChannelSongPermission,
  createSongAddRequest,
  getChannelSongAddRequests,
  approveSongAddRequest,
  rejectSongAddRequest,
} from "@/meloming/domains/channel/apis/song-requests";
import type {
  SongAddRequest,
  ChannelSongPermission,
  CreateSongAddRequestBody,
  ApproveSongAddRequestBody,
  RejectSongAddRequestBody,
  GetSongAddRequestsQuery,
  GetSongAddRequestsResponse,
} from "@/meloming/domains/channel/types/song-request";

// ---------------------------------------------------------------------------
// Query Keys
// ---------------------------------------------------------------------------

export const songAddRequestKeys = {
  all: ["songAddRequests"] as const,
  permission: (channelId: number | undefined) =>
    [...songAddRequestKeys.all, "permission", channelId ?? null] as const,
  channel: (channelId: number | undefined) =>
    [...songAddRequestKeys.all, "channel", channelId ?? null] as const,
  channelWithParams: (
    channelId: number | undefined,
    params: GetSongAddRequestsQuery
  ) => [...songAddRequestKeys.channel(channelId), params] as const,
  infiniteChannel: (
    channelId: number | undefined,
    params: Omit<GetSongAddRequestsQuery, "cursorId">
  ) => [...songAddRequestKeys.channel(channelId), "infinite", params] as const,
} as const;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * 채널 노래 등록 권한 체크
 */
export function useChannelSongPermission(
  channelId: number | undefined,
  options?: { enabled?: boolean; staleTime?: number; gcTime?: number }
) {
  return useQuery<ChannelSongPermission, Error>({
    queryKey: songAddRequestKeys.permission(channelId),
    queryFn: () => getChannelSongPermission(channelId as number),
    enabled: Boolean(channelId) && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.gcTime ?? 10 * 60 * 1000,
  });
}

/**
 * 채널 노래 신청 목록 (무한 스크롤)
 */
export function useInfiniteChannelSongAddRequests(
  channelId: number | undefined,
  params: Omit<GetSongAddRequestsQuery, "cursorId"> = {},
  options?: { enabled?: boolean; staleTime?: number; gcTime?: number }
) {
  return useInfiniteQuery<GetSongAddRequestsResponse, Error>({
    queryKey: songAddRequestKeys.infiniteChannel(channelId, params),
    queryFn: ({ pageParam }) =>
      getChannelSongAddRequests(channelId as number, {
        ...params,
        cursorId: pageParam as number | undefined,
      }),
    enabled: Boolean(channelId) && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.gcTime ?? 10 * 60 * 1000,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as number | undefined,
  });
}

/**
 * 채널 노래 신청 목록 (일반 쿼리)
 */
export function useChannelSongAddRequests(
  channelId: number | undefined,
  params: GetSongAddRequestsQuery = {},
  options?: { enabled?: boolean; staleTime?: number; gcTime?: number }
) {
  return useQuery<GetSongAddRequestsResponse, Error>({
    queryKey: songAddRequestKeys.channelWithParams(channelId, params),
    queryFn: () => getChannelSongAddRequests(channelId as number, params),
    enabled: Boolean(channelId) && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.gcTime ?? 10 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * 노래 등록 신청
 */
export function useCreateSongAddRequest() {
  const queryClient = useQueryClient();
  return useMutation<SongAddRequest, Error, CreateSongAddRequestBody>({
    mutationFn: createSongAddRequest,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: songAddRequestKeys.channel(data.channel.id),
      });
    },
  });
}

/**
 * 노래 신청 승인 (수정된 값 포함 가능)
 */
export function useApproveSongAddRequest(channelId?: number) {
  const queryClient = useQueryClient();
  return useMutation<
    SongAddRequest,
    Error,
    { id: number; body?: ApproveSongAddRequestBody }
  >({
    mutationFn: ({ id, body }) => approveSongAddRequest(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: songAddRequestKeys.all });
      if (channelId) {
        queryClient.invalidateQueries({
          queryKey: songAddRequestKeys.channel(channelId),
        });
      }
    },
  });
}

/**
 * 노래 신청 거절
 */
export function useRejectSongAddRequest(channelId?: number) {
  const queryClient = useQueryClient();
  return useMutation<
    SongAddRequest,
    Error,
    { id: number; body?: RejectSongAddRequestBody }
  >({
    mutationFn: ({ id, body }) => rejectSongAddRequest(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: songAddRequestKeys.all });
      if (channelId) {
        queryClient.invalidateQueries({
          queryKey: songAddRequestKeys.channel(channelId),
        });
      }
    },
  });
}
