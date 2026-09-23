'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  startLiveSession,
  getActiveSession,
  endLiveSession,
  updateSessionSettings,
  getSessionHistory,
  getSessionDetail,
  cloneSession,
  type StartSessionDto,
  type SessionSettings,
} from '@/meloming/domains/overlay/apis/session';
import { updateChannelSongRequestSettings } from '@/meloming/domains/overlay/apis/channel-song-request-settings';
import { channelSongRequestSettingsKeys } from '@/meloming/domains/overlay/hooks/use-channel-song-request-settings';

const getSessionScope = (identifier?: string) =>
  identifier?.trim().toLowerCase() || 'primary';

// Query keys
export const sessionKeys = {
  all: ['session'] as const,
  active: (identifier?: string) =>
    [...sessionKeys.all, 'active', getSessionScope(identifier)] as const,
  history: (identifier: string | undefined, page: number, limit: number) =>
    [...sessionKeys.all, 'history', getSessionScope(identifier), page, limit] as const,
  detail: (sessionId: number) => [...sessionKeys.all, 'detail', sessionId] as const,
};

/**
 * 활성 세션을 조회하는 훅
 */
export function useActiveSession(
  identifier?: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: sessionKeys.active(identifier),
    queryFn: () => getActiveSession(identifier),
    enabled: options?.enabled ?? true,
    staleTime: 30 * 1000, // 30초
    refetchOnWindowFocus: true,
  });
}

/**
 * 신청곡 모드 세션 시작 뮤테이션
 */
export function useStartSession(identifier?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: StartSessionDto) => startLiveSession(dto, identifier),
    onSuccess: (session) => {
      queryClient.setQueryData(sessionKeys.active(identifier), session);
    },
  });
}

/**
 * 신청곡 모드 세션 종료 뮤테이션
 */
export function useEndSession(identifier?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: number) => endLiveSession(sessionId),
    onSuccess: () => {
      queryClient.setQueryData(sessionKeys.active(identifier), null);
      queryClient.invalidateQueries({ queryKey: sessionKeys.all });
    },
  });
}

/**
 * 세션 설정 업데이트 뮤테이션.
 *
 * 2026-05-14 P0 재설계 후 라우팅 분기:
 *  - sessionId 있음 (라이브 active): 옛 endpoint `PATCH /v1/song-live/sessions/:id`.
 *    백엔드가 paused/requestEnabled 만 LiveSessionSettings 에, 나머지는 채널 settings 에
 *    forward.
 *  - sessionId 없음 (라이브 비활성): 새 endpoint
 *    `PATCH /v1/channel/:channelId/song-request-settings`. paused/requestEnabled 는
 *    의미 없어 자동 제외.
 *
 * channelId 는 hook 생성 시 받음. 호출자가 채널 context 안에서 사용.
 */
export function useUpdateSessionSettings(
  identifier?: string,
  channelId?: number,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      settings,
    }: {
      sessionId: number | null;
      settings: Partial<Omit<SessionSettings, 'id'>>;
    }) => {
      if (sessionId) {
        return updateSessionSettings(sessionId, settings);
      }
      if (!channelId) {
        throw new Error(
          '라이브 비활성 상태에서 settings 변경하려면 channelId 가 필요합니다.',
        );
      }
      const {
        paused: _paused,
        requestEnabled: _requestEnabled,
        ...channelScope
      } = settings;
      void _paused;
      void _requestEnabled;
      await updateChannelSongRequestSettings(channelId, channelScope);
      return null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: sessionKeys.active(identifier),
      });
      if (typeof channelId === 'number') {
        queryClient.invalidateQueries({
          queryKey: channelSongRequestSettingsKeys.byChannel(channelId),
        });
      }
    },
  });
}

/**
 * 세션 히스토리 목록을 조회하는 훅
 */
export function useSessionHistory(
  page: number = 1,
  limit: number = 10,
  identifier?: string
) {
  return useQuery({
    queryKey: sessionKeys.history(identifier, page, limit),
    queryFn: () => getSessionHistory(page, limit, identifier),
    staleTime: 60 * 1000, // 1분
  });
}

/**
 * 세션 상세 정보를 조회하는 훅
 */
export function useSessionDetail(sessionId: number | null) {
  return useQuery({
    queryKey: sessionKeys.detail(sessionId ?? 0),
    queryFn: () => getSessionDetail(sessionId!),
    enabled: !!sessionId,
    staleTime: 5 * 60 * 1000, // 5분
  });
}

/**
 * 이전 세션 복제 (설정 + 신청곡 전체 복원) 뮤테이션
 */
export function useCloneSession(identifier?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sourceSessionId: number) =>
      cloneSession(sourceSessionId, identifier),
    onSuccess: (session) => {
      queryClient.setQueryData(sessionKeys.active(identifier), session);
      queryClient.invalidateQueries({ queryKey: sessionKeys.all });
    },
  });
}
