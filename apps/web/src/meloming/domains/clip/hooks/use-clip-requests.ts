import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getChannelClipPermission,
  createClipRequest,
  getChannelClipRequests,
  approveClipRequest,
  rejectClipRequest,
} from "@/meloming/domains/clip/apis/clip-requests";
import type {
  ClipRequest,
  ChannelClipPermission,
  CreateClipRequestBody,
  RejectClipRequestBody,
  GetClipRequestsQuery,
  GetClipRequestsResponse,
} from "@/meloming/domains/clip/types/clip-request";

// ---------------------------------------------------------------------------
// Query Keys
// ---------------------------------------------------------------------------

export const clipRequestKeys = {
  all: ["clipRequests"] as const,
  permission: (channelId: number | undefined) =>
    [...clipRequestKeys.all, "permission", channelId ?? null] as const,
  channel: (channelId: number | undefined) =>
    [...clipRequestKeys.all, "channel", channelId ?? null] as const,
  channelWithParams: (
    channelId: number | undefined,
    params: GetClipRequestsQuery
  ) => [...clipRequestKeys.channel(channelId), params] as const,
  infiniteChannel: (
    channelId: number | undefined,
    params: Omit<GetClipRequestsQuery, "cursorId">
  ) => [...clipRequestKeys.channel(channelId), "infinite", params] as const,
} as const;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * 채널 클립 등록 권한 체크
 */
export function useChannelClipPermission(
  channelId: number | undefined,
  options?: { enabled?: boolean; staleTime?: number; gcTime?: number }
) {
  return useQuery<ChannelClipPermission, Error>({
    queryKey: clipRequestKeys.permission(channelId),
    queryFn: () => getChannelClipPermission(channelId as number),
    enabled: Boolean(channelId) && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.gcTime ?? 10 * 60 * 1000,
  });
}

/**
 * 채널 클립 신청 목록 (무한 스크롤)
 */
export function useInfiniteChannelClipRequests(
  channelId: number | undefined,
  params: Omit<GetClipRequestsQuery, "cursorId"> = {},
  options?: { enabled?: boolean; staleTime?: number; gcTime?: number }
) {
  return useInfiniteQuery<GetClipRequestsResponse, Error>({
    queryKey: clipRequestKeys.infiniteChannel(channelId, params),
    queryFn: ({ pageParam }) =>
      getChannelClipRequests(channelId as number, {
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
 * 채널 클립 신청 목록 (일반 쿼리)
 */
export function useChannelClipRequests(
  channelId: number | undefined,
  params: GetClipRequestsQuery = {},
  options?: { enabled?: boolean; staleTime?: number; gcTime?: number }
) {
  return useQuery<GetClipRequestsResponse, Error>({
    queryKey: clipRequestKeys.channelWithParams(channelId, params),
    queryFn: () => getChannelClipRequests(channelId as number, params),
    enabled: Boolean(channelId) && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.gcTime ?? 10 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * 클립 등록 신청
 */
export function useCreateClipRequest() {
  const queryClient = useQueryClient();
  return useMutation<ClipRequest, Error, CreateClipRequestBody>({
    mutationFn: createClipRequest,
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: clipRequestKeys.channel(data.channel.id),
      });
    },
  });
}

/**
 * 클립 신청 승인
 */
export function useApproveClipRequest(channelId?: number) {
  const queryClient = useQueryClient();
  return useMutation<ClipRequest, Error, number>({
    mutationFn: approveClipRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clipRequestKeys.all });
      if (channelId) {
        queryClient.invalidateQueries({
          queryKey: clipRequestKeys.channel(channelId),
        });
      }
    },
  });
}

/**
 * 클립 신청 거절
 */
export function useRejectClipRequest(channelId?: number) {
  const queryClient = useQueryClient();
  return useMutation<
    ClipRequest,
    Error,
    { id: number; body?: RejectClipRequestBody }
  >({
    mutationFn: ({ id, body }) => rejectClipRequest(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clipRequestKeys.all });
      if (channelId) {
        queryClient.invalidateQueries({
          queryKey: clipRequestKeys.channel(channelId),
        });
      }
    },
  });
}
