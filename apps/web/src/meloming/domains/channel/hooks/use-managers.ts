import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import {
  deleteChannelsChannelIdManagersManagerId,
  getChannelsChannelIdManagers,
  getChannelsChannelIdManagersSearchUsers,
  patchChannelsChannelIdManagersManagerId,
  patchChannelsChannelIdManagersActive,
  postChannelsChannelIdManagers,
} from "@/meloming/domains/channel/apis/managers";
import type {
  GetChannelsChannelIdManagersResponse,
  GetChannelsChannelIdManagersSearchUsersResponse,
  PatchChannelsChannelIdManagersManagerIdRequestBody,
  PostChannelsChannelIdManagersRequestBody,
  ToggleManagerActiveResponse,
} from "@/meloming/domains/channel/types/manager";

export const managersKeys = {
  all: ["managers"] as const,
  channel: (channelId: number) =>
    [...managersKeys.all, "channel", channelId] as const,
  searchUsers: (channelId: number, nickname: string) =>
    [...managersKeys.all, "searchUsers", channelId, nickname] as const,
};

type UseManagersManagementOptions = {
  enabled?: boolean;
  staleTime?: number;
  cacheTime?: number;
};

type UpdateManagerVariables = {
  managerId: number;
  body: PatchChannelsChannelIdManagersManagerIdRequestBody;
};

type DeleteManagerVariables = {
  managerId: number;
};

type ToggleActiveVariables = {
  managerId: number;
  isActive: boolean;
};

export function useManagersManagement(
  channelId: number,
  options?: UseManagersManagementOptions
): {
  listQuery: UseQueryResult<GetChannelsChannelIdManagersResponse, Error>;
  createManager: UseMutationResult<
    unknown,
    Error,
    PostChannelsChannelIdManagersRequestBody,
    unknown
  >;
  updateManager: UseMutationResult<
    unknown,
    Error,
    UpdateManagerVariables,
    unknown
  >;
  deleteManager: UseMutationResult<
    unknown,
    Error,
    DeleteManagerVariables,
    unknown
  >;
  toggleActive: UseMutationResult<
    ToggleManagerActiveResponse,
    Error,
    ToggleActiveVariables,
    unknown
  >;
} {
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: managersKeys.channel(channelId),
    queryFn: () => getChannelsChannelIdManagers(channelId),
    enabled: !!channelId && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.cacheTime ?? 10 * 60 * 1000,
  });

  const invalidateList = () =>
    queryClient.invalidateQueries({
      queryKey: managersKeys.channel(channelId),
    });

  const createManager = useMutation({
    mutationFn: (body: PostChannelsChannelIdManagersRequestBody) =>
      postChannelsChannelIdManagers(channelId, body),
    onSuccess: () => invalidateList(),
  });

  const updateManager = useMutation({
    mutationFn: ({ managerId, body }: UpdateManagerVariables) =>
      patchChannelsChannelIdManagersManagerId(channelId, managerId, body),
    onSuccess: () => invalidateList(),
  });

  const deleteManager = useMutation({
    mutationFn: ({ managerId }: DeleteManagerVariables) =>
      deleteChannelsChannelIdManagersManagerId(channelId, managerId),
    onSuccess: () => invalidateList(),
  });

  const toggleActive = useMutation({
    mutationFn: ({ managerId, isActive }: ToggleActiveVariables) =>
      patchChannelsChannelIdManagersActive(channelId, managerId, isActive),
    onSuccess: () => invalidateList(),
  });

  return {
    listQuery,
    createManager,
    updateManager,
    deleteManager,
    toggleActive,
  };
}

export function useManagerSearchUsers(
  channelId: number,
  nickname: string,
  options?: { enabled?: boolean; staleTime?: number; cacheTime?: number }
): UseQueryResult<GetChannelsChannelIdManagersSearchUsersResponse, Error> {
  return useQuery({
    queryKey: managersKeys.searchUsers(channelId, nickname),
    queryFn: () =>
      getChannelsChannelIdManagersSearchUsers(channelId, { nickname }),
    enabled:
      !!channelId && Boolean(nickname?.trim()) && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 60 * 1000,
    gcTime: options?.cacheTime ?? 5 * 60 * 1000,
  });
}
