'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { motion } from 'framer-motion';
import posthog from 'posthog-js';
import {
  AlertTriangle,
  ChevronsLeft,
  ChevronsRight,
  Languages,
  Loader2,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Video,
  X,
} from 'lucide-react';
import { useConsoleLyrics } from '@/meloming/domains/overlay/hooks/use-console-lyrics';
import {
  publishLyricsPlaybackState,
  type LyricsPlaybackSource as ApiLyricsPlaybackSource,
} from '@/meloming/domains/overlay/apis/session';
import { patchConsoleSongMetadata } from '@/meloming/domains/channel/apis/songs';
import type { LyricsPlaybackStateData } from '@/meloming/domains/overlay/hooks/use-overlay-socket';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/meloming/shared/components/ui/alert';
import { Button } from '@/meloming/shared/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/meloming/shared/components/ui/tooltip';
import { cn } from '@/meloming/shared/lib/utils';

/**
 * 콘솔(리모컨) Musixmatch 가사 패널 (Phase B2).
 *
 * 부모가 `useLyricsPanelController(props)` 로 단일 controller 를 만들고
 * `<LyricsToolbar controller={...} />` 와 `<LyricsBody controller={...} />` 를
 * 원하는 위치에 배치한다 (sticky header 한 줄에 toolbar 합치는 등).
 *
 * legacy single-component `<LyricsPanel ... />` 도 backward-compat 으로 유지.
 *
 * spec: docs/superpowers/specs/2026-04-29-musixmatch-console-lyrics-design.md
 */

export interface LyricsPanelProps {
  identifier: string;
  songId?: number | null;
  /** 현재 곡+영상의 가사 offset 초기값. */
  initialPreferredLyricsOffsetMs?: number | null;
  /** 스트리머가 입력한 수기 가사 메모 — Musixmatch 미매칭 시 fallback 노출. */
  fallbackText?: string | null;
  /** YouTube 임베드 모드 currentTime accessor (sec, float). */
  getCurrentTime?: () => number;
  /** HTML5 fallback 모드 video element ref. */
  fallbackVideoRef?: RefObject<HTMLVideoElement | null>;
  useHtml5Player?: boolean;
  /** 비디오 재생 상태 (video 모드 anchor 트리거). */
  videoPlaybackState?: 'playing' | 'paused' | 'ended' | 'buffering' | 'unstarted';
  /** 비디오 총 길이 (ms). nowsong widget progress bar 용. 0 = 미상. */
  videoDurationMs?: number;
  /** 가사 sync broadcast 대상 세션. null/undefined 면 publish 비활성. */
  sessionId?: number | null;
  /** 현재 재생 중인 song request id. payload 곡 식별. */
  songRequestId?: number | null;
  /** 'publisher': 콘솔 (기본). 'subscriber': 오버레이 widget — publish 비활성. */
  mode?: 'publisher' | 'subscriber';
}

type ViewMode = 'plain' | 'synced';
type PlaybackSource = 'video' | 'manual';
type ViewSource = 'main' | 'mine';

/** seek 감지 임계값 — RAF 보간 예상값 vs 실제 currentTime 차이가 이를 넘으면 seek로 간주 */
const VIDEO_SEEK_THRESHOLD_MS = 500;
const SYNC_STEP_MS = 100;
const SYNC_MIN_MS = -60000;
const SYNC_MAX_MS = 60000;
const LYRICS_SYNC_HINT_DISMISSED_KEY =
  'meloming:lyrics-sync-line-click-hint-dismissed';

function clampSyncOffset(ms: number): number {
  return Math.max(
    SYNC_MIN_MS,
    Math.min(SYNC_MAX_MS, Math.round(ms / SYNC_STEP_MS) * SYNC_STEP_MS),
  );
}

export type LyricsPanelController = ReturnType<typeof useLyricsPanelController>;

export function useLyricsPanelController({
  identifier,
  songId,
  initialPreferredLyricsOffsetMs,
  fallbackText,
  getCurrentTime,
  fallbackVideoRef,
  useHtml5Player = false,
  videoPlaybackState = 'unstarted',
  videoDurationMs = 0,
  sessionId = null,
  songRequestId = null,
  mode = 'publisher',
}: LyricsPanelProps) {
  const enabled = typeof songId === 'number';
  const { data, isLoading, isError, error } = useConsoleLyrics({
    identifier,
    songId,
    enabled,
  });

  // view mode + ko-pron preference
  const [viewModePref, setViewModePref] = useState<ViewMode | null>(null);
  const [showKoPron, setShowKoPron] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const appliedDefaultsForSongRef = useRef<number | null>(null);

  // view source — '원곡 가사' (main: Musixmatch) vs '내 가사' (mine: lyricsText).
  // fallbackText 있을 때만 토글 노출, 곡 변경 시 reset.
  const [viewSourcePref, setViewSourcePref] = useState<ViewSource | null>(null);

  // 사용자 보정 offset — backend song_video_preferences 와 동기화.
  // 곡/영상 변경 시 prop 값으로 reset, 슬라이더 변경 시 debounced PATCH.
  const [offsetMs, setOffsetMs] = useState(initialPreferredLyricsOffsetMs ?? 0);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const lineRefs = useRef<Array<HTMLLIElement | null>>([]);
  const activeIndexRef = useRef(-1);

  // 재생 source — 영상 따라가기 vs 수동.
  const hasVideoSource = !!getCurrentTime || !!fallbackVideoRef;
  const [playbackSource, setPlaybackSource] = useState<PlaybackSource>(
    hasVideoSource ? 'video' : 'manual',
  );

  // 통합 anchor state — video / manual 모두 같은 모델.
  //   재생 중: anchorAt 시점에 곡이 anchorMs 위치에 있었음.
  //   정지: anchorAt = null. anchorMs 가 곧 현재 위치.
  // 보간식: anchorAt ? anchorMs + (now - parse(anchorAt)) * playbackRate : anchorMs
  const [anchorMs, setAnchorMs] = useState(0);
  const [anchorAt, setAnchorAt] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  // RAF 루프에서 보여주기용 ms.
  const [displayMs, setDisplayMs] = useState(0);

  // refs — RAF 루프가 stale closure 없이 최신 값을 읽기 위함.
  const anchorMsRef = useRef(0);
  const anchorAtRef = useRef<string | null>(null);
  const playbackSourceRef = useRef<PlaybackSource>(playbackSource);
  const playbackRateRef = useRef(1);
  const offsetMsRef = useRef(offsetMs);
  useEffect(() => {
    anchorMsRef.current = anchorMs;
  }, [anchorMs]);
  useEffect(() => {
    anchorAtRef.current = anchorAt;
  }, [anchorAt]);
  useEffect(() => {
    playbackSourceRef.current = playbackSource;
  }, [playbackSource]);
  useEffect(() => {
    playbackRateRef.current = playbackRate;
  }, [playbackRate]);
  useEffect(() => {
    offsetMsRef.current = offsetMs;
  }, [offsetMs]);

  // sync broadcast 인프라
  const clientInstanceIdRef = useRef<string | null>(null);
  if (clientInstanceIdRef.current === null) {
    clientInstanceIdRef.current =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `console-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  }
  const lastAppliedEmittedAtRef = useRef<string | null>(null);
  const applyingFromRemoteRef = useRef(false);

  const trackLengthMs =
    videoDurationMs > 0
      ? videoDurationMs
      : (data?.globalSong?.mxmTrackLengthSec ?? 0) * 1000;

  // 곡 변경 → 사용자 표시 선택 reset + anchor 0.
  // offset prop은 저장/복원 흐름에서 같은 곡이어도 갱신될 수 있으므로 이 effect
  // dependency에 넣으면 한글 발음/번역 토글이 간헐적으로 초기화된다.
  useEffect(() => {
    setViewModePref(null);
    setShowKoPron(false);
    setShowTranslation(false);
    appliedDefaultsForSongRef.current = null;
    setAnchorMs(0);
    setAnchorAt(null);
    setPlaybackRate(1);
    setViewSourcePref(null);
  }, [songId]);

  // 저장된 sync offset 복원. 같은 곡에서 저장값 prop만 바뀌는 경우 표시 옵션은
  // 유지하고 offset 값만 갱신한다.
  useEffect(() => {
    setOffsetMs(initialPreferredLyricsOffsetMs ?? 0);
  }, [songId, initialPreferredLyricsOffsetMs]);

  // anchor 보간식 — 한 곳에서만 정의 (RAF / displayMs / seek detection 모두 사용).
  const computeCurrentMs = useCallback(() => {
    if (anchorAtRef.current && playbackRateRef.current > 0) {
      const elapsed = Date.now() - Date.parse(anchorAtRef.current);
      return anchorMsRef.current + elapsed * playbackRateRef.current;
    }
    return anchorMsRef.current;
  }, []);
  const getPlaybackNowMs = useCallback(() => {
    if (playbackSourceRef.current === 'video') {
      const currentTimeSec = useHtml5Player
        ? fallbackVideoRef?.current?.currentTime ?? null
        : getCurrentTime?.() ?? null;
      if (typeof currentTimeSec === 'number') {
        return Math.max(0, currentTimeSec * 1000);
      }
    }
    return computeCurrentMs();
  }, [computeCurrentMs, fallbackVideoRef, getCurrentTime, useHtml5Player]);

  // manual controls — anchor 직접 update.
  const manualRunning = anchorAt !== null && playbackSource === 'manual';
  const manualPlay = useCallback(() => {
    if (anchorAtRef.current !== null) return;
    setAnchorAt(new Date().toISOString());
  }, []);
  const manualPause = useCallback(() => {
    if (anchorAtRef.current === null) return;
    const current = computeCurrentMs();
    setAnchorMs(current);
    setAnchorAt(null);
  }, [computeCurrentMs]);
  const manualSeek = useCallback(
    (ms: number) => {
      const clamped = Math.max(0, Math.min(ms, trackLengthMs > 0 ? trackLengthMs : ms));
      setAnchorMs(clamped);
      if (anchorAtRef.current !== null) {
        // 재생 중 seek — anchorAt 새로 stamp 해야 보간이 새 위치부터 진행.
        setAnchorAt(new Date().toISOString());
      }
    },
    [trackLengthMs],
  );
  const manualReset = useCallback(() => {
    setAnchorMs(0);
    setAnchorAt(null);
  }, []);
  const alignLineToCurrentTime = useCallback((lineStartMs: number) => {
    const currentMs = getPlaybackNowMs();
    const nextOffset = clampSyncOffset(currentMs - lineStartMs);
    setOffsetMs(nextOffset);
  }, [getPlaybackNowMs]);

  // video 모드 — videoPlaybackState 변경 시 anchor 재발행.
  // (콘솔이 video 의 currentTime 을 polling-publish 하지 않고, intent change 만 sample)
  useEffect(() => {
    if (playbackSource !== 'video') return;
    const currentTimeSec = useHtml5Player
      ? fallbackVideoRef?.current?.currentTime ?? 0
      : getCurrentTime?.() ?? 0;
    const ms = Math.max(0, currentTimeSec * 1000);
    setAnchorMs(ms);
    if (videoPlaybackState === 'playing') {
      setAnchorAt(new Date().toISOString());
    } else {
      // paused / buffering / ended / unstarted — 정지로 처리. 보간 없음.
      setAnchorAt(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackSource, videoPlaybackState]);

  // video 모드 seek detection — RAF 로 예상 보간값 vs 실제 currentTime 비교.
  useEffect(() => {
    if (playbackSource !== 'video') return;
    if (videoPlaybackState !== 'playing') return;
    let rafId = 0;
    const loop = () => {
      const expectedMs = computeCurrentMs();
      const actualSec = useHtml5Player
        ? fallbackVideoRef?.current?.currentTime ?? 0
        : getCurrentTime?.() ?? 0;
      const actualMs = actualSec * 1000;
      if (Math.abs(actualMs - expectedMs) > VIDEO_SEEK_THRESHOLD_MS) {
        // seek 발생 — anchor 재발행.
        setAnchorMs(actualMs);
        setAnchorAt(new Date().toISOString());
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [
    playbackSource,
    videoPlaybackState,
    useHtml5Player,
    fallbackVideoRef,
    getCurrentTime,
    computeCurrentMs,
  ]);

  const lyrics = data?.lyrics;
  const lines = lyrics?.synced.lines ?? null;
  const hasSynced = !!lines && lines.length > 0;
  const hasKoPron = !!lyrics?.bodyKoPron;
  const hasTranslation = !!lyrics?.bodyTranslation;
  const viewMode: ViewMode = viewModePref ?? (hasSynced ? 'synced' : 'plain');

  // 가사 첫 로드 시점에 곡 언어 기반 default 한 번 적용.
  // - 한글 발음 데이터(`bodyKoPron`) 가 있으면 = 일본어 곡(현재 정책상 ja만 생성).
  //   기본 '전체' + 한글 발음 ON.
  // - 그 외(한국어/기타) → '한 줄씩' (synced 없으면 '전체').
  // 같은 songId 에 대해 한 번만 적용하므로 사용자가 toggle 한 뒤 refetch 되어도
  // 사용자 선택이 덮이지 않는다.
  useEffect(() => {
    if (!lyrics || data?.status !== 'OK') return;
    if (typeof songId !== 'number') return;
    if (appliedDefaultsForSongRef.current === songId) return;
    appliedDefaultsForSongRef.current = songId;

    if (hasKoPron) {
      setViewModePref('plain');
      setShowKoPron(true);
      setShowTranslation(hasTranslation);
    } else {
      setViewModePref(hasSynced ? 'synced' : 'plain');
      setShowKoPron(false);
      setShowTranslation(hasTranslation);
    }
  }, [songId, lyrics, data?.status, hasSynced, hasKoPron, hasTranslation]);

  const koPronLines = useMemo(
    () => splitKoPronLines(lyrics?.bodyKoPron, lines?.length ?? 0),
    [lyrics?.bodyKoPron, lines?.length],
  );

  // mxm tracking pixel/script — pixel/script URL이 바뀔 때만 fire.
  const trackingPixel = lyrics?.tracking.pixel ?? null;
  const trackingScript = lyrics?.tracking.script ?? null;
  useEffect(() => {
    if (trackingPixel) {
      const img = new Image();
      img.src = trackingPixel;
    }
    if (trackingScript) {
      const s = document.createElement('script');
      s.src = trackingScript;
      s.async = true;
      document.body.appendChild(s);
      return () => {
        s.remove();
      };
    }
  }, [trackingPixel, trackingScript]);

  // RAF 루프: anchor 보간으로 active line 계산 + displayMs 갱신.
  // video 모드든 manual 모드든 동일한 보간식 사용 — anchorMs / anchorAt / playbackRate
  // 만 보면 됨.
  useEffect(() => {
    activeIndexRef.current = -1;
    if (viewMode !== 'synced' || !lines || lines.length === 0) {
      return;
    }

    let rafId = 0;
    let computed = 0;
    const loop = () => {
      computed = computeCurrentMs();
      const adjusted = computed - offsetMsRef.current;
      activeIndexRef.current = findActiveLineIndex(lines, adjusted);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    const intervalId = setInterval(() => {
      const next = activeIndexRef.current;
      setActiveIndex((prev) => (prev === next ? prev : next));
      setDisplayMs((prev) => (Math.abs(prev - computed) >= 100 ? computed : prev));
    }, 100);

    return () => {
      cancelAnimationFrame(rafId);
      clearInterval(intervalId);
    };
  }, [viewMode, lines, computeCurrentMs]);

  // active line scroll-into-view
  useEffect(() => {
    if (activeIndex < 0) return;
    const el = lineRefs.current[activeIndex];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIndex]);

  // 외부(다른 콘솔/오버레이가 publish 한) anchor state 적용.
  const applyExternalState = useCallback((state: LyricsPlaybackStateData) => {
    if (state.clientInstanceId === clientInstanceIdRef.current) return;
    if (
      lastAppliedEmittedAtRef.current !== null &&
      state.emittedAt <= lastAppliedEmittedAtRef.current
    ) {
      return;
    }
    lastAppliedEmittedAtRef.current = state.emittedAt;
    applyingFromRemoteRef.current = true;
    setPlaybackSource(state.playbackSource);
    setAnchorMs(state.anchorMs);
    setAnchorAt(state.anchorAt);
    setPlaybackRate(state.playbackRate);
    setOffsetMs(state.offsetMs);
  }, []);

  // 최신 payload ref — heartbeat 가 stale closure 없이 읽음.
  const livePayloadRef = useRef<{
    songRequestId: number | null;
    playbackSource: PlaybackSource;
    anchorMs: number;
    anchorAt: string | null;
    playbackRate: number;
    durationMs: number;
    offsetMs: number;
  } | null>(null);
  livePayloadRef.current = {
    songRequestId: songRequestId ?? null,
    playbackSource,
    anchorMs,
    anchorAt,
    playbackRate,
    durationMs: trackLengthMs,
    offsetMs,
  };

  // intent change 시 debounced 200ms publish.
  useEffect(() => {
    if (mode !== 'publisher') return;
    if (!sessionId) return;
    if (applyingFromRemoteRef.current) {
      applyingFromRemoteRef.current = false;
      return;
    }
    const sid = sessionId;
    const cid = clientInstanceIdRef.current;
    if (!cid) return;
    const payload = {
      songRequestId: songRequestId ?? null,
      playbackSource: playbackSource as ApiLyricsPlaybackSource,
      anchorMs,
      anchorAt,
      playbackRate,
      durationMs: trackLengthMs,
      offsetMs,
      clientInstanceId: cid,
    };
    const timer = setTimeout(() => {
      publishLyricsPlaybackState(sid, payload).catch(() => undefined);
      // recording-worker 의 클립 추출 boundary 정확도용 — 가사 sync intent 변화
      // (anchor 시점, 곡 길이, offset) 를 PostHog 에 캡쳐. heartbeat 는 capture X.
      if (songRequestId) {
        posthog.capture('lyrics_sync_intent_changed', {
          session_id: sid,
          request_id: songRequestId,
          song_id: songId ?? null,
          playback_source: playbackSource,
          anchor_ms: anchorMs,
          anchor_at: anchorAt,
          playback_rate: playbackRate,
          duration_ms: trackLengthMs,
          offset_ms: offsetMs,
        });
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [
    mode,
    sessionId,
    songRequestId,
    songId,
    playbackSource,
    anchorMs,
    anchorAt,
    playbackRate,
    trackLengthMs,
    offsetMs,
  ]);

  // heartbeat republish — 5초마다 현재 sync state 재발행 (overlay socket 재연결 catch-up).
  useEffect(() => {
    if (mode !== 'publisher') return;
    if (!sessionId) return;
    const sid = sessionId;
    const interval = setInterval(() => {
      const cid = clientInstanceIdRef.current;
      const payload = livePayloadRef.current;
      if (!cid || !payload) return;
      publishLyricsPlaybackState(sid, {
        ...payload,
        playbackSource: payload.playbackSource as ApiLyricsPlaybackSource,
        clientInstanceId: cid,
      }).catch(() => undefined);
    }, 5000);
    return () => clearInterval(interval);
  }, [mode, sessionId]);

  // offset 슬라이더 변경 시 debounced 500ms PATCH (곡+영상별 offset 영구 저장).
  // - 곡 진입 직후 setOffsetMs(initial) 만으로는 PATCH 안 함 (initial 과 동일하면 skip).
  // - subscriber 모드(overlay) 는 저장 책임 없음.
  const lastSavedOffsetRef = useRef<number | null>(initialPreferredLyricsOffsetMs ?? null);
  useEffect(() => {
    lastSavedOffsetRef.current = initialPreferredLyricsOffsetMs ?? null;
  }, [songId, initialPreferredLyricsOffsetMs]);
  useEffect(() => {
    if (mode !== 'publisher') return;
    if (typeof songId !== 'number') return;
    if (lastSavedOffsetRef.current === offsetMs) return;
    if (applyingFromRemoteRef.current) return;
    const capturedSongId = songId;
    const capturedOffset = offsetMs;
    const timer = setTimeout(() => {
      patchConsoleSongMetadata(identifier, capturedSongId, {
        preferredLyricsOffsetMs: capturedOffset === 0 ? null : capturedOffset,
      })
        .then(() => {
          lastSavedOffsetRef.current = capturedOffset;
        })
        .catch(() => undefined);
    }, 500);
    return () => clearTimeout(timer);
  }, [mode, songId, identifier, offsetMs]);

  // 가사 source 자동 결정 — 사용자가 명시 토글하지 않았을 때.
  // - 사용자 가사 없음 → main 고정
  // - songId 없음 → mine
  // - Musixmatch 결과가 OK 가 아니면 mine
  // - OK 면 main 우선 (원곡 우선 노출)
  const hasUserLyrics =
    typeof fallbackText === 'string' && fallbackText.length > 0;
  let autoViewSource: ViewSource = 'main';
  if (hasUserLyrics) {
    if (!enabled) {
      autoViewSource = 'mine';
    } else if (isLoading) {
      autoViewSource = 'main';
    } else if (isError || !data || data.status !== 'OK') {
      autoViewSource = 'mine';
    } else {
      autoViewSource = 'main';
    }
  }
  const viewSource: ViewSource = viewSourcePref ?? autoViewSource;

  return {
    enabled,
    isLoading,
    isError,
    error,
    data,
    lyrics: lyrics ?? null,
    fallbackText,
    lines,
    hasSynced,
    hasKoPron,
    hasTranslation,
    viewMode,
    setViewModePref,
    showKoPron,
    setShowKoPron,
    showTranslation,
    setShowTranslation,
    offsetMs,
    setOffsetMs,
    activeIndex,
    lineRefs,
    koPronLines,
    // 재생 컨트롤
    hasVideoSource,
    playbackSource,
    setPlaybackSource,
    displayMs,
    trackLengthMs,
    manualRunning,
    manualPlay,
    manualPause,
    manualSeek,
    manualReset,
    alignLineToCurrentTime,
    // sync broadcast
    applyExternalState,
    clientInstanceId: clientInstanceIdRef.current,
    // view source 탭
    hasUserLyrics,
    viewSource,
    setViewSource: (v: ViewSource) => setViewSourcePref(v),
  };
}

/**
 * 한 줄짜리 toolbar — sticky 헤더 안쪽에 배치하기 위한 inline 버전.
 * status가 OK 가 아니면 아무것도 그리지 않아 헤더가 정렬 깨지지 않게 함.
 */
export function LyricsToolbar({ controller }: { controller: LyricsPanelController }) {
  const {
    data,
    hasSynced,
    hasKoPron,
    hasTranslation,
    viewMode,
    setViewModePref,
    showKoPron,
    setShowKoPron,
    showTranslation,
    setShowTranslation,
    hasUserLyrics,
    viewSource,
    setViewSource,
  } = controller;

  // 원곡 가사 / 내 가사 토글은 사용자 가사가 있을 때만 노출.
  // synced / 한글 발음 등 원곡 가사 한정 컨트롤은 main 탭 + 원곡 가사 OK 일 때만.
  const showSourceToggle = hasUserLyrics;
  const showMainControls = data?.status === 'OK' && viewSource === 'main';

  if (!showSourceToggle && !showMainControls) return null;

  return (
    <TooltipProvider>
      <div className="ml-auto flex items-center gap-2">
        {showSourceToggle && (
          <ToggleGroup
            options={[
              { value: 'main', label: '원곡 가사' },
              { value: 'mine', label: '내 가사' },
            ]}
            value={viewSource}
            onChange={(v) => setViewSource(v as ViewSource)}
          />
        )}
        {showMainControls && hasSynced && (
          <ToggleGroup
            options={[
              { value: 'plain', label: '전체' },
              { value: 'synced', label: '한 줄씩' },
            ]}
            value={viewMode}
            onChange={(v) => setViewModePref(v as ViewMode)}
          />
        )}
        {showMainControls && hasKoPron && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant={showKoPron ? 'default' : 'outline'}
                className="h-6 px-2 text-[11px]"
                onClick={() => setShowKoPron((v) => !v)}
              >
                <Languages className="mr-1 size-3" />
                한글 발음
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">일본어 등 외국어 가사에 한글 발음 표기</TooltipContent>
          </Tooltip>
        )}
        {showMainControls && hasTranslation && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant={showTranslation ? 'default' : 'outline'}
                className="h-6 px-2 text-[11px]"
                onClick={() => setShowTranslation((v) => !v)}
              >
                <Languages className="mr-1 size-3" />
                번역
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">외국어 가사의 한국어 번역 표기</TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}

/**
 * 가사 footer — 한 줄씩(synced) 모드에서 sticky bottom 으로 노출.
 * 영상 source 가 있으면 영상 따라가기/수동 토글, 없으면 수동 컨트롤만.
 * 진행 시간 표시 + seek 진행 바 + 재생/일시정지 + 리셋.
 */
export function LyricsFooter({ controller }: { controller: LyricsPanelController }) {
  const {
    data,
    viewMode,
    viewSource,
    lines,
    hasVideoSource,
    playbackSource,
    setPlaybackSource,
    displayMs,
    trackLengthMs,
    manualRunning,
    manualPlay,
    manualPause,
    manualSeek,
    manualReset,
    offsetMs,
    setOffsetMs,
  } = controller;
  const adjustOffset = useCallback(
    (delta: number) => {
      setOffsetMs((current) => clampSyncOffset(current + delta));
    },
    [setOffsetMs],
  );
  const fastRepeatRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatDelayRef = useRef(220);
  const stopPressRepeat = useCallback(() => {
    if (fastRepeatRef.current) {
      clearTimeout(fastRepeatRef.current);
      fastRepeatRef.current = null;
    }
  }, []);
  const startPressRepeat = useCallback(
    (delta: number) => {
      stopPressRepeat();
      adjustOffset(delta);
      repeatDelayRef.current = 220;
      const tick = () => {
        setOffsetMs((current) => clampSyncOffset(current + delta));
        repeatDelayRef.current = Math.max(45, Math.round(repeatDelayRef.current * 0.82));
        fastRepeatRef.current = setTimeout(tick, repeatDelayRef.current);
      };
      fastRepeatRef.current = setTimeout(tick, 320);
    },
    [adjustOffset, setOffsetMs, stopPressRepeat],
  );
  useEffect(() => stopPressRepeat, [stopPressRepeat]);

  // 원곡 가사 main 탭 + synced + 가사 OK + LRC 라인 있을 때만.
  if (
    viewSource !== 'main' ||
    !data ||
    data.status !== 'OK' ||
    viewMode !== 'synced' ||
    !lines ||
    lines.length === 0
  ) {
    return null;
  }

  const isManual = playbackSource === 'manual';
  const totalMs = trackLengthMs > 0 ? trackLengthMs : (lines[lines.length - 1]?.startMs ?? 0) + 5000;
  const safeDisplay = Math.max(0, Math.min(displayMs, totalMs));
  const offsetLabel = `${offsetMs > 0 ? '+' : ''}${(offsetMs / 1000).toFixed(1)}s`;

  return (
    <TooltipProvider>
      <div className="sticky bottom-0 z-10 border-t bg-background/95 backdrop-blur-sm px-3 py-2 text-[11px] space-y-1.5">
        {/* 1줄: 진행 시간 + seek bar */}
        <div className="flex items-center gap-2">
          <span className="tabular-nums text-muted-foreground w-10 shrink-0 text-center">
            {formatMs(safeDisplay)}
          </span>
          <input
            type="range"
            min={0}
            max={totalMs}
            step={100}
            value={safeDisplay}
            disabled={!isManual}
            onChange={(e) => manualSeek(Number(e.target.value))}
            className={cn(
              'h-1 flex-1 cursor-pointer accent-primary',
              !isManual && 'opacity-60 cursor-default',
            )}
          />
          <span className="tabular-nums text-muted-foreground w-10 shrink-0 text-center">
            {formatMs(totalMs)}
          </span>
        </div>

        {/* 2줄: 재생 컨트롤(왼) + 싱크 컨트롤(오) */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1">
            {isManual && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      className="h-6 w-6 p-0"
                      onClick={() => (manualRunning ? manualPause() : manualPlay())}
                      aria-label={manualRunning ? '일시정지' : '재생'}
                    >
                      {manualRunning ? <Pause className="size-3" /> : <Play className="size-3" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{manualRunning ? '일시정지' : '재생'}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={manualReset}
                      aria-label="처음으로"
                    >
                      <RotateCcw className="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">처음으로</TooltipContent>
                </Tooltip>
              </>
            )}
            {hasVideoSource && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant={isManual ? 'outline' : 'default'}
                    className="h-6 px-2 text-[10px]"
                    onClick={() => {
                      const next: PlaybackSource = isManual ? 'video' : 'manual';
                      setPlaybackSource(next);
                      if (next === 'manual' && !manualRunning) {
                        manualSeek(displayMs);
                      }
                    }}
                  >
                    <Video className="mr-1 size-3" />
                    {isManual ? '영상' : '수동'}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {isManual ? '영상 재생 시점에 가사 동기화' : '영상 무시하고 수동으로 재생/일시정지'}
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* 싱크 컨트롤 */}
          <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onPointerDown={() => startPressRepeat(-SYNC_STEP_MS)}
                  onPointerUp={stopPressRepeat}
                  onPointerLeave={stopPressRepeat}
                  onPointerCancel={stopPressRepeat}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      adjustOffset(-SYNC_STEP_MS);
                    }
                  }}
                  disabled={offsetMs <= SYNC_MIN_MS}
                  aria-label="가사 더 빠르게"
                >
                  <ChevronsLeft className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">가사 더 빠르게 (-0.1s, 길게 누르면 연속 조정)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setOffsetMs(0)}
                  className="tabular-nums text-muted-foreground hover:text-foreground rounded px-1.5 py-0.5 text-[11px] min-w-12 text-center transition-colors"
                  aria-label="싱크 오프셋 리셋"
                >
                  {offsetLabel}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">현재 가사 오프셋 (클릭 = 0으로 리셋)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onPointerDown={() => startPressRepeat(SYNC_STEP_MS)}
                  onPointerUp={stopPressRepeat}
                  onPointerLeave={stopPressRepeat}
                  onPointerCancel={stopPressRepeat}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      adjustOffset(SYNC_STEP_MS);
                    }
                  }}
                  disabled={offsetMs >= SYNC_MAX_MS}
                  aria-label="가사 더 느리게"
                >
                  <ChevronsRight className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">가사 더 느리게 (+0.1s, 길게 누르면 연속 조정)</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * 가사 본문 — toolbar 가 외부 sticky header 로 분리됐으므로 본문만 그린다.
 */
export function LyricsBody({ controller }: { controller: LyricsPanelController }) {
  const {
    enabled,
    isLoading,
    isError,
    error,
    data,
    lyrics,
    fallbackText,
    lines,
    activeIndex,
    lineRefs,
    showKoPron,
    koPronLines,
    showTranslation,
    viewMode,
    viewSource,
    alignLineToCurrentTime,
  } = controller;

  // '내 가사' 탭 — 노래책에 등록된 lyricsText 를 그대로 표시.
  if (viewSource === 'mine') {
    return (
      <div className="space-y-3 px-3 pb-3 pt-3">
        <PlainBody body={fallbackText ?? ''} koPron={null} />
      </div>
    );
  }

  // 이하 '원곡 가사' (main: Musixmatch) 분기.
  if (!enabled) {
    return (
      <div className="px-3 pb-3 pt-3 text-sm text-muted-foreground">
        곡 정보가 없어 가사를 불러올 수 없습니다.
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        가사 불러오는 중…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="space-y-3 px-3 pb-3 pt-3">
        <ErrorBlock message={extractErrorMessage(error)} />
      </div>
    );
  }

  // 가사가 없는/노출 불가 상태는 모두 동일 메시지로 통일.
  // 출처(Musixmatch / 매칭 상태 / 라이선스 제한)를 사용자에게 드러내지 않는다.
  if (data.status !== 'OK') {
    return (
      <div className="space-y-3 px-3 pb-3 pt-3">
        <EmptyHint
          title="아직 가사가 등록되지 않은 곡이에요."
          hint="빠른 시일 내에 준비할게요."
        />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-3 px-3 pb-3 pt-3"
    >
      {viewMode === 'synced' && lines && lines.length > 0 ? (
        <>
          <LyricsSyncHintAlert />
          <SyncedLines
            lines={lines}
            activeIndex={activeIndex}
            lineRefs={lineRefs}
            showKoPron={showKoPron}
            koPronLines={koPronLines}
            showTranslation={showTranslation}
            onLineClick={alignLineToCurrentTime}
          />
        </>
      ) : (
        <PlainBody
          body={lyrics?.body ?? ''}
          koPron={showKoPron ? lyrics?.bodyKoPron : null}
          translation={showTranslation ? lyrics?.bodyTranslation : null}
        />
      )}

      <Attribution lyrics={lyrics} />
    </motion.div>
  );
}

/**
 * Legacy single-component wrapper — controller 분리가 필요 없을 때.
 */
export function LyricsPanel(props: LyricsPanelProps) {
  const controller = useLyricsPanelController(props);
  return (
    <div>
      <div className="px-3 pb-2 pt-3">
        <LyricsToolbar controller={controller} />
      </div>
      <LyricsBody controller={controller} />
    </div>
  );
}

function findActiveLineIndex(lines: { startMs: number }[], cursorMs: number): number {
  if (cursorMs < lines[0]?.startMs) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].startMs <= cursorMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function splitKoPronLines(koPron: string | null | undefined, expectedLineCount: number): string[] | null {
  if (!koPron) return null;
  const split = koPron.split(/\r?\n/);
  return split.length === expectedLineCount ? split : null;
}

function extractErrorMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return '알 수 없는 오류';
}

function ToggleGroup({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex rounded-md border bg-muted p-0.5 text-[11px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded px-1.5 py-0.5 transition-colors',
            value === o.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PlainBody({
  body,
  koPron,
  translation,
}: {
  body: string;
  koPron?: string | null;
  translation?: string | null;
}) {
  const columns = [body, koPron, translation].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  // 외부 section 이 단일 scroll container — 내부에는 max-h / overflow 안 둔다.
  return (
    <div className="rounded-md border bg-card/50 p-3 text-sm leading-relaxed text-muted-foreground">
      {columns.length > 1 ? (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {columns.map((column, index) => (
            <pre
              key={index}
              className={cn(
                'whitespace-pre-wrap font-sans',
                index > 0 && 'text-foreground/80',
              )}
            >
              {column}
            </pre>
          ))}
        </div>
      ) : (
        <pre className="whitespace-pre-wrap font-sans">{body}</pre>
      )}
    </div>
  );
}

function LyricsSyncHintAlert() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(localStorage.getItem(LYRICS_SYNC_HINT_DISMISSED_KEY) !== '1');
    } catch {
      setVisible(true);
    }
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    try {
      localStorage.setItem(LYRICS_SYNC_HINT_DISMISSED_KEY, '1');
    } catch {
      // localStorage 접근이 막힌 환경에서는 현재 세션에서만 닫는다.
    }
  }, []);

  if (!visible) return null;

  return (
    <Alert className="border-amber-300/70 bg-amber-50 pr-10 text-amber-950 dark:border-amber-400/40 dark:bg-amber-950/30 dark:text-amber-100 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-300">
      <AlertTriangle className="size-4" />
      <AlertTitle className="text-amber-950 dark:text-amber-100">
        가사 줄을 눌러 싱크를 맞출 수 있어요
      </AlertTitle>
      <AlertDescription className="text-amber-800 dark:text-amber-200/90">
        노래가 시작되는 순간 해당 가사 줄을 누르면, 현재 영상 시점에 맞춰 싱크가 자동 설정됩니다.
      </AlertDescription>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 size-6 text-amber-700 hover:bg-amber-200/70 hover:text-amber-950 dark:text-amber-200 dark:hover:bg-amber-900/60 dark:hover:text-amber-50"
        onClick={dismiss}
        aria-label="가사 싱크 안내 닫기"
      >
        <X className="size-3.5" />
      </Button>
    </Alert>
  );
}

function SyncedLines({
  lines,
  activeIndex,
  lineRefs,
  showKoPron,
  koPronLines,
  showTranslation,
  onLineClick,
}: {
  lines: Array<{
    startMs: number;
    text: string;
    koPron?: string | null;
    translation?: string | null;
  }>;
  activeIndex: number;
  lineRefs: RefObject<Array<HTMLLIElement | null>>;
  showKoPron: boolean;
  koPronLines: string[] | null;
  showTranslation: boolean;
  onLineClick: (lineStartMs: number) => void;
}) {
  // 외부 section 이 단일 scroll container. 내부 ol 에 overflow 없이 평면 layout.
  // scrollIntoView 는 최근접 scroll ancestor (= 외부 section) 를 자동으로 스크롤.
  return (
    <ol className="space-y-1 rounded-md border bg-card/50 p-3 text-sm">
      {lines.map((line, idx) => {
        const isActive = idx === activeIndex;
        const isPast = idx < activeIndex;
        const koPron = koPronLines?.[idx] ?? line.koPron;
        return (
          <li
            key={idx}
            ref={(el) => {
              lineRefs.current[idx] = el;
            }}
            onClick={() => onLineClick(line.startMs)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onLineClick(line.startMs);
              }
            }}
            className={cn(
              'cursor-pointer rounded px-2 py-1 transition-all duration-150 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              isActive && 'bg-primary/10 text-foreground font-semibold',
              !isActive && isPast && 'text-muted-foreground/60',
              !isActive && !isPast && 'text-muted-foreground',
            )}
          >
            <span>{line.text || ' '}</span>
            {showKoPron && koPron && (
              <span className="ml-2 text-[11px] text-foreground/60">{koPron}</span>
            )}
            {showTranslation && line.translation && (
              <div className="mt-0.5 text-[12px] leading-snug text-foreground/70">
                {line.translation}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Attribution({
  lyrics,
}: {
  lyrics: {
    copyrightLine: string | null;
  } | null;
}) {
  // 가사 본문 제일 밑의 작은 카피라이트 한 줄. 별도 "Powered by Musixmatch"
  // 노출은 의도적으로 제거 (출처를 부각하지 않음). mxm ToS 충족용 copyright
  // line 만 유지.
  if (!lyrics?.copyrightLine) return null;
  return (
    <div className="pt-2 text-[10px] text-muted-foreground/60 text-right">
      {lyrics.copyrightLine}
    </div>
  );
}

function EmptyHint({
  title,
  hint,
  icon: Icon = Music2,
}: {
  title: string;
  hint: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-3 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div>
        <div className="font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="text-destructive">{message}</div>
    </div>
  );
}
