'use client';

import { useEffect, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { overlayKeys } from './use-overlay';
import type { SongRequestId } from './use-anchor-state';

const RETRY_DELAYS_MS = [0, 300, 700, 1500, 3000, 5000] as const;
/** exhausted 후 같은 syncId 로 chain 재시작 허용까지 대기. heartbeat 폭주 방지. */
const EXHAUSTED_COOLDOWN_MS = 10000;

/** retryRef internal state — discriminated union 으로 illegal 상태 차단. */
type RetryState =
  | { phase: 'idle' }
  | {
      phase: 'retrying';
      targetSyncId: SongRequestId;
      attempt: number;
      timer: ReturnType<typeof setTimeout>;
      runId: number;
    }
  | {
      phase: 'exhausted';
      targetSyncId: SongRequestId;
      cooldownTimer: ReturnType<typeof setTimeout>;
    };

interface UseSyncIdRefetchOptions {
  token: string | null | undefined;
  syncId: SongRequestId | null;
  overlayDataNowPlayingId: SongRequestId | null;
  queryClient: QueryClient;
}

/**
 * lyrics.playback.state anchor 의 songRequestId 와 OverlayData REST snapshot 의
 * nowPlaying.id 가 mismatch 면 OverlayData 를 refetch.
 *
 * timer self-chain 으로 effect 재실행 의존성 제거. chain identity 는 runId ref
 * 로 추적. exhausted 시 cooldown timer 가 자동 reset → effect rerun 트리거 위해
 * version state 사용 (deps 에 syncId/REST id 만 있으면 stale 한 동일 값 유지로
 * effect 가 영원히 안 깨어나는 회귀 차단).
 *
 * RETRY_DELAYS_MS = [0, 300, 700, 1500, 3000, 5000] (~10s, 6회 후 exhausted).
 * EXHAUSTED_COOLDOWN_MS = 10s.
 */
export function useSyncIdRefetch(options: UseSyncIdRefetchOptions): void {
  const { token, syncId, overlayDataNowPlayingId, queryClient } = options;
  const retryRef = useRef<RetryState>({ phase: 'idle' });
  const runIdRef = useRef(0);
  // cooldown 종료 시 effect rerun 트리거 — deps 안 변할 때도 chain 재시작 가능.
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    if (!token) return;

    if (syncId === null) {
      if (retryRef.current.phase === 'retrying') {
        clearTimeout(retryRef.current.timer);
      } else if (retryRef.current.phase === 'exhausted') {
        clearTimeout(retryRef.current.cooldownTimer);
      }
      retryRef.current = { phase: 'idle' };
      return;
    }

    if (syncId === overlayDataNowPlayingId) {
      if (retryRef.current.phase === 'retrying') {
        clearTimeout(retryRef.current.timer);
      } else if (retryRef.current.phase === 'exhausted') {
        clearTimeout(retryRef.current.cooldownTimer);
      }
      retryRef.current = { phase: 'idle' };
      return;
    }

    // mismatch — 새 syncId 면 reset
    if (
      retryRef.current.phase !== 'idle' &&
      retryRef.current.targetSyncId !== syncId
    ) {
      if (retryRef.current.phase === 'retrying') {
        clearTimeout(retryRef.current.timer);
      } else if (retryRef.current.phase === 'exhausted') {
        clearTimeout(retryRef.current.cooldownTimer);
      }
      retryRef.current = { phase: 'idle' };
    }

    // exhausted 동일 syncId → cooldown timer 가 fire 하면 retryVersion bump 로
    // effect rerun. 그 사이엔 no-op.
    if (
      retryRef.current.phase === 'exhausted' &&
      retryRef.current.targetSyncId === syncId
    ) {
      return;
    }

    // retrying 동일 syncId → chain 보존
    if (
      retryRef.current.phase === 'retrying' &&
      retryRef.current.targetSyncId === syncId
    ) {
      return;
    }

    // 새 chain 시작
    const runId = ++runIdRef.current;

    const scheduleNext = (attempt: number) => {
      // chain identity check — 다른 chain 으로 갈음됐으면 stop
      if (retryRef.current.phase !== 'retrying' && attempt > 0) {
        return;
      }
      if (
        retryRef.current.phase === 'retrying' &&
        retryRef.current.runId !== runId
      ) {
        return;
      }

      if (attempt >= RETRY_DELAYS_MS.length) {
        console.warn('[sync-id-refetch] give up after exhausted retries', {
          targetSyncId: syncId,
          attempts: RETRY_DELAYS_MS.length,
          cooldownMs: EXHAUSTED_COOLDOWN_MS,
        });
        // cooldown timer — fire 시 retryRef reset + retryVersion bump 로
        // effect rerun. 같은 syncId 가 여전히 mismatch 면 새 chain 시작.
        const cooldownTimer = setTimeout(() => {
          if (
            retryRef.current.phase !== 'exhausted' ||
            retryRef.current.cooldownTimer !== cooldownTimer
          ) {
            return;
          }
          retryRef.current = { phase: 'idle' };
          setRetryVersion((v) => v + 1);
        }, EXHAUSTED_COOLDOWN_MS);
        retryRef.current = {
          phase: 'exhausted',
          targetSyncId: syncId,
          cooldownTimer,
        };
        return;
      }

      const delay = RETRY_DELAYS_MS[attempt];
      const timer = setTimeout(() => {
        // fire 시점에 다시 chain identity check
        if (
          retryRef.current.phase !== 'retrying' ||
          retryRef.current.runId !== runId
        ) {
          return;
        }
        queryClient.invalidateQueries({ queryKey: overlayKeys.data(token) });
        scheduleNext(attempt + 1);
      }, delay);
      retryRef.current = {
        phase: 'retrying',
        targetSyncId: syncId,
        attempt,
        timer,
        runId,
      };
    };

    scheduleNext(0);

    // cleanup 안 return — chain 은 runId 로 관리. 다른 syncId/match/clear 분기
    // 에서 명시적 clearTimeout.
  }, [token, syncId, overlayDataNowPlayingId, queryClient, retryVersion]);

  // unmount cleanup
  useEffect(() => {
    return () => {
      if (retryRef.current.phase === 'retrying') {
        clearTimeout(retryRef.current.timer);
      } else if (retryRef.current.phase === 'exhausted') {
        clearTimeout(retryRef.current.cooldownTimer);
      }
    };
  }, []);
}
