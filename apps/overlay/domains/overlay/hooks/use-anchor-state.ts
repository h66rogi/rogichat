'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LyricsSyncState } from '@/domains/overlay/themes/shared';
import type { LyricsPlaybackStateData } from '@/domains/overlay/hooks/use-overlay-socket';

/** SongRequestId 의미 alias — `number | null` 의 두 의미(active 곡 vs 곡 없음) 표시. */
export type SongRequestId = number;
/** ISO8601 timestamp string — backend `new Date().toISOString()` 단일 출처라 lex 비교 안전. */
export type EmittedAt = string;

interface ActiveAnchor {
  state: LyricsSyncState;
  emittedAt: EmittedAt;
}
interface PendingAnchor {
  state: LyricsSyncState;
  emittedAt: EmittedAt;
}

interface AnchorStateApi {
  lyricsSyncState: LyricsSyncState | null;
  applyIncoming: (state: LyricsPlaybackStateData) => void;
  reset: () => void;
}

/**
 * onLyricsPlaybackState 핸들러용 anchor state 관리.
 *
 * 처리하는 race:
 * 1. 새 곡 anchor 가 request.updated 보다 먼저 도착 → callback drop 안 하고 pending 보관
 *    nowPlayingId 따라잡으면 promote
 * 2. 늦게 도착한 stale 이전 곡 anchor → mismatch + 다른 곡 ID 면 pending 보관
 *    (active 그대로 유지). 더 새로운 anchor 가 superseded 시 갱신
 * 3. pending 이 다른 곡(next song) anchor 인데 active 곡 out-of-order update 도착
 *    → pending 보존
 * 4. 같은 곡 pending 의 retrograde overwrite → emittedAt < 비교로 drop
 *    (== 동등도 drop, 동시 ms 동일 update 도 안전)
 * 5. clear (songRequestId=null) → active + pending 모두 wipe
 *
 * pending 은 다음 둘 중 하나로 해소될 때까지 영구 유지:
 * - nowPlayingId 매치 → promote (pendingVersion 으로 effect trigger 보장)
 * - 더 새로운 anchor 도착 → superseded (overwrite 또는 active promote)
 *
 * unconditional timeout promote 안 함 — stale anchor 가 active 덮어쓰는 회귀 방지.
 * 비정상 시 콘솔 5초 heartbeat republish 로 회복.
 */
export function useAnchorState(nowPlayingId: SongRequestId | null): AnchorStateApi {
  const [lyricsSyncState, setLyricsSyncState] = useState<LyricsSyncState | null>(null);
  const activeRef = useRef<ActiveAnchor | null>(null);
  const pendingRef = useRef<PendingAnchor | null>(null);
  // emittedAt watermark — active/pending 과 무관하게 본 최댓값. clear 후에도
  // 유지해서 out-of-order older anchor 가 stale 곡을 다시 살리는 race 차단.
  const lastEmittedAtRef = useRef<EmittedAt | null>(null);
  // pending mutation 을 effect 가 감지하도록 노출 — ref 만으로는 effect trigger 안 됨.
  const [pendingVersion, setPendingVersion] = useState(0);
  const nowPlayingIdRef = useRef(nowPlayingId);
  useEffect(() => {
    nowPlayingIdRef.current = nowPlayingId;
  }, [nowPlayingId]);

  // pending 이 nowPlayingId 와 매치되면 promote → active.
  // pendingVersion 도 deps 에 포함 — pending 이 새로 보관되면 즉시 매치 검사.
  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    if (pending.state.songRequestId !== nowPlayingId) return;
    activeRef.current = { state: pending.state, emittedAt: pending.emittedAt };
    setLyricsSyncState(pending.state);
    pendingRef.current = null;
  }, [nowPlayingId, pendingVersion]);

  const applyIncoming = useCallback((incoming: LyricsPlaybackStateData) => {
    // emittedAt watermark 비교: < 로 동일 ms 도 drop 회피.
    // watermark 는 active/pending 과 무관하게 본 최댓값 — clear 후에도 유지.
    const watermark = lastEmittedAtRef.current;
    if (watermark !== null && incoming.emittedAt < watermark) {
      console.warn('[anchor-state] drop stale (watermark)', {
        incomingEmittedAt: incoming.emittedAt,
        watermark,
        incomingSongRequestId: incoming.songRequestId,
      });
      return;
    }
    // 통과한 anchor 는 watermark advance (모든 분기 공통).
    lastEmittedAtRef.current = incoming.emittedAt;

    const next: LyricsSyncState = {
      songRequestId: incoming.songRequestId,
      playbackSource: incoming.playbackSource,
      anchorMs: incoming.anchorMs,
      anchorAt: incoming.anchorAt,
      playbackRate: incoming.playbackRate,
      durationMs: incoming.durationMs,
      offsetMs: incoming.offsetMs,
    };

    const active = activeRef.current?.state ?? null;
    const currentNowPlayingId = nowPlayingIdRef.current;
    const isClearSignal = incoming.songRequestId === null;

    if (isClearSignal) {
      // clear: active + pending + lyricsSyncState 모두 null 로 wipe.
      // active 에 null-id anchor 를 두면 다음 anchor (next song) 가 noActive
      // 분기 못 타고 pending 보관 → nowPlayingId 변경 누락 시 stuck.
      activeRef.current = null;
      pendingRef.current = null;
      setLyricsSyncState(null);
      setPendingVersion((v) => v + 1);
      return;
    }

    const matchesNowPlaying =
      incoming.songRequestId !== null &&
      incoming.songRequestId === currentNowPlayingId;
    const sameSong =
      active !== null && active.songRequestId === incoming.songRequestId;
    // initial idle: active 도 null, nowPlayingId 도 null — 어떤 anchor 든 pending
    // 보낼 곳 없음 → 적용. (단순히 noActive 면 clear 후 다음 곡 anchor 가
    // nowPlayingId 따라잡기 전 잘못 적용되어 stale REST nowPlaying.song.id 와
    // 결합되는 회귀 — Codex P2 지적.)
    const initialIdle = active === null && currentNowPlayingId === null;

    if (matchesNowPlaying || sameSong || initialIdle) {
      // 같은 곡 pending(outdated) 만 비움. 다른 곡 pending 은 보존.
      if (
        pendingRef.current !== null &&
        pendingRef.current.state.songRequestId === incoming.songRequestId
      ) {
        pendingRef.current = null;
        setPendingVersion((v) => v + 1);
      }
      activeRef.current = { state: next, emittedAt: incoming.emittedAt };
      setLyricsSyncState(next);
      return;
    }

    // pending 으로 보관 — active 와 다른 곡 + nowPlayingId 와도 다름.
    // active.emittedAt 은 update 안 함 — pending 이 promote 될 때 active 가 바뀜.
    //
    // 같은 곡 pending 의 retrograde overwrite 차단.
    if (
      pendingRef.current !== null &&
      pendingRef.current.state.songRequestId === incoming.songRequestId &&
      incoming.emittedAt < pendingRef.current.emittedAt
    ) {
      console.warn('[anchor-state] drop stale (pending)', {
        incomingEmittedAt: incoming.emittedAt,
        pendingEmittedAt: pendingRef.current.emittedAt,
        songRequestId: incoming.songRequestId,
      });
      return;
    }
    pendingRef.current = { state: next, emittedAt: incoming.emittedAt };
    // pendingVersion bump 해서 promote effect 가 즉시 매치 검사하도록.
    setPendingVersion((v) => v + 1);
  }, []);

  const reset = useCallback(() => {
    pendingRef.current = null;
    activeRef.current = null;
    lastEmittedAtRef.current = null;
    setLyricsSyncState(null);
    setPendingVersion((v) => v + 1);
  }, []);

  return { lyricsSyncState, applyIncoming, reset };
}
