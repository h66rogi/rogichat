'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getOverlayLyrics, type OverlayLyricsLine, type OverlayLyricsResponse } from '@/domains/overlay/apis/lyrics';
import type { OverlayData } from '@/domains/overlay/types/overlay';

/**
 * 통합 anchor 모델 — video / manual 모두 동일.
 *   재생 중: anchorAt 시점에 곡이 anchorMs 위치 → `anchorMs + (now - anchorAt) * playbackRate`
 *   정지: anchorAt = null. anchorMs 가 곧 현재 위치.
 */
export interface LyricsSyncState {
  songRequestId: number | null;
  playbackSource: 'video' | 'manual';
  anchorMs: number;
  anchorAt: string | null;
  playbackRate: number;
  /** 곡 총 길이(ms). nowsong widget progress bar 용. 0 = 미상. */
  durationMs: number;
  offsetMs: number;
}

export type LyricsViewMode = 'three-line' | 'karaoke' | 'full';
export type LyricsDisplayPart = 'original' | 'reading' | 'translation';

const DEFAULT_VIEW_MODE: LyricsViewMode = 'three-line';
const DEFAULT_LYRICS_LINE_ORDER: LyricsDisplayPart[] = [
  'original',
  'reading',
  'translation',
];
const DEFAULT_LYRICS_LINE_VISIBILITY: Record<LyricsDisplayPart, boolean> = {
  original: true,
  reading: true,
  translation: true,
};

export function resolveLyricsViewMode(raw: unknown): LyricsViewMode {
  if (raw === 'karaoke' || raw === 'full' || raw === 'three-line') return raw;
  return DEFAULT_VIEW_MODE;
}

function isLyricsDisplayPart(value: unknown): value is LyricsDisplayPart {
  return value === 'original' || value === 'reading' || value === 'translation';
}

function resolveLyricsDisplayConfig(options?: Record<string, unknown>): {
  order: LyricsDisplayPart[];
  visibility: Record<LyricsDisplayPart, boolean>;
} {
  const rawOrder = options?.lyricsLineOrder;
  const order = Array.isArray(rawOrder)
    ? rawOrder.filter(isLyricsDisplayPart)
    : [];
  const dedupedOrder = Array.from(new Set(order));
  const completeOrder = [
    ...dedupedOrder,
    ...DEFAULT_LYRICS_LINE_ORDER.filter((part) => !dedupedOrder.includes(part)),
  ];

  const visibility = { ...DEFAULT_LYRICS_LINE_VISIBILITY };
  const rawVisibility = options?.lyricsLineVisibility;
  if (
    rawVisibility &&
    typeof rawVisibility === 'object' &&
    !Array.isArray(rawVisibility)
  ) {
    const record = rawVisibility as Record<string, unknown>;
    for (const part of DEFAULT_LYRICS_LINE_ORDER) {
      if (typeof record[part] === 'boolean') {
        visibility[part] = record[part] as boolean;
      }
    }
  }

  if (!completeOrder.some((part) => visibility[part])) {
    visibility.original = true;
  }

  return { order: completeOrder, visibility };
}

export interface LyricsState {
  status: 'waiting' | 'loading' | 'error' | 'unmatched' | 'pending' | 'no-lyrics' | 'unsynced' | 'restricted' | 'instrumental' | 'ok';
  message: string | null;
  lyrics: OverlayLyricsResponse['lyrics'] | null;
  lines: OverlayLyricsLine[] | null;
  hasSynced: boolean;
  activeIndex: number;
  lineRefs: React.MutableRefObject<Array<HTMLLIElement | null>>;
  isWaiting: boolean;
  shouldHide: boolean;
}

/**
 * 14개 테마 공용 lyrics 데이터 hook.
 *
 * - data.nowPlaying.song.id 자동 fetch
 * - data.lyricsSync (page.tsx inject) anchor 모델로 active line 추적.
 *   video / manual 구분 없이 `anchorMs / anchorAt / playbackRate` 만 보면 됨.
 * - sync == null 시 active=-1 강제 (waiting)
 * - mxm tracking pixel auto fire
 * - scrollIntoView active line (three-line/full)
 */
export function useLyricsState(
  data: OverlayData | undefined | null,
  options?: Record<string, unknown>,
): LyricsState {
  const hideWhenEmpty = (options?.lyricsHideWhenEmpty as boolean | undefined) !== false;
  const viewMode = resolveLyricsViewMode(options?.lyricsViewMode);
  const params = useParams();
  const token = (params?.token as string | undefined) ?? '';

  const nowPlaying = data?.nowPlaying as
    | {
        id?: number | null;
        songId?: number | null;
        song?: { id?: number | null } | null;
      }
    | null
    | undefined;
  const songId =
    nowPlaying?.song?.id ??
    (typeof nowPlaying?.songId === 'number' ? nowPlaying.songId : null);

  const lyricsSync = (data as { lyricsSync?: LyricsSyncState | null } | undefined)
    ?.lyricsSync ?? null;

  const { data: lyricsData, isLoading, error } = useQuery({
    queryKey: ['overlay-lyrics', token, songId],
    queryFn: () => getOverlayLyrics(token, songId as number),
    enabled: !!token && typeof songId === 'number',
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // mxm tracking pixel
  const trackingPixel = lyricsData?.lyrics?.tracking.pixel ?? null;
  useEffect(() => {
    if (trackingPixel) {
      const img = new Image();
      img.src = trackingPixel;
    }
  }, [trackingPixel]);

  const lyrics = decorateLyricsForDisplay(lyricsData?.lyrics ?? null, options);
  const lines = lyrics?.synced.lines ?? null;
  const hasSynced = !!lines && lines.length > 0;

  // RAF active index — anchor 보간으로 active line 결정.
  // video / manual 모두 동일한 식: anchorAt ? anchorMs + (now - anchorAt) * rate : anchorMs.
  const [activeIndex, setActiveIndex] = useState(-1);
  const activeIndexRef = useRef(-1);
  const lineRefs = useRef<Array<HTMLLIElement | null>>([]);
  const syncRef = useRef(lyricsSync);
  useEffect(() => {
    syncRef.current = lyricsSync;
  }, [lyricsSync]);

  useEffect(() => {
    activeIndexRef.current = -1;
    if (!hasSynced || !lines) {
      if (activeIndex !== -1) setActiveIndex(-1);
      return;
    }
    let rafId = 0;
    const loop = () => {
      const sync = syncRef.current;
      if (sync == null) {
        activeIndexRef.current = -1;
        rafId = requestAnimationFrame(loop);
        return;
      }
      const rawMs = computeAnchorMs(sync);
      const adjusted = rawMs - sync.offsetMs;
      activeIndexRef.current = findActiveLineIndex(lines, adjusted);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    const intervalId = setInterval(() => {
      const next = activeIndexRef.current;
      setActiveIndex((prev) => (prev === next ? prev : next));
    }, 100);
    return () => {
      cancelAnimationFrame(rafId);
      clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSynced, lines]);

  // scrollIntoView — 테마 useEffect 대신 hook 안으로 통합
  useEffect(() => {
    if (viewMode === 'karaoke') return;
    if (!hasSynced || !lines || lines.length === 0) return;
    const target = activeIndex < 0 ? 0 : activeIndex;
    const el = lineRefs.current[target];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIndex, viewMode, hasSynced, lines]);

  // status 결정
  if (typeof songId !== 'number') {
    return emptyState({ status: 'waiting', message: '(리모컨에서 영상이나 가사를 재생시켜주세요)', lineRefs, hideWhenEmpty });
  }
  if (error) {
    return emptyState({ status: 'error', message: '가사를 불러올 수 없습니다', lineRefs, hideWhenEmpty });
  }
  if (isLoading || !lyricsData) {
    return emptyState({ status: 'loading', message: '가사 불러오는 중…', lineRefs, hideWhenEmpty });
  }
  if (lyricsData.status !== 'OK' || !lyrics) {
    return emptyState({
      status: lyricsData.status === 'RESTRICTED' ? 'restricted' :
        lyricsData.status === 'INSTRUMENTAL' ? 'instrumental' :
        lyricsData.status === 'NO_LYRICS' ? 'no-lyrics' :
        lyricsData.status === 'PENDING_LYRICS' ? 'pending' :
        'unmatched',
      message: statusMessage(lyricsData.status),
      lineRefs,
      hideWhenEmpty,
    });
  }
  if (!hasSynced || !lines) {
    // The public OBS widget is a timed-lyrics surface. Plain body text is
    // available to the management console, but rendering it here produces a
    // non-advancing full-text panel (and an overflow scrollbar) instead of a
    // real-time overlay. Keep unsynced lyrics on the empty-state path even
    // when the API response contains a non-empty body.
    return emptyState({
      status: 'unsynced',
      message: '실시간 가사를 지원하지 않는 곡입니다',
      lineRefs,
      hideWhenEmpty,
    });
  }

  return {
    status: 'ok',
    message: null,
    lyrics,
    lines,
    hasSynced,
    activeIndex,
    lineRefs,
    isWaiting: activeIndex < 0,
    shouldHide: false,
  };
}

function decorateLyricsForDisplay(
  lyrics: OverlayLyricsResponse['lyrics'] | null,
  options?: Record<string, unknown>,
): OverlayLyricsResponse['lyrics'] | null {
  if (!lyrics) return null;
  const config = resolveLyricsDisplayConfig(options);
  const decoratedBody = decoratePlainBody(
    {
      original: lyrics.body,
      reading: lyrics.bodyKoPron,
      translation: lyrics.bodyTranslation,
    },
    config,
  );
  const decoratedLines = lyrics.synced.lines?.map((line) => {
    const text = buildLyricsDisplayText(
      {
        original: line.text,
        reading: line.koPron,
        translation: line.translation,
      },
      config,
      '\n',
    );
    return {
      ...line,
      text: text || ' ',
    };
  }) ?? null;

  return {
    ...lyrics,
    body: decoratedBody,
    synced: {
      ...lyrics.synced,
      lines: decoratedLines,
    },
  };
}

function decoratePlainBody(
  values: Record<LyricsDisplayPart, string | null>,
  config: {
    order: LyricsDisplayPart[];
    visibility: Record<LyricsDisplayPart, boolean>;
  },
): string {
  return buildLyricsDisplayText(values, config, '\n\n');
}

function buildLyricsDisplayText(
  values: Record<LyricsDisplayPart, string | null>,
  config: {
    order: LyricsDisplayPart[];
    visibility: Record<LyricsDisplayPart, boolean>;
  },
  separator: string,
): string {
  const lines = config.order
    .filter((part) => config.visibility[part])
    .map((part) => values[part])
    .filter(
      (value): value is string =>
        typeof value === 'string' && value.trim().length > 0,
    );
  return lines.join(separator);
}

/**
 * anchor 보간식 — useLyricsState 외에 nowsong widget progress bar 도 같은 식 사용.
 * video / manual 모두 동일. 정지 상태(anchorAt = null)면 anchorMs 그대로 반환.
 */
export function computeAnchorMs(sync: LyricsSyncState): number {
  if (sync.anchorAt && sync.playbackRate > 0) {
    const elapsed = Date.now() - Date.parse(sync.anchorAt);
    return sync.anchorMs + elapsed * sync.playbackRate;
  }
  return sync.anchorMs;
}

export function isPlainBodyAvailable(state: LyricsState): boolean {
  return state.status === 'ok' && !!state.lyrics?.body && !state.hasSynced;
}

function emptyState(opts: {
  lineRefs: React.MutableRefObject<Array<HTMLLIElement | null>>;
  status: LyricsState['status'];
  message: string;
  hideWhenEmpty: boolean;
}): LyricsState {
  return {
    status: opts.status,
    message: opts.message,
    lyrics: null,
    lines: null,
    hasSynced: false,
    activeIndex: -1,
    lineRefs: opts.lineRefs,
    isWaiting: true,
    shouldHide: opts.hideWhenEmpty,
  };
}

function statusMessage(status: string): string {
  switch (status) {
    case 'UNLINKED':
    case 'UNMATCHED':
    case 'PENDING_LYRICS':
      return '가사 매칭 중…';
    case 'NO_LYRICS':
      return '등록된 가사가 없습니다';
    case 'RESTRICTED':
      return '저작권 사유로 표시 불가';
    case 'INSTRUMENTAL':
      return '연주곡';
    case 'ERROR':
    default:
      return '가사를 불러올 수 없습니다';
  }
}

function findActiveLineIndex(lines: OverlayLyricsLine[], ms: number): number {
  if (lines.length === 0) return -1;
  if (ms < lines[0].startMs) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (lines[mid].startMs <= ms) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
