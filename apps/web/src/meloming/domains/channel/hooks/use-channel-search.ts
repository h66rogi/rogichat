import { useInfiniteQuery } from "@tanstack/react-query";
import type { UseInfiniteQueryResult } from "@tanstack/react-query";
import { getChannelSearch } from "@/meloming/domains/channel/apis/channels";
import type { GetChannelSearchResponse } from "@/meloming/domains/channel/types/channel";

export const channelSearchKeys = {
  all: ["channel", "search"] as const,
  infinite: (keyword: string, limit: number) =>
    [...channelSearchKeys.all, "infinite", { keyword, limit }] as const,
};

interface UseInfiniteChannelSearchParams {
  keyword: string;
  limit?: number;
  enabled?: boolean;
  staleTime?: number;
  cacheTime?: number;
}

/**
 * 채널 검색(Infinite) 훅
 * - GET /channel/search
 * - 입력 keyword 기준으로 페이지 단위로 채널을 무한스크롤 로딩
 */
export function useInfiniteChannelSearch({
  keyword,
  limit = 24,
  enabled = true,
  staleTime,
  cacheTime,
}: UseInfiniteChannelSearchParams): UseInfiniteQueryResult<
  GetChannelSearchResponse,
  Error
> {
  return useInfiniteQuery({
    queryKey: channelSearchKeys.infinite(keyword, limit),
    queryFn: ({ pageParam = 1 }) =>
      getChannelSearch({
        keyword,
        page: pageParam as number,
        limit,
        expand: true,
      }),
    enabled,
    staleTime: staleTime ?? 5 * 60 * 1000,
    gcTime: cacheTime ?? 10 * 60 * 1000,
    getNextPageParam: (lastPage) => {
      const { page, totalPages } = lastPage.pagination;
      if (page < totalPages) {
        return page + 1;
      }
      return undefined;
    },
    initialPageParam: 1,
  });
}
