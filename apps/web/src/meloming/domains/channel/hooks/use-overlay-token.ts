import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getChannelOverlayToken,
  regenerateChannelOverlayToken,
  refreshChannelOverlay,
} from "@/meloming/domains/channel/apis/channels";

export const overlayTokenKeys = {
  all: ["overlay-token"] as const,
  byChannel: (identifier: string) =>
    [...overlayTokenKeys.all, identifier] as const,
};

/**
 * 채널의 오버레이 토큰을 조회하는 훅
 */
export function useOverlayToken(identifier: string, enabled = true) {
  return useQuery({
    queryKey: overlayTokenKeys.byChannel(identifier),
    queryFn: () => getChannelOverlayToken(identifier),
    enabled: !!identifier && enabled,
    staleTime: Infinity, // 토큰은 자주 변경되지 않음
  });
}

/**
 * 채널의 오버레이 토큰을 재생성하는 훅
 */
export function useRegenerateOverlayToken(identifier: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => regenerateChannelOverlayToken(identifier),
    onSuccess: (data) => {
      queryClient.setQueryData(overlayTokenKeys.byChannel(identifier), data);
    },
  });
}

/**
 * OBS 브라우저 소스에 새로고침 신호를 보내는 훅
 */
export function useRefreshOverlay(identifier: string) {
  return useMutation({
    mutationFn: () => refreshChannelOverlay(identifier),
  });
}
