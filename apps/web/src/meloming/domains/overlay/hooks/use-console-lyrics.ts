'use client';

import { useQuery } from '@tanstack/react-query';
import {
  getConsoleLyrics,
  type ConsoleLyricsResponse,
} from '@/meloming/domains/overlay/apis/console-lyrics';

export interface UseConsoleLyricsOptions {
  identifier: string;
  songId?: number | null;
  includeRichsync?: boolean;
  /** 콘솔 가사 패널이 mount 됐을 때만 fetch. 기본 true. */
  enabled?: boolean;
}

/**
 * 콘솔 가사 조회 hook.
 *
 * - 운영자가 매칭/가사를 즉시 고치는 데이터라 stale cache 를 쓰지 않는다.
 * - PENDING_LYRICS / UNMATCHED 상태도 정상 응답이므로 retry 거의 의미 없음
 *   (network error에만 retry 1회).
 */
export function useConsoleLyrics(
  options: UseConsoleLyricsOptions,
): ReturnType<typeof useQuery<ConsoleLyricsResponse>> {
  const { identifier, songId, includeRichsync = false, enabled = true } = options;

  return useQuery<ConsoleLyricsResponse>({
    queryKey: ['console-lyrics', identifier, songId, includeRichsync],
    queryFn: () => getConsoleLyrics(identifier, songId as number, { includeRichsync }),
    enabled: Boolean(identifier && typeof songId === 'number' && enabled),
    staleTime: 0,
    refetchOnMount: 'always',
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });
}
