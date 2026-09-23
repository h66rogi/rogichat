import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import {
  deleteArtistsChannelChannelIdArtistsArtistsId,
  getArtistsChannelChannelIdArtists,
  postArtistsChannelChannelIdArtists,
  putArtistsChannelChannelIdArtistsArtistsId,
} from "@/meloming/domains/channel/apis/artists";
import type {
  Artist,
  PostArtistsChannelChannelIdArtistsRequestBody,
  PostArtistsChannelChannelIdArtistsResponse,
  PutArtistsChannelChannelIdArtistsArtistsIdRequestBody,
  PutArtistsChannelChannelIdArtistsArtistsIdResponse,
  DeleteArtistsChannelChannelIdArtistsArtistsIdResponse,
} from "@/meloming/domains/channel/types/artist";

export const artistsManagementKeys = {
  all: ["artists", "management"] as const,
  channel: (channelId: number) =>
    [...artistsManagementKeys.all, "channel", channelId] as const,
};

type UpdateArtistVariables = {
  artistsId: number;
  body: PutArtistsChannelChannelIdArtistsArtistsIdRequestBody;
};

type DeleteArtistVariables = {
  artistsId: number;
};

type UseArtistsManagementOptions = {
  enabled?: boolean;
  staleTime?: number;
  cacheTime?: number; // alias for gcTime (backward naming compat)
};

export function useArtistsManagement(
  channelId: number,
  options?: UseArtistsManagementOptions
): {
  listQuery: UseQueryResult<Artist[], Error>;
  createArtist: UseMutationResult<
    PostArtistsChannelChannelIdArtistsResponse,
    Error,
    PostArtistsChannelChannelIdArtistsRequestBody,
    unknown
  >;
  updateArtist: UseMutationResult<
    PutArtistsChannelChannelIdArtistsArtistsIdResponse,
    Error,
    UpdateArtistVariables,
    unknown
  >;
  deleteArtist: UseMutationResult<
    DeleteArtistsChannelChannelIdArtistsArtistsIdResponse,
    Error,
    DeleteArtistVariables,
    unknown
  >;
} {
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: artistsManagementKeys.channel(channelId),
    queryFn: () => getArtistsChannelChannelIdArtists(channelId),
    enabled: !!channelId && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.cacheTime ?? 10 * 60 * 1000,
  });

  const invalidateList = () =>
    queryClient.invalidateQueries({
      queryKey: artistsManagementKeys.channel(channelId),
    });

  const createArtist = useMutation({
    mutationFn: (body: PostArtistsChannelChannelIdArtistsRequestBody) =>
      postArtistsChannelChannelIdArtists(channelId, body),
    onSuccess: () => invalidateList(),
  });

  const updateArtist = useMutation({
    mutationFn: ({ artistsId, body }: UpdateArtistVariables) =>
      putArtistsChannelChannelIdArtistsArtistsId(channelId, artistsId, body),
    onSuccess: () => invalidateList(),
  });

  const deleteArtist = useMutation({
    mutationFn: ({ artistsId }: DeleteArtistVariables) =>
      deleteArtistsChannelChannelIdArtistsArtistsId(channelId, artistsId),
    onSuccess: () => invalidateList(),
  });

  return { listQuery, createArtist, updateArtist, deleteArtist };
}
