import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  UseQueryResult,
  UseMutationResult,
} from "@tanstack/react-query";
import {
  getChannelProfile,
  putChannelProfile,
  patchChannelProfile,
} from "@/meloming/domains/channel-profile/apis/profile";
import type {
  ChannelProfile,
  PutChannelProfileRequestBody,
  PatchChannelProfileRequestBody,
} from "@/meloming/domains/channel-profile/types/profile";

// Query keys
export const channelProfileKeys = {
  all: ["channelProfile"] as const,
  detail: (channelId: number) =>
    [...channelProfileKeys.all, "detail", channelId] as const,
};

/**
 * 채널 프로필을 조회하는 훅
 * @param channelId - 채널 ID
 * @param options - useQuery 옵션
 */
export function useChannelProfile(
  channelId: number,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    cacheTime?: number;
  }
): UseQueryResult<ChannelProfile, Error> {
  return useQuery({
    queryKey: channelProfileKeys.detail(channelId),
    queryFn: () => getChannelProfile(channelId),
    enabled: !!channelId && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // 5분
    gcTime: options?.cacheTime ?? 10 * 60 * 1000, // 10분
  });
}

/**
 * 채널 프로필 전체 업데이트 훅
 * @param channelId - 채널 ID
 */
export function useUpdateChannelProfile(
  channelId: number
): UseMutationResult<
  ChannelProfile,
  Error,
  PutChannelProfileRequestBody,
  unknown
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: PutChannelProfileRequestBody) =>
      putChannelProfile(channelId, body),
    onSuccess: () => {
      // 프로필 업데이트 후 캐시 무효화
      queryClient.invalidateQueries({
        queryKey: channelProfileKeys.detail(channelId),
      });
    },
  });
}

/**
 * 채널 프로필 부분 업데이트 훅
 * @param channelId - 채널 ID
 */
export function usePatchChannelProfile(
  channelId: number
): UseMutationResult<
  ChannelProfile,
  Error,
  PatchChannelProfileRequestBody,
  unknown
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: PatchChannelProfileRequestBody) =>
      patchChannelProfile(channelId, body),
    onSuccess: () => {
      // 프로필 업데이트 후 캐시 무효화
      queryClient.invalidateQueries({
        queryKey: channelProfileKeys.detail(channelId),
      });
    },
  });
}

