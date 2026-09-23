'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getChannelSongRequestSettings,
  updateChannelSongRequestSettings,
  type ChannelSongRequestSettings,
  type UpdateChannelSongRequestSettingsDto,
} from '@/meloming/domains/overlay/apis/channel-song-request-settings';

export const channelSongRequestSettingsKeys = {
  all: ['channelSongRequestSettings'] as const,
  byChannel: (channelId: number) =>
    [...channelSongRequestSettingsKeys.all, channelId] as const,
};

/**
 * 채널 신청곡 설정 조회 — 라이브 상태와 무관하게 채널 owner/매니저가 토글 변경 가능.
 */
export function useChannelSongRequestSettings(
  channelId: number | null | undefined,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: channelSongRequestSettingsKeys.byChannel(channelId ?? 0),
    queryFn: () => getChannelSongRequestSettings(channelId as number),
    enabled: (options?.enabled ?? true) && typeof channelId === 'number',
    staleTime: 30 * 1000,
  });
}

/**
 * 채널 신청곡 설정 업데이트 뮤테이션.
 */
export function useUpdateChannelSongRequestSettings(channelId: number) {
  const queryClient = useQueryClient();

  return useMutation<
    ChannelSongRequestSettings,
    Error,
    UpdateChannelSongRequestSettingsDto
  >({
    mutationFn: (dto) => updateChannelSongRequestSettings(channelId, dto),
    onSuccess: (saved) => {
      queryClient.setQueryData(
        channelSongRequestSettingsKeys.byChannel(channelId),
        saved,
      );
    },
  });
}
