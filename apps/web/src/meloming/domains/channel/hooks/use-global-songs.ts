import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  matchGlobalSongs,
  quickAddGlobalSong,
  getRecommendations,
  type QuickAddRequest,
} from "@/meloming/domains/channel/apis/global-songs";
import { globalSongKeys as globalSongDomainKeys } from "@/meloming/domains/global-song/hooks/use-global-song";

export const globalSongKeys = {
  match: (query: string, channelId?: number) =>
    ["global-songs", "match", query, channelId] as const,
  recommendations: (channelId: number) =>
    ["global-songs", "recommendations", channelId] as const,
};

/**
 * Debounced global-song match search.
 * Enabled only when query has >= 2 characters.
 */
export function useGlobalSongMatch(
  query: string,
  channelId?: number,
  limit?: number,
) {
  return useQuery({
    queryKey: globalSongKeys.match(query, channelId),
    queryFn: () => matchGlobalSongs(query, channelId, limit),
    enabled: query.trim().length >= 2,
    staleTime: 60_000,
  });
}

/**
 * Quick-add mutation: add a global song to the channel's songbook.
 * Invalidates song list queries on success.
 */
export function useQuickAddGlobalSong(channelId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: QuickAddRequest) =>
      quickAddGlobalSong(channelId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["songs"] });
      queryClient.invalidateQueries({
        queryKey: ["global-songs", "match"],
      });
      queryClient.invalidateQueries({
        queryKey: ["global-songs", "recommendations"],
      });
      // global-song 도메인 (musicbook/song · /artist · /song/:id) 의
      // useMyRegisteredGlobalSongIds / useGlobalSongMyRegistrations 가
      // 즉시 재평가되도록 prefix 무효화. detail/clips/byArtist/search 의
      // channelCount 정합성도 같이 잡힘.
      queryClient.invalidateQueries({ queryKey: globalSongDomainKeys.all });
    },
  });
}

/**
 * Pre-computed CF recommendations for a channel.
 * Enabled only when channelId is available.
 */
export function useChannelRecommendations(
  channelId: number,
  limit = 20,
) {
  return useQuery({
    queryKey: globalSongKeys.recommendations(channelId),
    queryFn: () => getRecommendations(channelId, limit),
    enabled: channelId > 0,
    staleTime: 5 * 60_000,
  });
}
