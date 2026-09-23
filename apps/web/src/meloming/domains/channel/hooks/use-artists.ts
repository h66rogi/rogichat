import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { getArtistsPublicWebPath } from "@/meloming/domains/channel/apis/artists";
import type { Artist } from "@/meloming/domains/channel/types/artist";

// Query keys
export const artistsKeys = {
  all: ["artists"] as const,
  user: (username: string) => [...artistsKeys.all, "user", username] as const,
};

/**
 * 특정 사용자의 가수 목록을 가져오는 훅
 * @param username - 사용자 이름
 * @param options - useQuery 옵션
 */
export function useUserArtists(
  username: string,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    cacheTime?: number;
  }
): UseQueryResult<Artist[], Error> {
  return useQuery({
    queryKey: artistsKeys.user(username),
    queryFn: () => getArtistsPublicWebPath(username),
    enabled: !!username && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // 5분
    gcTime: options?.cacheTime ?? 10 * 60 * 1000, // 10분 (구 cacheTime)
  });
}
