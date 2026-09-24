'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getOverlayData } from '@/domains/overlay/apis/overlay';
import { useOverlay, overlayKeys } from '@/domains/overlay/hooks/use-overlay';
import { useSyncIdRefetch } from '@/domains/overlay/hooks/use-sync-id-refetch';
import { useAnchorState } from '@/domains/overlay/hooks/use-anchor-state';
import {
  useOverlaySocket,
  type SongRequest,
  type RandomSlotCandidate,
} from '@/domains/overlay/hooks/use-overlay-socket';
import { RandomSlotMachine } from '@/domains/overlay/components/random-slot/RandomSlotMachine';
import { computeAnchorMs } from '@/domains/overlay/themes/shared';
import {
  DEFAULT_TOTAL_OVERLAY_LAYOUT,
  type TotalOverlayLayout,
  type TotalOverlayWidgetId,
} from '@/domains/overlay/constants/total-layout';
import {
  OVERLAY_BACKUP_SYNC_INTERVAL_MS,
  OVERLAY_BACKUP_SYNC_MAX_INTERVAL_MS,
  OVERLAY_SYNC_RESPONSE_TIMEOUT_MS,
} from '@/domains/overlay/constants/realtime-sync';
import {
  useThemeLoader,
  useReducedMotion,
} from '@/domains/overlay/themes/shared';
import { DEFAULT_FALLBACK_THEME_ID } from '@/domains/overlay/themes/registry';
import { AutoScrollContainer } from '@/domains/overlay/components/shared/AutoScrollContainer';
import {
  OverlayToastLayer,
  useOverlayToastController,
} from '@/domains/overlay/components/shared/OverlayToastLayer';
import { CanvasSizeNotice } from '@/domains/overlay/components/shared/CanvasSizeNotice';
import { TextStrokeWrapper } from '@/domains/overlay/components/TextStrokeWrapper';
import {
  PlaybackProgressProvider,
  usePlaybackProgress,
  useSetPlaybackProgress,
} from '@/domains/overlay/contexts/playback-progress-context';
import {
  ChatMessagesProvider,
  useChatMessages,
  useChatMessagesActions,
} from '@/domains/overlay/contexts/chat-messages-context';
import type { ThemeWidgetProps } from '@/domains/overlay/themes/types';
import { useWidgetCustomCss, type OverlayWidgetType } from '@/domains/overlay/hooks/use-widget-custom-css';
import { CustomCssInjector } from '@/domains/overlay/components/CustomCssInjector';
import { SongbookQrWidget } from '@/domains/overlay/components/songbook-qr/SongbookQrWidget';
import { mergeQueueSyncIntoOverlayData } from '@/domains/overlay/utils/merge-queue-sync-into-overlay-data';
import { resolveQueueSyncNowPlaying } from '@/domains/overlay/utils/playback-snapshot';
import { isAuthoritativePlaybackEnabled } from '@/domains/overlay/utils/snapshot-reader-flag';
import { useAuthoritativePlayback } from '@/domains/overlay/hooks/use-snapshot-reader';

function readBooleanOption(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === '1';
  if (typeof value === 'number') return value !== 0;
  return false;
}
import type {
  OverlayData,
  OverlayOmakase,
  SongRequest as ApiSongRequest,
} from '@/domains/overlay/types/overlay';

const BASE_SYNC_INTERVAL_MS = OVERLAY_BACKUP_SYNC_INTERVAL_MS;
const MAX_SYNC_INTERVAL_MS = OVERLAY_BACKUP_SYNC_MAX_INTERVAL_MS;
const SYNC_RESPONSE_TIMEOUT_MS = OVERLAY_SYNC_RESPONSE_TIMEOUT_MS;
const NOW_PLAYING_CLEAR_GRACE_MS = 1200;
const LAYOUT_RECONCILE_DELAY_MS = 1200;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

// Local data shape for the queue state. The realtime `SongRequest` payloads
// from `useOverlaySocket` are flattened into this structure, then mapped back
// to `ApiSongRequest` when building per-widget OverlayData slices for themes.
type QueueItem = {
  id: number;
  title: string;
  artist: string;
  requester: string;
  position: number;
  isDonation?: boolean;
  donationAmount?: number | null;
  isHomework?: boolean;
  isRandom?: boolean;
  albumArt?: string | null;
};

// Local data shape for the now-playing state. Same rationale as `QueueItem`.
type NowPlayingData = {
  id: number;
  songId?: number | null;
  title: string;
  artist: string;
  albumArt?: string;
  requester?: string;
  isDonation?: boolean;
  donationAmount?: number;
  isHomework?: boolean;
  isRandom?: boolean;
};

// Local data shape for setlist items. Mirrors the standalone setlist widget.
// setlist includes COMPLETED + PLAYING + PENDING + ACCEPTED (REJECTED filtered out).
type SetlistItem = {
  id: number;
  title: string;
  artist: string;
  requester: string;
  position: number;
  status: 'PENDING' | 'ACCEPTED' | 'PLAYING' | 'COMPLETED' | 'REJECTED';
  isDonation?: boolean;
  donationAmount?: number;
  isHomework?: boolean;
  albumArt?: string;
  formattedPrice?: string;
  calculatedPrice?: number | null;
  priceSource?: string | null;
};

function socketStatusToSetlistStatus(
  status: SongRequest['status'],
): SetlistItem['status'] {
  switch (status) {
    case 'pending':
      return 'PENDING';
    case 'accepted':
      return 'ACCEPTED';
    case 'playing':
      return 'PLAYING';
    case 'completed':
      return 'COMPLETED';
    case 'rejected':
    default:
      return 'REJECTED';
  }
}

function socketRequestToSetlistItem(r: SongRequest): SetlistItem {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    requester: r.requester,
    position: r.position,
    status: socketStatusToSetlistStatus(r.status),
    isDonation: r.isDonation,
    donationAmount: r.donationAmount,
    isHomework: r.isHomework,
    albumArt: r.albumArt,
  };
}

function socketRequestToNowPlayingData(r: SongRequest): NowPlayingData {
  return {
    id: r.id,
    songId: r.songId ?? null,
    title: r.title,
    artist: r.artist,
    albumArt: r.albumArt,
    requester: r.requester,
    isDonation: r.isDonation,
    donationAmount: r.donationAmount,
    isHomework: r.isHomework,
    isRandom: r.isRandom,
  };
}

function anyRequestToNowPlayingData(r: any): NowPlayingData {
  const requestType =
    typeof r?.requestType === 'string' ? r.requestType : undefined;
  const source = typeof r?.source === 'string' ? r.source : undefined;
  const rawSongId = r?.songId ?? r?.song?.id;
  const songId =
    typeof rawSongId === 'number' || typeof rawSongId === 'string'
      ? Number(rawSongId)
      : null;
  return {
    id: r.id,
    songId: Number.isFinite(songId) ? songId : null,
    title: r.song?.title || r.rawTitle || r.title,
    artist: r.song?.artist?.name || r.rawArtist || r.artist,
    albumArt: r.song?.albumArt ?? r.albumArt,
    requester: r.requesterNickname || r.requester || '',
    isDonation: r.isDonation ?? ((r.donationAmount ?? 0) > 0),
    donationAmount: r.donationAmount ?? undefined,
    isHomework: r.isHomework ?? (source?.toUpperCase() === 'HOMEWORK'),
    isRandom: r.isRandom === true || requestType?.toUpperCase() === 'RANDOM',
  };
}

function nowPlayingDataToApiRequest(nowPlaying: NowPlayingData): ApiSongRequest {
  const songId =
    typeof nowPlaying.songId === 'number' && nowPlaying.songId > 0
      ? nowPlaying.songId
      : null;
  return {
    id: nowPlaying.id,
    rawArtist: nowPlaying.artist,
    rawTitle: nowPlaying.title,
    requesterNickname: nowPlaying.requester ?? '',
    status: 'PLAYING' as const,
    donationAmount: nowPlaying.donationAmount,
    isHomework: nowPlaying.isHomework,
    isRandom: nowPlaying.isRandom,
    queueOrder: 0,
    song: songId || nowPlaying.albumArt
      ? ({
          id: songId ?? 0,
          title: nowPlaying.title,
          artist: { name: nowPlaying.artist },
          albumArt: nowPlaying.albumArt,
        } as ApiSongRequest['song'])
      : undefined,
  };
}

function apiRequestToSetlistItem(r: any, idx: number): SetlistItem {
  const status = (r.status?.toUpperCase?.() ?? r.status) as SetlistItem['status'];
  return {
    id: r.id,
    title: r.song?.title || r.rawTitle || r.title,
    artist: r.song?.artist?.name || r.rawArtist || r.artist,
    requester: r.requesterNickname || r.requester,
    position: r.queueOrder ?? r.position ?? idx + 1,
    status,
    isDonation: r.isDonation ?? !!r.donationAmount,
    donationAmount: r.donationAmount,
    isHomework: r.isHomework ?? r.source === 'HOMEWORK',
    albumArt: r.song?.albumArt ?? r.albumArt,
    formattedPrice: r.formattedPrice,
    calculatedPrice: r.calculatedPrice,
    priceSource: r.priceSource,
  };
}

// PlaybackProgress type now lives in `domains/overlay/components/now-playing/types.ts`
// and is consumed via PlaybackProgressContext (see `usePlaybackProgress`/
// `useSetPlaybackProgress`). The local alias was removed when progress state
// moved out of this component.

function mergeLayout(layout?: Record<string, unknown> | null): TotalOverlayLayout {
  if (!layout || typeof layout !== 'object') {
    return DEFAULT_TOTAL_OVERLAY_LAYOUT;
  }

  const parsed = layout as Partial<TotalOverlayLayout>;
  const widgets = Array.isArray(parsed.widgets) ? parsed.widgets : [];
  const defaultWidgetIds = new Set(
    DEFAULT_TOTAL_OVERLAY_LAYOUT.widgets.map((widget) => widget.id),
  );
  const widgetMap = new Map(
    widgets
      .filter((widget) => widget && typeof (widget as any).id === 'string')
      .map((widget) => [(widget as any).id, widget]),
  );

  const mergedWidgets = DEFAULT_TOTAL_OVERLAY_LAYOUT.widgets.map((widget) => ({
    ...widget,
    ...(widgetMap.get(widget.id) as any),
  }));

  const extraWidgets = widgets.filter(
    (widget) =>
      widget &&
      typeof (widget as any).id === 'string' &&
      !defaultWidgetIds.has((widget as any).id),
  );

  return {
    ...DEFAULT_TOTAL_OVERLAY_LAYOUT,
    ...parsed,
    widgets: [...mergedWidgets, ...extraWidgets] as any,
  };
}

function readLayoutRevision(source: unknown): number | null {
  if (!source || typeof source !== 'object') {
    return null;
  }
  const record = source as {
    layoutVersion?: unknown;
    totalLayoutVersion?: unknown;
  };
  const raw = record.layoutVersion ?? record.totalLayoutVersion;
  if (raw === undefined || raw === null) {
    return null;
  }
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}

/**
 * Tiny bridge component that lives between `renderWidget()` and a theme's
 * Now Playing component. It subscribes to PlaybackProgressContext so only
 * this subtree re-renders when WS `playback.progress` events fire (~1Hz).
 *
 * The other sub-widgets (queue / chatbox / setlist) never mount this bridge
 * and never read the context, so they're unaffected by progress ticks.
 */
function NowPlayingProgressBridge({
  NpThemeWidget,
  data,
  options,
  animations,
  fonts,
  reducedMotion,
  connectionStatus,
}: {
  NpThemeWidget: ComponentType<ThemeWidgetProps>;
} & Omit<ThemeWidgetProps, 'playbackProgress' | 'chatMessages'>) {
  const playbackProgress = usePlaybackProgress();
  return (
    <NpThemeWidget
      data={data}
      options={options}
      animations={animations}
      fonts={fonts}
      reducedMotion={reducedMotion}
      connectionStatus={connectionStatus}
      playbackProgress={playbackProgress}
    />
  );
}

/**
 * Tiny bridge component that lives between `renderWidget()` and a theme's
 * Chatbox component. It subscribes to ChatMessagesContext so only this
 * subtree re-renders when WS `chat.message` / `chat.donation` events fire.
 *
 * The other sub-widgets (queue / now-playing / setlist) never mount this
 * bridge and never read the context, so they're unaffected by chat bursts.
 */
function ChatboxBridge({
  ChatThemeWidget,
  data,
  options,
  animations,
  fonts,
  reducedMotion,
  connectionStatus,
}: {
  ChatThemeWidget: ComponentType<ThemeWidgetProps>;
} & Omit<ThemeWidgetProps, 'playbackProgress' | 'chatMessages'>) {
  const chatMessages = useChatMessages();
  return (
    <ChatThemeWidget
      data={data}
      options={options}
      animations={animations}
      fonts={fonts}
      reducedMotion={reducedMotion}
      chatMessages={chatMessages}
      connectionStatus={connectionStatus}
    />
  );
}

export default function TotalOverlayWidgetPage() {
  // Two providers own the high-frequency state slices:
  //   - PlaybackProgressProvider: ~1Hz `playback.progress` ticks
  //   - ChatMessagesProvider: chat / donation event bursts
  // The inner content reads/writes via context hooks; only the small
  // bridge components subscribe to the values, so neither stream
  // re-renders the rest of the overlay.
  return (
    <PlaybackProgressProvider>
      <ChatMessagesProvider>
        <TotalOverlayContent />
      </ChatMessagesProvider>
    </PlaybackProgressProvider>
  );
}

function TotalOverlayContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = params.token as string;
  const isPreviewMode = searchParams.get('preview') === '1';

  const [totalLayout, setTotalLayout] = useState<TotalOverlayLayout>(
    DEFAULT_TOTAL_OVERLAY_LAYOUT,
  );
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [nowPlaying, setNowPlaying] = useState<NowPlayingData | null>(null);
  /**
   * 랜덤 신청 슬롯머신 상태. request.added 가 isRandom + randomSlotCandidates 동봉해 도착하면
   * 활성화되고, 슬롯 회전+winner 강조 후 onDismiss 콜백으로 null 로 리셋.
   * 동시에 여러 랜덤 신청이 들어오면 가장 최근 것이 덮어쓴다 (단일 슬롯 화면).
   *
   * pendingRequest: 슬롯이 dismiss 될 때까지 queue/setlist 추가를 보류한 SongRequest. 슬롯 끝나면
   * onDismiss 안에서 flush. 슬롯 자체가 뜨지 않은 케이스(슬롯 candidates 없음)에서는
   * 일반 신청 흐름을 그대로 타 즉시 큐에 들어간다.
   */
  const [randomSlot, setRandomSlot] = useState<{
    requestId: number;
    candidates: RandomSlotCandidate[];
    requester: string;
    pendingRequest: SongRequest;
  } | null>(null);

  // 슬롯 종료 시(또는 fallback timeout) 보류했던 SongRequest 를 queue/setlist 에 flush.
  // 슬롯 활성 중에는 큐 표시를 보류하므로, dismiss 가 어떤 이유로든 안 오는 경우(예: 컴포넌트
  // mount 실패) 대비해 fallback timeout 으로도 같은 flush 가 한 번 더 보장된다.
  const handleRandomSlotDismiss = useCallback(() => {
    setRandomSlot((current) => {
      if (!current) return null;
      const pending = current.pendingRequest;
      if (pending.status === 'pending') {
        setQueue((prev) => {
          const newItem: QueueItem = {
            id: pending.id,
            title: pending.title,
            artist: pending.artist,
            requester: pending.requester,
            position: pending.position,
            isDonation: pending.isDonation,
            donationAmount: pending.donationAmount,
            isHomework: pending.isHomework,
            isRandom: pending.isRandom,
            albumArt: pending.albumArt,
          };
          return [
            ...prev.filter((item) => item.id !== pending.id),
            newItem,
          ].sort((a, b) => a.position - b.position);
        });
      }
      setSetlist((prev) => {
        if (prev.some((item) => item.id === pending.id)) return prev;
        return [...prev, socketRequestToSetlistItem(pending)].sort(
          (a, b) => a.position - b.position,
        );
      });
      return null;
    });
  }, []);

  // Fallback timeout — 슬롯이 어떤 이유로든 dismiss 콜백을 트리거하지 못한 채 머무는 상황
  // 대비. 슬롯 자체 spin(2s) + landed(1.4s) = 3.4s 이므로 5s 안에 dismiss 가 안 오면 강제 flush.
  // onDismiss 가 정상 발생하면 setRandomSlot(null) 로 인해 cleanup 이 timeout 을 clear.
  useEffect(() => {
    if (!randomSlot) return;
    const id = setTimeout(handleRandomSlotDismiss, 5000);
    return () => clearTimeout(id);
  }, [randomSlot, handleRandomSlotDismiss]);
  const nowPlayingIdRef = useRef<number | null>(null);
  const currentSessionIdRef = useRef<number | null>(null);
  const totalLayoutRevisionRef = useRef<number | null>(null);
  // Progress state lives in PlaybackProgressProvider. We only need the
  // setter here — never the value — so this component is unaffected by
  // anchor 보간 tick. (legacy 1Hz playback.progress 폐기, 100ms 보간으로 부드러움)
  const setPlaybackProgress = useSetPlaybackProgress();
  // ChatMessagesProvider owns chat buffer state. We only need actions here —
  // never the value — so this component is unaffected by chat bursts.
  const chatActions = useChatMessagesActions();
  const [setlist, setSetlist] = useState<SetlistItem[]>([]);
  const [liveSettings, setLiveSettings] = useState<Record<string, unknown> | null>(null);
  const [liveOmakase, setLiveOmakase] = useState<OverlayOmakase | null>(null);
  // Live theme overrides per sub-widget — set by `theme-config.updated` WebSocket events.
  const [liveQueueThemeOverride, setLiveQueueThemeOverride] = useState<string | null>(null);
  const [liveNpThemeOverride, setLiveNpThemeOverride] = useState<string | null>(null);
  const [liveChatThemeOverride, setLiveChatThemeOverride] = useState<string | null>(null);
  const [liveSetlistThemeOverride, setLiveSetlistThemeOverride] = useState<string | null>(null);
  const [liveLyricsThemeOverride, setLiveLyricsThemeOverride] = useState<string | null>(null);
  const [liveSongbookQrThemeOverride, setLiveSongbookQrThemeOverride] = useState<
    string | null
  >(null);
  // Live resolvedOptions per sub-widget — set by `theme-config.updated` WebSocket events.
  const [liveQueueResolvedOptions, setLiveQueueResolvedOptions] = useState<
    Record<string, unknown> | null
  >(null);
  const [liveNpResolvedOptions, setLiveNpResolvedOptions] = useState<
    Record<string, unknown> | null
  >(null);
  const [liveChatResolvedOptions, setLiveChatResolvedOptions] = useState<
    Record<string, unknown> | null
  >(null);
  const [liveSetlistResolvedOptions, setLiveSetlistResolvedOptions] = useState<
    Record<string, unknown> | null
  >(null);
  const [liveLyricsResolvedOptions, setLiveLyricsResolvedOptions] = useState<
    Record<string, unknown> | null
  >(null);
  const [liveSongbookQrResolvedOptions, setLiveSongbookQrResolvedOptions] = useState<
    Record<string, unknown> | null
  >(null);
  // lyrics sync state — useAnchorState 가 emittedAt + nowPlayingId mismatch
  // race 둘 다 처리. SharedLyricsWidget + PlaybackProgressContext 동일 source.
  const {
    lyricsSyncState,
    applyIncoming: applyLyricsAnchor,
    reset: resetLyricsAnchor,
  } = useAnchorState(nowPlaying?.id ?? null);
  // anchor → playbackProgress 보간 (100ms throttle).
  // legacy ~1Hz playback.progress 대신 anchor + Date.now() 기반 부드러운 진행.
  // songRequestId mismatch (anchor 의 곡과 nowPlaying 의 곡이 다름) 시 skip —
  // 곡 전환 직후 잠깐 stale anchor 가 흘러들어와 잘못된 progress 표시되는 것 방지.
  useEffect(() => {
    if (!lyricsSyncState) return;
    const sync = lyricsSyncState;
    const tick = () => {
      const currentId = nowPlayingIdRef.current;
      if (sync.songRequestId && currentId && sync.songRequestId !== currentId) {
        return;
      }
      const currentMs = computeAnchorMs(sync);
      const currentTime = currentMs / 1000;
      const duration = sync.durationMs / 1000;
      const state = sync.anchorAt ? 'playing' : 'paused';
      const percentage =
        duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
      setPlaybackProgress({
        currentTime,
        duration,
        state,
        percentage,
      });
    };
    tick();
    const intervalId = setInterval(tick, 100);
    return () => clearInterval(intervalId);
  }, [lyricsSyncState, setPlaybackProgress]);
  const [hasRealtimeLiveSignal, setHasRealtimeLiveSignal] = useState(false);
  const [sessionLive, setSessionLive] = useState(false);
  const [isOverlayReady, setIsOverlayReady] = useState(false);

  const initialLoadedRef = useRef(false);
  const syncIntervalRef = useRef(BASE_SYNC_INTERVAL_MS);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSyncRef = useRef(false);
  const layoutReconcileTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSyncRef = useRef<
    ((reason?: string, sessionId?: number | null) => void) | null
  >(null);
  const isJoinedRef = useRef(false);
  const nowPlayingClearTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const nowPlayingClearGenerationRef = useRef(0);
  const nullNowPlayingSyncRef = useRef<{
    targetId: number;
    confirmations: number;
    terminalObserved: boolean;
  } | null>(null);

  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const updateCanvasSize = () => {
      if (!containerRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      setCanvasSize((prev) => {
        if (prev.width === width && prev.height === height) {
          return prev;
        }
        return { width, height };
      });
    };

    updateCanvasSize();

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.target.getBoundingClientRect();
      setCanvasSize((prev) => {
        if (prev.width === width && prev.height === height) {
          return prev;
        }
        return { width, height };
      });
    });
    observer.observe(containerRef.current);
    window.addEventListener('resize', updateCanvasSize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, []);

  // nowPlayingIdRef 는 setNowPlaying 호출 사이트마다 동기 set (1-render stale
  // 윈도우 제거). useEffect 패턴은 anchor tick guard 가 새 곡 anchor 를 잘못
  // suppress 하는 회귀 발생 — feature-dev review C1 지적.
  // 안전망으로 effect 도 유지 (혹시 누락된 사이트 보강).
  useEffect(() => {
    nowPlayingIdRef.current = nowPlaying?.id ?? null;
  }, [nowPlaying?.id]);

  useEffect(() => {
    return () => {
      if (nowPlayingClearTimerRef.current) {
        clearTimeout(nowPlayingClearTimerRef.current);
        nowPlayingClearTimerRef.current = null;
      }
      if (layoutReconcileTimerRef.current) {
        clearTimeout(layoutReconcileTimerRef.current);
        layoutReconcileTimerRef.current = null;
      }
    };
  }, []);

  function scheduleNextSync(delayMs: number) {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
    }
    if (!isJoinedRef.current || !requestSyncRef.current) {
      return;
    }
    syncTimerRef.current = setTimeout(() => {
      triggerSync('interval');
    }, delayMs);
  }

  function handleSyncSuccess() {
    pendingSyncRef.current = false;
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    syncIntervalRef.current = BASE_SYNC_INTERVAL_MS;
    scheduleNextSync(syncIntervalRef.current);
  }

  function handleSyncError() {
    pendingSyncRef.current = false;
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    syncIntervalRef.current = Math.min(
      MAX_SYNC_INTERVAL_MS,
      Math.max(BASE_SYNC_INTERVAL_MS, Math.round(syncIntervalRef.current * 1.8)),
    );
    scheduleNextSync(syncIntervalRef.current);
  }

  function triggerSync(reason: string) {
    if (!requestSyncRef.current) {
      return;
    }
    pendingSyncRef.current = true;
    requestSyncRef.current(reason);
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    syncTimeoutRef.current = setTimeout(() => {
      if (pendingSyncRef.current) {
        handleSyncError();
      }
    }, SYNC_RESPONSE_TIMEOUT_MS);
  }

  function rememberLayoutRevision(source: unknown) {
    const revision = readLayoutRevision(source);
    if (
      revision !== null &&
      (totalLayoutRevisionRef.current === null ||
        revision >= totalLayoutRevisionRef.current)
    ) {
      totalLayoutRevisionRef.current = revision;
    }
  }

  function shouldIgnoreOlderLayoutSnapshot(source: unknown): boolean {
    const revision = readLayoutRevision(source);
    if (totalLayoutRevisionRef.current === null) {
      return false;
    }
    return revision === null || revision < totalLayoutRevisionRef.current;
  }

  function applyTotalLayoutSnapshot(
    layout: Record<string, unknown> | null | undefined,
    source?: unknown,
  ): boolean {
    if (!layout) {
      return false;
    }
    if (source && shouldIgnoreOlderLayoutSnapshot(source)) {
      return false;
    }
    setTotalLayout(mergeLayout(layout));
    if (source) {
      rememberLayoutRevision(source);
    }
    return true;
  }

  function scheduleLayoutReconcile() {
    if (layoutReconcileTimerRef.current) {
      clearTimeout(layoutReconcileTimerRef.current);
    }
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const fresh = await queryClient.fetchQuery({
            queryKey: overlayKeys.data(token),
            queryFn: () => getOverlayData(token),
            staleTime: 0,
          });
          if (fresh.totalLayout) {
            applyTotalLayoutSnapshot(fresh.totalLayout, fresh);
          }
        } catch {
          queryClient.invalidateQueries({ queryKey: overlayKeys.data(token) });
        } finally {
          if (layoutReconcileTimerRef.current === timer) {
            layoutReconcileTimerRef.current = null;
          }
        }
      })();
    }, LAYOUT_RECONCILE_DELAY_MS);
    layoutReconcileTimerRef.current = timer;
  }

  function clearPendingNowPlayingClear() {
    nowPlayingClearGenerationRef.current += 1;
    if (nowPlayingClearTimerRef.current) {
      clearTimeout(nowPlayingClearTimerRef.current);
      nowPlayingClearTimerRef.current = null;
    }
  }

  function readSessionId(value: unknown): number | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const sessionLike = value as {
      sessionId?: unknown;
      liveSessionId?: unknown;
    };
    const raw = sessionLike.sessionId ?? sessionLike.liveSessionId;
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function rememberSessionId(value: unknown) {
    const sessionId = readSessionId(value);
    const currentSessionId = currentSessionIdRef.current;
    if (sessionId && (!currentSessionId || sessionId >= currentSessionId)) {
      currentSessionIdRef.current = sessionId;
    }
  }

  function shouldIgnoreOlderSessionSnapshot(value: unknown): boolean {
    const sessionId = readSessionId(value);
    const currentSessionId = currentSessionIdRef.current;
    if (sessionId && currentSessionId && sessionId < currentSessionId) {
      requestSyncRef.current?.('session-mismatch-recheck', currentSessionId);
      return true;
    }
    return false;
  }

  function shouldIgnoreSessionScopedClear(value: unknown): boolean {
    const sessionId = readSessionId(value);
    const currentSessionId = currentSessionIdRef.current;
    if (!sessionId && currentSessionId) {
      requestSyncRef.current?.('session-mismatch-recheck', currentSessionId);
      return true;
    }
    if (sessionId && currentSessionId && sessionId !== currentSessionId) {
      requestSyncRef.current?.('session-mismatch-recheck', currentSessionId);
      return true;
    }
    if (sessionId && !currentSessionId && nowPlayingIdRef.current) {
      requestSyncRef.current?.('session-unknown-recheck', sessionId);
      return true;
    }
    rememberSessionId(value);
    return false;
  }

  function applyNowPlaying(next: NowPlayingData) {
    clearPendingNowPlayingClear();
    nullNowPlayingSyncRef.current = null;
    nowPlayingIdRef.current = next.id;
    queryClient.setQueryData<OverlayData | undefined>(
      overlayKeys.data(token),
      (current) =>
        current
          ? { ...current, nowPlaying: nowPlayingDataToApiRequest(next) }
          : current,
    );
    setNowPlaying(next);
  }

  function clearCachedNowPlaying() {
    queryClient.setQueryData<OverlayData | undefined>(
      overlayKeys.data(token),
      (current) => (current ? { ...current, nowPlaying: null } : current),
    );
  }

  function clearNowPlayingImmediately() {
    clearPendingNowPlayingClear();
    nullNowPlayingSyncRef.current = null;
    clearCachedNowPlaying();
    nowPlayingIdRef.current = null;
    setNowPlaying(null);
    queryClient.invalidateQueries({ queryKey: overlayKeys.data(token) });
  }

  function scheduleNowPlayingClear(
    requestId?: number | null,
    delayMs = NOW_PLAYING_CLEAR_GRACE_MS,
    expectedSessionId = currentSessionIdRef.current,
  ) {
    const targetId = requestId ?? nowPlayingIdRef.current;
    if (!targetId) {
      clearNowPlayingImmediately();
      return;
    }
    clearPendingNowPlayingClear();
    const clearGeneration = nowPlayingClearGenerationRef.current;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          if (
            nowPlayingClearGenerationRef.current !== clearGeneration ||
            nowPlayingIdRef.current !== targetId
          ) {
            return;
          }

          const fresh = await queryClient.fetchQuery({
            queryKey: overlayKeys.data(token),
            queryFn: () => getOverlayData(token),
            staleTime: 0,
          });

          if (
            nowPlayingClearGenerationRef.current !== clearGeneration ||
            nowPlayingIdRef.current !== targetId
          ) {
            return;
          }

          const freshSessionId = readSessionId(fresh);
          if (
            expectedSessionId &&
            freshSessionId &&
            freshSessionId !== expectedSessionId
          ) {
            rememberSessionId(fresh);
            return;
          }

          if (fresh.nowPlaying) {
            rememberSessionId(fresh);
            applyNowPlaying(anyRequestToNowPlayingData(fresh.nowPlaying));
            return;
          }

          clearCachedNowPlaying();
          nowPlayingIdRef.current = null;
          setNowPlaying(null);
          queryClient.invalidateQueries({ queryKey: overlayKeys.data(token) });
        } catch {
          queryClient.invalidateQueries({ queryKey: overlayKeys.data(token) });
        } finally {
          if (nowPlayingClearTimerRef.current === timer) {
            nowPlayingClearTimerRef.current = null;
          }
        }
      })();
    }, delayMs);
    nowPlayingClearTimerRef.current = timer;
  }

  function scheduleNowPlayingClearFromNullSync(data?: {
    isLive?: boolean | null;
    sessionId?: number | null;
    liveSessionId?: number | null;
  }) {
    if (shouldIgnoreSessionScopedClear(data)) {
      return;
    }
    const targetId = nowPlayingIdRef.current;
    if (!targetId) {
      clearNowPlayingImmediately();
      return;
    }

    const pending = nullNowPlayingSyncRef.current;
    const terminalObserved =
      data?.isLive === false || pending?.terminalObserved === true;
    if (pending?.targetId !== targetId || !terminalObserved) {
      nullNowPlayingSyncRef.current = {
        targetId,
        confirmations: 0,
        terminalObserved: data?.isLive === false,
      };
      requestSyncRef.current?.(
        'now-playing-null-recheck',
        readSessionId(data) ?? currentSessionIdRef.current,
      );
      return;
    }

    if (pending?.targetId === targetId && pending.confirmations >= 1) {
      nullNowPlayingSyncRef.current = null;
      scheduleNowPlayingClear(
        targetId,
        NOW_PLAYING_CLEAR_GRACE_MS,
        readSessionId(data) ?? currentSessionIdRef.current,
      );
      return;
    }

    nullNowPlayingSyncRef.current = {
      targetId,
      confirmations:
        pending?.targetId === targetId ? pending.confirmations + 1 : 1,
      terminalObserved: true,
    };
    requestSyncRef.current?.(
      'now-playing-null-recheck',
      readSessionId(data) ?? currentSessionIdRef.current,
    );
  }

  const toastController = useOverlayToastController();

  // NOTE: `useOverlay` is hoisted above `useOverlaySocket` so the per-channel
  // reader flag can key off the channel webPath before the socket connects.
  const { data: overlayData, error: overlayError } = useOverlay(token, {
    enabled: !!token,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Authoritative playback is default-on; explicit false is the rollback path.
  const authoritativePlaybackEnabled = useMemo(
    () => isAuthoritativePlaybackEnabled({ token, webPath: overlayData?.channel?.webPath }),
    [token, overlayData?.channel?.webPath],
  );

  const {
    isJoined,
    connectionStatus,
    requestSync,
    authoritativePlaybackView,
  } = useOverlaySocket(token, {
    widgetType: 'total',
    enabled: !!token && !isPreviewMode,
    authoritativePlaybackEnabled,
    onRequestAdded: (request: SongRequest) => {
      const requestSessionId = readSessionId(request);
      if (
        requestSessionId &&
        currentSessionIdRef.current &&
        requestSessionId !== currentSessionIdRef.current
      ) {
        return;
      }
      rememberSessionId(request);
      // 랜덤 신청 + 슬롯 후보 payload 동봉 시 슬롯머신 트리거 + queue/setlist 추가 보류.
      // 슬롯 onDismiss(또는 fallback timeout) 가 풀리면 그때 큐에 들어감.
      // 슬롯 candidates 가 없으면(빈 배열/없음) 일반 흐름을 그대로 타 즉시 큐 추가.
      if (
        request.isRandom &&
        Array.isArray(request.randomSlotCandidates) &&
        request.randomSlotCandidates.length > 0
      ) {
        setRandomSlot({
          requestId: request.id,
          candidates: request.randomSlotCandidates,
          requester: request.requester || '',
          pendingRequest: request,
        });
        return;
      }
      if (request.status === 'pending') {
        setQueue((prev) => {
          const newItem: QueueItem = {
            id: request.id,
            title: request.title,
            artist: request.artist,
            requester: request.requester,
            position: request.position,
            isDonation: request.isDonation,
            donationAmount: request.donationAmount,
            isHomework: request.isHomework,
            isRandom: request.isRandom,
            albumArt: request.albumArt,
          };
          return [...prev.filter((item) => item.id !== request.id), newItem]
            .sort((a, b) => a.position - b.position);
        });
      }
      setSetlist((prev) => {
        if (prev.some((item) => item.id === request.id)) return prev;
        return [...prev, socketRequestToSetlistItem(request)].sort(
          (a, b) => a.position - b.position,
        );
      });
    },
    onRequestUpdated: (request: SongRequest) => {
      const requestSessionId = readSessionId(request);
      if (
        requestSessionId &&
        currentSessionIdRef.current &&
        requestSessionId !== currentSessionIdRef.current
      ) {
        return;
      }
      rememberSessionId(request);
      if (request.status === 'playing') {
        applyNowPlaying(socketRequestToNowPlayingData(request));
        setPlaybackProgress({
          currentTime: 0,
          duration: 0,
          state: 'unstarted',
          percentage: 0,
        });
      } else if (request.status === 'completed' || request.status === 'rejected') {
        if (nowPlayingIdRef.current === request.id) {
          nullNowPlayingSyncRef.current = {
            targetId: request.id,
            confirmations: 0,
            terminalObserved: true,
          };
          requestSyncRef.current?.(
            'request-terminal-recheck',
            requestSessionId ?? currentSessionIdRef.current,
          );
        }
      }

      setQueue((prev) => {
        if (request.status !== 'pending') {
          return prev.filter((item) => item.id !== request.id);
        }
        const nextItem: QueueItem = {
          id: request.id,
          title: request.title,
          artist: request.artist,
          requester: request.requester,
          position: request.position,
          isDonation: request.isDonation,
          donationAmount: request.donationAmount,
          isHomework: request.isHomework,
          isRandom: request.isRandom,
          albumArt: request.albumArt,
        };
        if (prev.some((item) => item.id === request.id)) {
          return prev
            .map((item) => (item.id === request.id ? { ...item, ...nextItem } : item))
            .sort((a, b) => a.position - b.position);
        }
        return [...prev, nextItem].sort((a, b) => a.position - b.position);
      });

      setSetlist((prev) => {
        const nextItem = socketRequestToSetlistItem(request);
        if (nextItem.status === 'REJECTED') {
          return prev.filter((item) => item.id !== request.id);
        }
        if (prev.some((item) => item.id === request.id)) {
          return prev
            .map((item) =>
              item.id === request.id
                ? {
                    ...item,
                    ...nextItem,
                    formattedPrice: item.formattedPrice ?? nextItem.formattedPrice,
                  }
                : item,
            )
            .sort((a, b) => a.position - b.position);
        }
        return [...prev, nextItem].sort((a, b) => a.position - b.position);
      });
    },
    onRequestRemoved: (requestId: number) => {
      setQueue((prev) => prev.filter((item) => item.id !== requestId));
      if (nowPlayingIdRef.current === requestId) {
        clearNowPlayingImmediately();
      }
      setSetlist((prev) => prev.filter((item) => item.id !== requestId));
    },
    onSetlistReordered: (newSetlist: SongRequest[]) => {
      setSetlist(
        newSetlist
          .filter((r) => r.status !== 'rejected')
          .map(socketRequestToSetlistItem)
          .sort((a, b) => a.position - b.position),
      );
    },
    onQueueReordered: (newQueue: SongRequest[]) => {
      setQueue(
        newQueue
          .filter((r) => r.status === 'pending')
          .map((r) => ({
            id: r.id,
            title: r.title,
            artist: r.artist,
            requester: r.requester,
            position: r.position,
            isDonation: r.isDonation,
            donationAmount: r.donationAmount,
            isHomework: r.isHomework,
            isRandom: r.isRandom,
            albumArt: r.albumArt,
          })),
      );
    },
    onOmakaseUpdated: (omakase) => {
      setLiveOmakase(omakase);
    },
    onQueueSync: (data) => {
      if (shouldIgnoreOlderSessionSnapshot(data)) {
        handleSyncSuccess();
        return;
      }

      const queueSyncForCache = shouldIgnoreOlderLayoutSnapshot(data)
        ? {
            ...data,
            totalLayout: undefined,
            totalLayoutVersion: undefined,
            totalLayoutUpdatedAt: undefined,
          }
        : data;
      queryClient.setQueryData<OverlayData | undefined>(
        overlayKeys.data(token),
        (current) =>
          mergeQueueSyncIntoOverlayData(current, queueSyncForCache, {
            allowNullNowPlaying: queueSyncForCache?.isLive === false,
          }),
      );

      if (typeof data?.isLive === 'boolean') {
        setHasRealtimeLiveSignal(true);
        setSessionLive(Boolean(data.isLive));
      }
      setLiveOmakase(data?.omakase ?? null);
      const syncedQueue = Array.isArray(data?.queue) ? data.queue : [];
      setQueue(
        syncedQueue
          .filter((r: SongRequest) => r.status === 'pending')
          .map((r: SongRequest) => ({
            id: r.id,
            title: r.title,
            artist: r.artist,
            requester: r.requester,
            position: r.position,
            isDonation: r.isDonation,
            donationAmount: r.donationAmount,
            isHomework: r.isHomework,
            isRandom: r.isRandom,
            albumArt: r.albumArt,
          })),
      );

      const resolvedNowPlaying = resolveQueueSyncNowPlaying(data);
      if (resolvedNowPlaying) {
        rememberSessionId(data);
        const now = resolvedNowPlaying as any;
        const songChanged = now.id !== nowPlayingIdRef.current;
        applyNowPlaying(anyRequestToNowPlayingData(now));
        if (songChanged) {
          setPlaybackProgress({
            currentTime: 0,
            duration: 0,
            state: 'unstarted',
            percentage: 0,
          });
        }
      } else if (data && resolvedNowPlaying === null) {
        scheduleNowPlayingClearFromNullSync(data);
      }

      if (data?.totalLayout) {
        applyTotalLayoutSnapshot(data.totalLayout, data);
      }

      const setlistSource = Array.isArray((data as any)?.setlist)
        ? ((data as any).setlist as any[])
        : null;
      if (setlistSource) {
        setSetlist(
          setlistSource
            .filter((r: any) => {
              const status = r.status?.toUpperCase?.() ?? r.status;
              return status !== 'REJECTED';
            })
            .map(apiRequestToSetlistItem),
        );
      }

      initialLoadedRef.current = true;
      setIsOverlayReady(true);
      handleSyncSuccess();
    },
    onSyncError: handleSyncError,
    onThemeConfigUpdated: (data) => {
      // 통합 테마 이벤트: resolvedThemes + resolvedOptions를 모두 반영.
      const queueTheme = data.resolvedThemes?.queue ?? data.resolvedThemes?.songlist;
      const npTheme = data.resolvedThemes?.['now-playing'];
      const chatTheme = data.resolvedThemes?.chatbox;
      const setlistTheme = data.resolvedThemes?.setlist;
      const songbookQrTheme = data.resolvedThemes?.['songbook-qr'];
      if (queueTheme) setLiveQueueThemeOverride(queueTheme);
      if (npTheme) setLiveNpThemeOverride(npTheme);
      if (chatTheme) setLiveChatThemeOverride(chatTheme);
      if (setlistTheme) setLiveSetlistThemeOverride(setlistTheme);
      if (songbookQrTheme) setLiveSongbookQrThemeOverride(songbookQrTheme);

      // Legacy 'songlist' alias parity: resolvedThemes falls back (line 612)
      // so options must too, otherwise a legacy payload flips the theme but
      // drops user options silently.
      const queueOptions =
        data.resolvedOptions?.queue ?? data.resolvedOptions?.songlist;
      const npOptions = data.resolvedOptions?.['now-playing'];
      const chatOptions = data.resolvedOptions?.chatbox;
      const setlistOptions = data.resolvedOptions?.setlist;
      const songbookQrOptions = data.resolvedOptions?.['songbook-qr'];
      const lyricsTheme = data.resolvedThemes?.lyrics;
      const lyricsOptions = data.resolvedOptions?.lyrics;
      if (queueOptions) setLiveQueueResolvedOptions(queueOptions);
      if (npOptions) setLiveNpResolvedOptions(npOptions);
      if (chatOptions) setLiveChatResolvedOptions(chatOptions);
      if (setlistOptions) setLiveSetlistResolvedOptions(setlistOptions);
      if (songbookQrOptions) {
        setLiveSongbookQrResolvedOptions(songbookQrOptions);
      }
      if (lyricsTheme) setLiveLyricsThemeOverride(lyricsTheme);
      if (lyricsOptions) setLiveLyricsResolvedOptions(lyricsOptions);

      queryClient.invalidateQueries({ queryKey: overlayKeys.data(token) });
    },
    onLyricsPlaybackState: applyLyricsAnchor,
    onLayoutUpdated: (data) => {
      // Only 'total' layout is still driven via onLayoutUpdated. Per-widget
      // theme/options updates now flow through onThemeConfigUpdated.
      if (data?.widgetType === 'total' && data.layout) {
        applyTotalLayoutSnapshot(data.layout, data);
        scheduleLayoutReconcile();
      }
    },
    onSessionEnded: (data) => {
      if (shouldIgnoreSessionScopedClear(data)) {
        return;
      }
      setHasRealtimeLiveSignal(true);
      setSessionLive(false);
      setQueue([]);
      clearNowPlayingImmediately();
      setPlaybackProgress({
        currentTime: 0,
        duration: 0,
        state: 'unstarted',
        percentage: 0,
      });
      chatActions.clear();
      // lyrics state 정리 — 세션 종료 후 stale 가사 잔존 방지
      resetLyricsAnchor();
      // OverlayData REST snapshot 의 nowPlaying.song.id 도 stale 일 수 있으므로
      // invalidate → useLyricsState 가 다음 fetch 안 함 (songId null).
      queryClient.invalidateQueries({ queryKey: overlayKeys.data(token) });
      // setlist는 freeze (마지막 상태 유지)
    },
    onSessionStarted: (data) => {
      rememberSessionId(data);
      setHasRealtimeLiveSignal(true);
      setSessionLive(true);
      initialLoadedRef.current = false;
      setSetlist([]);
      triggerSync('session.started');
    },
    onSettingsUpdated: (settings) => {
      setLiveSettings(settings);
    },
    onChatMessage: chatActions.append,
    onDonation: chatActions.append,
    onRequestFeedback: (data) => toastController.pushFeedback(data),
    onInfoDisplay: (data) => toastController.pushInfo(data),
    onSongbookAddFeedback: (data) => toastController.pushSongbookFeedback(data),
    onWidgetCssUpdated: (data) => {
      applyQueueCss(data);
      applyNpCss(data);
      applyChatCss(data);
      applySetlistCss(data);
      applyLyricsCss(data);
      applySongbookQrCss(data);
    },
  });

  const { css: queueCss, applyWsUpdate: applyQueueCss } = useWidgetCustomCss('queue', overlayData?.widgetCustomCss?.queue);
  const { css: npCss, applyWsUpdate: applyNpCss } = useWidgetCustomCss('now-playing', overlayData?.widgetCustomCss?.['now-playing']);
  const { css: chatCss, applyWsUpdate: applyChatCss } = useWidgetCustomCss('chatbox', overlayData?.widgetCustomCss?.chatbox);
  const { css: setlistCss, applyWsUpdate: applySetlistCss } = useWidgetCustomCss('setlist', overlayData?.widgetCustomCss?.setlist);
  const { css: lyricsCss, applyWsUpdate: applyLyricsCss } = useWidgetCustomCss('lyrics', (overlayData?.widgetCustomCss as Record<string, string | null | undefined> | undefined)?.lyrics);
  const { css: songbookQrCss, applyWsUpdate: applySongbookQrCss } = useWidgetCustomCss('songbook-qr', overlayData?.widgetCustomCss?.['songbook-qr']);

  const widgetCssMap: Record<string, string | null> = useMemo(() => ({
    queue: queueCss,
    'now-playing': npCss,
    chatbox: chatCss,
    setlist: setlistCss,
    lyrics: lyricsCss,
    'songbook-qr': songbookQrCss,
  }), [queueCss, npCss, chatCss, setlistCss, lyricsCss, songbookQrCss]);

  // Snapshot reader: when active (fresh converged snapshot) it is the single
  // source of the rendered playback for EVERY sub-widget slice below; otherwise
  // each slice falls back to the legacy local state (today's behavior).
  const authoritativePlayback = useAuthoritativePlayback({
    enabled: authoritativePlaybackEnabled,
    base: overlayData,
    view: authoritativePlaybackView,
  });

  useEffect(() => {
    if (!overlayData || initialLoadedRef.current) {
      return;
    }

    if (overlayData.totalLayout) {
      applyTotalLayoutSnapshot(overlayData.totalLayout, overlayData);
    }

    if (overlayData.queue) {
      setQueue(
        overlayData.queue
          .filter((r: any) => r.status === 'PENDING')
          .map((r: any, idx: number) => ({
            id: r.id,
            title: r.song?.title || r.rawTitle,
            artist: r.song?.artist?.name || r.rawArtist,
            requester: r.requesterNickname,
            position: r.queueOrder || idx + 1,
            isDonation: !!r.donationAmount,
            donationAmount: r.donationAmount,
            isHomework: r.source === 'HOMEWORK',
            isRandom: r.requestType === 'RANDOM' || !!r.isRandom,
            albumArt: r.song?.albumArt,
          })),
      );
    }

    if (overlayData.nowPlaying) {
      rememberSessionId(overlayData);
      applyNowPlaying(anyRequestToNowPlayingData(overlayData.nowPlaying));
    }

    const restSetlist =
      (overlayData as any)?.setlist ?? overlayData.queue ?? null;
    if (Array.isArray(restSetlist)) {
      setSetlist(
        restSetlist
          .filter((r: any) => {
            const status = r.status?.toUpperCase?.() ?? r.status;
            return status !== 'REJECTED';
          })
          .map(apiRequestToSetlistItem),
      );
    }

    initialLoadedRef.current = true;
    setIsOverlayReady(true);
  }, [overlayData]);

  useEffect(() => {
    requestSyncRef.current = requestSync ?? null;
  }, [requestSync]);

  useEffect(() => {
    isJoinedRef.current = isJoined;
  }, [isJoined]);

  useEffect(() => {
    if (isJoined) {
      triggerSync('init');
      scheduleNextSync(syncIntervalRef.current);
    }
    if (!isJoined && syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
    }
    if (!isJoined && syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
  }, [isJoined]);

  // 곡 전환 (lyricsSyncState.songRequestId !== overlayData.nowPlaying.id) →
  // bounded backoff retry 로 OverlayData refetch (useSyncIdRefetch).
  // - 단순 invalidate 1회로는 첫 refetch 가 백엔드 REST 갱신 전 응답 시 영구 stuck
  // - deps 에 overlayData 전체 객체 넣지 말 것 (무한 루프 방지)
  const overlayDataNowPlayingId =
    (overlayData?.nowPlaying as { id?: number | null } | null | undefined)?.id ?? null;
  useSyncIdRefetch({
    token,
    syncId: lyricsSyncState?.songRequestId ?? null,
    // Reader on: compare the anchor against the snapshot now-playing id, not the
    // REST cache, so a snapshot-driven render never loops invalidateQueries (F3).
    overlayDataNowPlayingId: authoritativePlayback.active
      ? authoritativePlayback.nowPlayingId
      : overlayDataNowPlayingId,
    queryClient,
  });

  // === Theme registry integration for sub-widgets ===
  // Resolve the effective theme id for each sub-widget. The resolution
  // priority mirrors the individual widget pages:
  //   1. WS live override (just saved in settings)
  //   2. resolvedThemes from the REST API (unified theme)
  //   3. DEFAULT_FALLBACK_THEME_ID
  const apiQueueTheme = overlayData?.resolvedThemes?.queue;
  const apiNpTheme = overlayData?.resolvedThemes?.['now-playing'];
  const apiChatTheme = overlayData?.resolvedThemes?.chatbox;
  const apiSetlistTheme = (overlayData?.resolvedThemes as any)?.setlist;
  const apiLyricsTheme = (overlayData?.resolvedThemes as any)?.lyrics;
  const apiSongbookQrTheme = (overlayData?.resolvedThemes as any)?.[
    'songbook-qr'
  ];
  const requestedQueueThemeId =
    liveQueueThemeOverride ?? apiQueueTheme ?? DEFAULT_FALLBACK_THEME_ID;
  const requestedNpThemeId =
    liveNpThemeOverride ?? apiNpTheme ?? DEFAULT_FALLBACK_THEME_ID;
  const requestedChatThemeId =
    liveChatThemeOverride ?? apiChatTheme ?? DEFAULT_FALLBACK_THEME_ID;
  const requestedSetlistThemeId =
    liveSetlistThemeOverride ?? apiSetlistTheme ?? DEFAULT_FALLBACK_THEME_ID;
  const requestedLyricsThemeId =
    liveLyricsThemeOverride ?? apiLyricsTheme ?? DEFAULT_FALLBACK_THEME_ID;
  const requestedSongbookQrThemeId =
    liveSongbookQrThemeOverride ??
    apiSongbookQrTheme ??
    DEFAULT_FALLBACK_THEME_ID;

  const reducedMotion = useReducedMotion();
  const { theme: queueTheme } = useThemeLoader(requestedQueueThemeId);
  const { theme: npTheme } = useThemeLoader(requestedNpThemeId);
  const { theme: chatTheme } = useThemeLoader(requestedChatThemeId);
  const { theme: setlistTheme } = useThemeLoader(requestedSetlistThemeId);
  const { theme: lyricsTheme } = useThemeLoader(requestedLyricsThemeId);
  const { theme: songbookQrTheme } = useThemeLoader(requestedSongbookQrThemeId);

  // Build per-widget OverlayData slices. The theme components read
  // `data.queue`, `data.nowPlaying`, etc. directly, but the REST snapshot is
  // frozen at first load — merge the local realtime state so theme widgets
  // see live updates.
  //
  // Each slice spreads the base `overlayData` (so OverlayData required fields
  // remain populated) and the merged `settings`, then overrides ONLY the
  // fields its widget actually consumes. The other widgets' realtime fields
  // are intentionally left untouched (referencing the original base values),
  // so e.g. a queue change does not change the `nowPlaying` ref inside
  // `npData`, and the memoised NowPlaying widget can skip rendering.

  // Settings slice shared by all four data slices. Cheap object spread —
  // recomputes only when the underlying inputs change.
  const mergedSettings = useMemo<OverlayData['settings']>(() => {
    const base = (overlayData ?? {}) as OverlayData;
    return liveSettings
      ? ({ ...base.settings, ...liveSettings } as OverlayData['settings'])
      : base.settings;
  }, [overlayData, liveSettings]);

  // Queue widget data slice — only `queue` is overridden with live data.
  const queueData = useMemo<OverlayData>(() => {
    if (authoritativePlayback.active && authoritativePlayback.overlayData) {
      return {
        ...authoritativePlayback.overlayData,
        settings: mergedSettings,
        omakase: liveOmakase ?? authoritativePlayback.overlayData.omakase ?? null,
      };
    }
    const base = (overlayData ?? {}) as OverlayData;
    const liveQueue: ApiSongRequest[] = queue.map((item) => ({
      id: item.id,
      rawArtist: item.artist,
      rawTitle: item.title,
      requesterNickname: item.requester,
      status: 'PENDING' as const,
      donationAmount: item.donationAmount ?? undefined,
      isHomework: item.isHomework,
      isRandom: item.isRandom,
      queueOrder: item.position,
      song: item.albumArt
        ? ({
            id: 0,
            title: item.title,
            artist: { name: item.artist },
            albumArt: item.albumArt,
          } as ApiSongRequest['song'])
        : undefined,
    }));
    return {
      ...base,
      settings: mergedSettings,
      queue: liveQueue,
      omakase: liveOmakase ?? base.omakase ?? null,
    };
  }, [authoritativePlayback, overlayData, queue, mergedSettings, liveOmakase]);

  // NowPlaying widget data slice — only `nowPlaying` is overridden.
  const npData = useMemo<OverlayData>(() => {
    if (authoritativePlayback.active && authoritativePlayback.overlayData) {
      return {
        ...authoritativePlayback.overlayData,
        settings: mergedSettings,
      };
    }
    const base = (overlayData ?? {}) as OverlayData;
    let liveNowPlaying: ApiSongRequest | null | undefined;
    if (nowPlaying) {
      liveNowPlaying = nowPlayingDataToApiRequest(nowPlaying);
    } else if (base.nowPlaying) {
      liveNowPlaying = base.nowPlaying;
    } else {
      liveNowPlaying = null;
    }
    return {
      ...base,
      settings: mergedSettings,
      nowPlaying: liveNowPlaying,
    };
  }, [
    authoritativePlayback,
    overlayData,
    nowPlaying,
    isOverlayReady,
    mergedSettings,
  ]);

  // Chatbox widget data slice — chat messages flow through ChatMessagesContext.
  // This slice only needs base + merged settings; queue/nowPlaying/setlist
  // changes intentionally do NOT touch this object.
  const chatData = useMemo<OverlayData>(() => {
    const base = (overlayData ?? {}) as OverlayData;
    return {
      ...base,
      settings: mergedSettings,
    };
  }, [overlayData, mergedSettings]);

  // Setlist widget data slice — only `setlist` is overridden.
  const setlistData = useMemo<OverlayData>(() => {
    const base = (overlayData ?? {}) as OverlayData;
    const omakaseFromReader =
      authoritativePlayback.active && authoritativePlayback.overlayData
        ? liveOmakase ?? authoritativePlayback.overlayData.omakase ?? null
        : null;
    const liveSetlist: ApiSongRequest[] =
      authoritativePlayback.active && authoritativePlayback.overlayData
        ? authoritativePlayback.overlayData.setlist ?? []
        : setlist.map((item) => ({
            id: item.id,
            rawArtist: item.artist,
            rawTitle: item.title,
            requesterNickname: item.requester,
            status: item.status,
            donationAmount: item.donationAmount,
            isHomework: item.isHomework,
            queueOrder: item.position,
            formattedPrice: item.formattedPrice,
            calculatedPrice: item.calculatedPrice,
            priceSource: item.priceSource as ApiSongRequest['priceSource'],
            song: item.albumArt
              ? ({
                  id: 0,
                  title: item.title,
                  artist: { name: item.artist },
                  albumArt: item.albumArt,
                } as ApiSongRequest['song'])
              : undefined,
          }));
    const omakase =
      authoritativePlayback.active && authoritativePlayback.overlayData
        ? omakaseFromReader
        : liveOmakase ?? base.omakase ?? null;
    const omakaseItem: ApiSongRequest[] =
      omakase?.enabled && omakase.count > 0
        ? [
            {
              id: -1000000,
              rawArtist: '',
              rawTitle: `${omakase.displayName} X ${omakase.count}`,
              requesterNickname: '',
              status: 'PENDING' as const,
              queueOrder: -1000000,
            } as ApiSongRequest,
          ]
        : [];

    return {
      ...(authoritativePlayback.active && authoritativePlayback.overlayData ? authoritativePlayback.overlayData : base),
      settings: mergedSettings,
      setlist: [...omakaseItem, ...liveSetlist],
      omakase,
    };
  }, [authoritativePlayback, overlayData, setlist, mergedSettings, liveOmakase]);

  // Memoised merged options for each sub-widget theme.
  // Priority (lowest → highest): catalog defaults ← API resolvedOptions ← WS live override.
  const mergedQueueThemeOptions = useMemo(
    () => ({
      ...(queueTheme?.defaultOptions ?? {}),
      ...(overlayData?.resolvedOptions?.queue ?? {}),
      ...(liveQueueResolvedOptions ?? {}),
    }),
    [queueTheme, overlayData, liveQueueResolvedOptions],
  );
  const mergedNpThemeOptions = useMemo(
    () => ({
      ...(npTheme?.defaultOptions ?? {}),
      ...(overlayData?.resolvedOptions?.['now-playing'] ?? {}),
      ...(liveNpResolvedOptions ?? {}),
    }),
    [npTheme, overlayData, liveNpResolvedOptions],
  );
  const mergedChatThemeOptions = useMemo(
    () => ({
      ...(chatTheme?.defaultOptions ?? {}),
      ...(overlayData?.resolvedOptions?.chatbox ?? {}),
      ...(liveChatResolvedOptions ?? {}),
    }),
    [chatTheme, overlayData, liveChatResolvedOptions],
  );
  const mergedSetlistThemeOptions = useMemo(
    () => ({
      ...(setlistTheme?.defaultOptions ?? {}),
      ...((overlayData?.resolvedOptions as any)?.setlist ?? {}),
      ...(liveSetlistResolvedOptions ?? {}),
    }),
    [setlistTheme, overlayData, liveSetlistResolvedOptions],
  );
  const mergedLyricsThemeOptions = useMemo(
    () => ({
      ...(lyricsTheme?.defaultOptions ?? {}),
      ...((overlayData?.resolvedOptions as any)?.lyrics ?? {}),
      ...(liveLyricsResolvedOptions ?? {}),
    }),
    [lyricsTheme, overlayData, liveLyricsResolvedOptions],
  );
  const mergedSongbookQrThemeOptions = useMemo(
    () => ({
      ...(songbookQrTheme?.defaultOptions ?? {}),
      ...((overlayData?.resolvedOptions as any)?.['songbook-qr'] ?? {}),
      ...(liveSongbookQrResolvedOptions ?? {}),
    }),
    [songbookQrTheme, overlayData, liveSongbookQrResolvedOptions],
  );

  // Push the current `maxMessages` setting into ChatMessagesProvider so the
  // append action can trim the buffer correctly even though
  // `mergedChatThemeOptions` isn't in the provider's closure.
  useEffect(() => {
    const raw = mergedChatThemeOptions.maxMessages;
    const parsed = Number(raw);
    chatActions.setMaxMessages(
      Number.isFinite(parsed) && parsed > 0 ? parsed : null,
    );
  }, [mergedChatThemeOptions, chatActions]);

  const renderWidget = (widgetId: TotalOverlayWidgetId) => {
    if (widgetId === 'queue') {
      if (!queueTheme) return <div style={{ width: '100%', height: '100%' }} />;
      const QueueThemeWidget = queueTheme.widgets.queue;
      if (!QueueThemeWidget) return null;
      const autoScrollEnabled = readBooleanOption(
        (mergedQueueThemeOptions as Record<string, unknown>).autoScrollEnabled,
      );
      return (
        <TextStrokeWrapper options={mergedQueueThemeOptions}>
          <AutoScrollContainer
            enabled={autoScrollEnabled}
            className="w-full h-full"
          >
            <QueueThemeWidget
              data={queueData}
              options={mergedQueueThemeOptions}
              animations={queueTheme.animations}
              fonts={queueTheme.fonts}
              reducedMotion={reducedMotion}
              connectionStatus={connectionStatus}
            />
          </AutoScrollContainer>
        </TextStrokeWrapper>
      );
    }
    if (widgetId === 'now-playing') {
      if (!npTheme) return <div style={{ width: '100%', height: '100%' }} />;
      const NpThemeWidget = npTheme.widgets['now-playing'];
      if (!NpThemeWidget) return null;
      // Pass progress in via a tiny bridge that subscribes to the
      // PlaybackProgress context. This isolates 1Hz progress updates to
      // just this subtree — the outer renderWidget / TotalOverlayContent
      // do not re-render because they never read progress.
      return (
        <TextStrokeWrapper options={mergedNpThemeOptions}>
          <NowPlayingProgressBridge
            NpThemeWidget={NpThemeWidget}
            data={npData}
            options={mergedNpThemeOptions}
            animations={npTheme.animations}
            fonts={npTheme.fonts}
            reducedMotion={reducedMotion}
            connectionStatus={connectionStatus}
          />
        </TextStrokeWrapper>
      );
    }
    if (widgetId === 'chatbox') {
      if (!chatTheme) return <div style={{ width: '100%', height: '100%' }} />;
      const ChatThemeWidget = chatTheme.widgets.chatbox;
      if (!ChatThemeWidget) return null;
      // Pass chat in via a tiny bridge that subscribes to the
      // ChatMessages context. This isolates chat updates to just this
      // subtree — the outer renderWidget / TotalOverlayContent do not
      // re-render because they never read chatMessages.
      return (
        <TextStrokeWrapper options={mergedChatThemeOptions}>
          <ChatboxBridge
            ChatThemeWidget={ChatThemeWidget}
            data={chatData}
            options={mergedChatThemeOptions}
            animations={chatTheme.animations}
            fonts={chatTheme.fonts}
            reducedMotion={reducedMotion}
            connectionStatus={connectionStatus}
          />
        </TextStrokeWrapper>
      );
    }
    if (widgetId === 'setlist') {
      if (!setlistTheme) return <div style={{ width: '100%', height: '100%' }} />;
      const SetlistThemeWidget = (setlistTheme.widgets as any).setlist;
      if (!SetlistThemeWidget) return null;
      return (
        <TextStrokeWrapper options={mergedSetlistThemeOptions}>
          <SetlistThemeWidget
            data={setlistData}
            options={mergedSetlistThemeOptions}
            animations={setlistTheme.animations}
            fonts={setlistTheme.fonts}
            reducedMotion={reducedMotion}
            connectionStatus={connectionStatus}
          />
        </TextStrokeWrapper>
      );
    }
    if (widgetId === 'lyrics') {
      if (!lyricsTheme) return <div style={{ width: '100%', height: '100%' }} />;
      const LyricsThemeWidget = (lyricsTheme.widgets as any).lyrics;
      if (!LyricsThemeWidget) return null;
      if (authoritativePlayback.active && authoritativePlayback.overlayData) {
        // Reader owns now-playing (its `song.id` drives the lyrics fetch); keep
        // the live anchor.
        const lyricsSliceData = {
          ...authoritativePlayback.overlayData,
          settings: mergedSettings,
          lyricsSync: lyricsSyncState,
        } as OverlayData;
        return (
          <TextStrokeWrapper options={mergedLyricsThemeOptions}>
            <LyricsThemeWidget
              data={lyricsSliceData}
              options={mergedLyricsThemeOptions}
              animations={lyricsTheme.animations}
              fonts={lyricsTheme.fonts}
              reducedMotion={reducedMotion}
              connectionStatus={connectionStatus}
            />
          </TextStrokeWrapper>
        );
      }
      const base = (overlayData ?? {}) as OverlayData;
      const liveSongId =
        typeof nowPlaying?.songId === 'number' && nowPlaying.songId > 0
          ? nowPlaying.songId
          : null;
      const restNowPlaying =
        base.nowPlaying && base.nowPlaying.id === nowPlaying?.id
          ? base.nowPlaying
          : null;
      const restSongId = restNowPlaying?.song?.id ?? null;
      const lyricsSongId = liveSongId ?? restSongId;
      const lyricsNowPlaying =
        nowPlaying && lyricsSongId
          ? ({
              id: nowPlaying.id,
              rawArtist: nowPlaying.artist,
              rawTitle: nowPlaying.title,
              requesterNickname: nowPlaying.requester ?? '',
              status: 'PLAYING' as const,
              donationAmount: nowPlaying.donationAmount,
              isHomework: nowPlaying.isHomework,
              isRandom: nowPlaying.isRandom,
              queueOrder: 0,
              song: {
                id: lyricsSongId,
                title: nowPlaying.title,
                artist: { name: nowPlaying.artist },
                albumArt: nowPlaying.albumArt,
              },
            } as ApiSongRequest)
          : restNowPlaying ?? (isOverlayReady ? null : base.nowPlaying);
      const lyricsSliceData = {
        ...base,
        settings: mergedSettings,
        nowPlaying: lyricsNowPlaying,
        lyricsSync: lyricsSyncState,
      } as OverlayData;
      return (
        <TextStrokeWrapper options={mergedLyricsThemeOptions}>
          <div
            data-overlay-lyrics-widget="true"
            style={{ width: '100%', height: '100%' }}
          >
            <LyricsThemeWidget
              data={lyricsSliceData}
              options={mergedLyricsThemeOptions}
              animations={lyricsTheme.animations}
              fonts={lyricsTheme.fonts}
              reducedMotion={reducedMotion}
              connectionStatus={connectionStatus}
            />
          </div>
        </TextStrokeWrapper>
      );
    }
    if (widgetId === 'songbook-qr') {
      // songbook-qr consumes the whole OverlayData object — keep it whole (it
      // only reads config/channel, so reader vs base is equivalent here).
      return (
        <SongbookQrWidget
          data={authoritativePlayback.active && authoritativePlayback.overlayData ? authoritativePlayback.overlayData : overlayData}
          options={mergedSongbookQrThemeOptions}
          fonts={songbookQrTheme?.fonts}
          themeId={songbookQrTheme?.id ?? requestedSongbookQrThemeId}
        />
      );
    }
    return null;
  };

  const shouldRenderWidgets = isOverlayReady || !!overlayError;

  return (
    <div ref={containerRef} className="fixed inset-0 w-screen h-screen overflow-hidden">
      {shouldRenderWidgets &&
        (totalLayout.widgets as readonly { id: string; enabled: boolean; x: number; y: number; w: number; h: number; z: number }[])
        .filter(
          (widget) =>
            widget.id === 'queue' ||
            widget.id === 'now-playing' ||
            widget.id === 'chatbox' ||
            widget.id === 'setlist' ||
            widget.id === 'lyrics' ||
            widget.id === 'songbook-qr',
        )
        .filter((widget) => widget.enabled)
        .map((widget) => {
          const width = canvasSize.width * clamp01(widget.w);
          const height = canvasSize.height * clamp01(widget.h);
          const left = canvasSize.width * clamp01(widget.x);
          const top = canvasSize.height * clamp01(widget.y);
          const isLyricsWidget = widget.id === 'lyrics';

          return (
            <div
              key={widget.id}
              data-overlay-widget={widget.id}
              data-overlay-total-widget={widget.id}
              data-overlay-version="1"
              className="absolute"
              style={{
                left,
                top,
                width,
                height,
                zIndex: widget.z ?? 1,
              }}
            >
              <CustomCssInjector
                widget={widget.id as OverlayWidgetType}
                css={widgetCssMap[widget.id] ?? null}
              />
              {isLyricsWidget ? (
                <div
                  data-overlay-total-widget-shell="lyrics"
                  data-overlay-version="1"
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                  }}
                >
                  {renderWidget(widget.id as TotalOverlayWidgetId)}
                </div>
              ) : (
                renderWidget(widget.id as TotalOverlayWidgetId)
              )}
            </div>
          );
        })}
      <OverlayToastLayer
        toasts={toastController.toasts}
        onDismiss={toastController.dismiss}
      />
      {randomSlot && (
        <RandomSlotMachine
          key={randomSlot.requestId}
          candidates={randomSlot.candidates}
          requester={randomSlot.requester}
          onDismiss={handleRandomSlotDismiss}
        />
      )}
      {!isPreviewMode && (
        <CanvasSizeNotice
          width={canvasSize.width}
          height={canvasSize.height}
        />
      )}
    </div>
  );
}
