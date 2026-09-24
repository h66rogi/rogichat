import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { getOverlayData } from "@/domains/overlay/apis/overlay";
import type { OverlayData } from "@/domains/overlay/types/overlay";

// Query keys
export const overlayKeys = {
  all: ["overlay"] as const,
  data: (token: string) => [...overlayKeys.all, "data", token] as const,
};

/**
 * 오버레이 데이터를 가져오는 훅
 * @param token - 오버레이 토큰
 * @param options - useQuery 옵션
 */
export function useOverlay(
  token: string,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    cacheTime?: number;
    refetchOnWindowFocus?: boolean;
    refetchOnReconnect?: boolean;
  }
): UseQueryResult<OverlayData, Error> {
  return useQuery({
    queryKey: overlayKeys.data(token),
    queryFn: () => getOverlayData(token),
    enabled: !!token && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // 5분
    gcTime: options?.cacheTime ?? 10 * 60 * 1000, // 10분 (구 cacheTime)
    refetchOnWindowFocus: options?.refetchOnWindowFocus ?? true,
    refetchOnReconnect: options?.refetchOnReconnect ?? true,
  });
}
