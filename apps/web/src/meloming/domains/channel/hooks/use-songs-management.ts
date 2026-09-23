import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult } from "@tanstack/react-query";
import {
  postSongsAlbumArtBulkSearch,
  postSongsChannelChannelIdBulk,
} from "@/meloming/domains/channel/apis/songs";
import type {
  PostSongsAlbumArtBulkSearchRequestBody,
  PostSongsAlbumArtBulkSearchResponse,
  PostSongsChannelIdentifierBulkRequestBody,
  PostSongsChannelIdentifierBulkResponse,
} from "@/meloming/domains/channel/types/song";

export const songsManagementKeys = {
  all: ["songs", "management"] as const,
  channel: (channelId: number) =>
    [...songsManagementKeys.all, "channel", channelId] as const,
};

function assertValidChannelId(channelId: number): void {
  if (!Number.isInteger(channelId) || channelId <= 0) {
    throw new Error("채널 정보를 불러온 뒤 다시 시도해주세요.");
  }
}

export function useSongsManagement(channelId: number): {
  bulkMapAlbumArt: UseMutationResult<
    PostSongsAlbumArtBulkSearchResponse,
    Error,
    PostSongsAlbumArtBulkSearchRequestBody,
    unknown
  >;
  bulkCreateSongs: UseMutationResult<
    PostSongsChannelIdentifierBulkResponse,
    Error,
    PostSongsChannelIdentifierBulkRequestBody,
    unknown
  >;
} {
  const queryClient = useQueryClient();

  const bulkMapAlbumArt = useMutation({
    mutationFn: (body: PostSongsAlbumArtBulkSearchRequestBody) =>
      postSongsAlbumArtBulkSearch(body),
  });

  const bulkCreateSongs = useMutation({
    mutationFn: (body: PostSongsChannelIdentifierBulkRequestBody) => {
      assertValidChannelId(channelId);
      return postSongsChannelChannelIdBulk(channelId, body);
    },
    onSuccess: () => {
      // 등록 이후 관련 목록을 무효화 (필요 시 키 조정)
      queryClient.invalidateQueries();
    },
  });

  return { bulkMapAlbumArt, bulkCreateSongs };
}
