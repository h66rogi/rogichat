'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getOverlayData } from '@/domains/overlay/apis/overlay';
import {
  useOverlaySocket,
  type SongRequest,
} from '@/domains/overlay/hooks/use-overlay-socket';
import { computeAnchorMs } from '@/domains/overlay/themes/shared';
import { useOverlay, overlayKeys } from '@/domains/overlay/hooks/use-overlay';
import { useAnchorState } from '@/domains/overlay/hooks/use-anchor-state';
import { useWidgetCustomCss } from '@/domains/overlay/hooks/use-widget-custom-css';
import {
  OVERLAY_BACKUP_SYNC_INTERVAL_MS,
  OVERLAY_BACKUP_SYNC_MAX_INTERVAL_MS,
  OVERLAY_SYNC_RESPONSE_TIMEOUT_MS,
} from '@/domains/overlay/constants/realtime-sync';
import { WidgetShell } from '@/domains/overlay/components/WidgetShell';
import { TextStrokeWrapper } from '@/domains/overlay/components/TextStrokeWrapper';
import {
  NowPlayingData,
  PlaybackProgress,
} from '@/domains/overlay/components/now-playing';
import { parsePreviewOptions } from '@/domains/overlay/utils/parse-preview-options';
import {
  useReducedMotion,
  useThemeLoader,
} from '@/domains/overlay/themes/shared';
import { DEFAULT_FALLBACK_THEME_ID } from '@/domains/overlay/themes/registry';
import { mergeQueueSyncIntoOverlayData } from '@/domains/overlay/utils/merge-queue-sync-into-overlay-data';
import { resolveQueueSyncNowPlaying } from '@/domains/overlay/utils/playback-snapshot';
import { isAuthoritativePlaybackEnabled } from '@/domains/overlay/utils/snapshot-reader-flag';
import { useAuthoritativePlayback } from '@/domains/overlay/hooks/use-snapshot-reader';
import type {
  OverlayData,
  SongRequest as ApiSongRequest,
} from '@/domains/overlay/types/overlay';

const WIDGET_TYPE = 'now-playing' as const;

const BASE_SYNC_INTERVAL_MS = OVERLAY_BACKUP_SYNC_INTERVAL_MS;
const MAX_SYNC_INTERVAL_MS = OVERLAY_BACKUP_SYNC_MAX_INTERVAL_MS;
const SYNC_RESPONSE_TIMEOUT_MS = OVERLAY_SYNC_RESPONSE_TIMEOUT_MS;
const NOW_PLAYING_CLEAR_GRACE_MS = 1200;

// CSS keyframes for animations
const globalStyles = `
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }
  @keyframes progressGlow {
    0%, 100% { opacity: 0.6; filter: brightness(1); }
    50% { opacity: 1; filter: brightness(1.2); }
  }
`;

export default function NowPlayingWidgetPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = params.token as string;
  const isPreviewMode = searchParams.get('preview') === '1';
  // Accept both ?theme= (new) and ?layout= (legacy back-compat) preview params.
  const previewThemeParam =
    searchParams.get('theme') ?? searchParams.get('layout');
  const previewOptions = parsePreviewOptions(searchParams.get('options'));

  // Live theme override — set by WS `theme-config.updated` events when the user
  // saves settings. Beats `apiTheme` (REST snapshot) for immediate updates.
  const [liveThemeOverride, setLiveThemeOverride] = useState<string | null>(null);
  const [liveResolvedOptions, setLiveResolvedOptions] = useState<
    Record<string, unknown> | null
  >(null);

  // Inject global styles
  useEffect(() => {
    const styleId = 'now-playing-animations';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = globalStyles;
      document.head.appendChild(style);
    }
  }, []);

  const [liveSettings, setLiveSettings] = useState<Record<string, unknown> | null>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlayingData | null>(null);
  const nowPlayingIdRef = useRef<number | null>(null);
  const currentSessionIdRef = useRef<number | null>(null);
  const [playbackProgress, setPlaybackProgress] = useState<PlaybackProgress>({
    currentTime: 0,
    duration: 0,
    state: 'unstarted',
    percentage: 0,
  });
  // anchor sync state — useAnchorState 가 emittedAt + nowPlayingId mismatch race
  // 둘 다 처리. 매 100ms 보간으로 playbackProgress derive (legacy ~1Hz 폐기).
  const {
    lyricsSyncState,
    applyIncoming: applyLyricsAnchor,
    reset: resetLyricsAnchor,
  } = useAnchorState(nowPlaying?.id ?? null);
  const initialLoadedRef = useRef(false);
  const [isOverlayReady, setIsOverlayReady] = useState(isPreviewMode);
  const syncIntervalRef = useRef(BASE_SYNC_INTERVAL_MS);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSyncRef = useRef(false);
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

  function clearPendingNowPlayingClear() {
    nowPlayingClearGenerationRef.current += 1;
    if (nowPlayingClearTimerRef.current) {
      clearTimeout(nowPlayingClearTimerRef.current);
      nowPlayingClearTimerRef.current = null;
    }
  }

  function toNowPlayingData(request: any): NowPlayingData {
    const requestType =
      typeof request?.requestType === 'string' ? request.requestType : undefined;
    const source = typeof request?.source === 'string' ? request.source : undefined;
    const rawSongId = request?.songId ?? request?.song?.id;
    const songId =
      typeof rawSongId === 'number' || typeof rawSongId === 'string'
        ? Number(rawSongId)
        : null;
    return {
      id: request.id,
      songId: Number.isFinite(songId) ? songId : null,
      title: request.title ?? request.song?.title ?? request.rawTitle,
      artist: request.artist ?? request.song?.artist?.name ?? request.rawArtist,
      albumArt: request.albumArt ?? request.song?.albumArt,
      requester: request.requester ?? request.requesterNickname ?? '',
      isDonation: request.isDonation ?? ((request.donationAmount ?? 0) > 0),
      donationAmount: request.donationAmount ?? undefined,
      isHomework: request.isHomework ?? (source?.toUpperCase() === 'HOMEWORK'),
      isRandom:
        request.isRandom === true || requestType?.toUpperCase() === 'RANDOM',
    };
  }

  function nowPlayingDataToApiRequest(next: NowPlayingData): ApiSongRequest {
    const songId =
      typeof next.songId === 'number' && next.songId > 0 ? next.songId : null;
    return {
      id: next.id,
      rawArtist: next.artist,
      rawTitle: next.title,
      requesterNickname: next.requester ?? '',
      status: 'PLAYING' as const,
      donationAmount: next.donationAmount,
      isHomework: next.isHomework,
      isRandom: next.isRandom,
      queueOrder: 0,
      song: songId || next.albumArt
        ? ({
            id: songId ?? 0,
            title: next.title,
            artist: { name: next.artist },
            albumArt: next.albumArt,
          } as ApiSongRequest['song'])
        : undefined,
    };
  }

  function applyNowPlaying(request: any) {
    clearPendingNowPlayingClear();
    nullNowPlayingSyncRef.current = null;
    rememberSessionId(request);
    const next = toNowPlayingData(request);
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
            applyNowPlaying(fresh.nowPlaying);
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

  // React Query client for invalidating overlay data after a live theme save.
  const queryClient = useQueryClient();

  const { data: overlayData, error: overlayError } = useOverlay(token, {
    enabled: !!token,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const { css: customCss, applyWsUpdate: applyWidgetCssUpdate } = useWidgetCustomCss(
    'now-playing',
    overlayData?.widgetCustomCss?.['now-playing'],
  );

  // Authoritative playback is default-on. When explicitly disabled, everything below
  // behaves exactly as today.
  const authoritativePlaybackEnabled = useMemo(
    () => isAuthoritativePlaybackEnabled({ token, webPath: overlayData?.channel?.webPath }),
    [token, overlayData?.channel?.webPath],
  );

  const { isJoined, connectionStatus, requestSync, authoritativePlaybackView } = useOverlaySocket(token, {
    widgetType: 'nowsong',
    enabled: !!token && !isPreviewMode,
    authoritativePlaybackEnabled,
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
        applyNowPlaying(request);
        setPlaybackProgress({
          currentTime: 0,
          duration: 0,
          state: 'unstarted',
          percentage: 0,
        });
      }
      if (request.status === 'completed' || request.status === 'rejected') {
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
    },
    onRequestRemoved: (requestId: number) => {
      if (nowPlayingIdRef.current === requestId) {
        clearNowPlayingImmediately();
      }
    },
    onLyricsPlaybackState: applyLyricsAnchor,
    onQueueSync: (data) => {
      if (shouldIgnoreOlderSessionSnapshot(data)) {
        handleSyncSuccess();
        return;
      }

      queryClient.setQueryData<OverlayData | undefined>(
        overlayKeys.data(token),
        (current) =>
          mergeQueueSyncIntoOverlayData(current, data, {
            allowNullNowPlaying: data?.isLive === false,
          }),
      );

      const resolvedNowPlaying = resolveQueueSyncNowPlaying(data);
      if (resolvedNowPlaying) {
        rememberSessionId(data);
        const now = resolvedNowPlaying as SongRequest;
        const songChanged = now.id !== nowPlayingIdRef.current;
        applyNowPlaying(now);
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

      initialLoadedRef.current = true;
      setIsOverlayReady(true);
      handleSyncSuccess();
    },
    onSyncError: handleSyncError,
    onThemeConfigUpdated: (data) => {
      // 통합 테마 이벤트: resolvedThemes + resolvedOptions를 모두 반영.
      const nextTheme = data.resolvedThemes?.[WIDGET_TYPE];
      const nextOptions = data.resolvedOptions?.[WIDGET_TYPE];
      if (nextTheme) {
        setLiveThemeOverride(nextTheme);
      }
      if (nextOptions) {
        setLiveResolvedOptions(nextOptions);
      }
      queryClient.invalidateQueries({ queryKey: overlayKeys.data(token) });
    },
    onWidgetCssUpdated: applyWidgetCssUpdate,
    onSettingsUpdated: (settings) => {
      setLiveSettings(settings);
    },
    onSessionEnded: (data) => {
      if (shouldIgnoreSessionScopedClear(data)) {
        return;
      }
      clearNowPlayingImmediately();
      setPlaybackProgress({
        currentTime: 0,
        duration: 0,
        state: 'unstarted',
        percentage: 0,
      });
      resetLyricsAnchor();
    },
    onSessionStarted: (data) => {
      rememberSessionId(data);
      initialLoadedRef.current = false;
      requestSyncRef.current?.('session.started', readSessionId(data));
    },
  });

  // anchor 보간 → playbackProgress (100ms throttle).
  // legacy ~1Hz playback.progress 대신 anchor + Date.now() 기반 부드러운 보간.
  // songRequestId mismatch (anchor 의 곡과 nowPlaying 의 곡이 다름) 시 skip —
  // 곡 전환 직후 잠깐 stale anchor 가 흘러들어와 잘못된 progress 표시되는 것 방지.
  // (callback drop 대신 tick 에서 거르는 이유: 새 곡 anchor 가 request.updated
  // 보다 먼저 와도 보존 → currentId 가 따라잡으면 즉시 적용. drop 시 5초 heartbeat
  // 까지 progress=0 stuck 회귀.)
  useEffect(() => {
    if (!lyricsSyncState) {
      return;
    }
    const sync = lyricsSyncState;
    const tick = () => {
      const currentId = nowPlayingIdRef.current;
      if (sync.songRequestId && currentId && sync.songRequestId !== currentId) {
        return;
      }
      const currentMs = computeAnchorMs(sync);
      const currentTime = currentMs / 1000;
      const duration = sync.durationMs / 1000;
      const state: PlaybackProgress['state'] = sync.anchorAt ? 'playing' : 'paused';
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
  }, [lyricsSyncState]);

  // Load initial data from API
  useEffect(() => {
    if (!overlayData || initialLoadedRef.current) {
      return;
    }

    if (overlayData.nowPlaying) {
      rememberSessionId(overlayData);
      applyNowPlaying(overlayData.nowPlaying);
    }

    if (overlayData.nowPlaying === null) {
      scheduleNowPlayingClearFromNullSync(overlayData);
    }

    initialLoadedRef.current = true;
    setIsOverlayReady(true);
  }, [overlayData, isPreviewMode]);

  useEffect(() => {
    return () => {
      if (nowPlayingClearTimerRef.current) {
        clearTimeout(nowPlayingClearTimerRef.current);
        nowPlayingClearTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    requestSyncRef.current = requestSync ?? null;
  }, [requestSync]);

  useEffect(() => {
    isJoinedRef.current = isJoined;
  }, [isJoined]);

  useEffect(() => {
    nowPlayingIdRef.current = nowPlaying?.id ?? null;
  }, [nowPlaying?.id]);

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

  // === Theme resolution ===
  // Priority: preview URL param > WS live override > REST resolvedThemes > DEFAULT.
  const apiTheme = overlayData?.resolvedThemes?.[WIDGET_TYPE];
  const requestedThemeId =
    previewThemeParam ??
    liveThemeOverride ??
    apiTheme ??
    DEFAULT_FALLBACK_THEME_ID;
  const reducedMotion = useReducedMotion();
  const { theme: registryTheme } = useThemeLoader(requestedThemeId);

  // Build an enriched OverlayData that overrides `nowPlaying` with the
  // local realtime state. The new theme widgets read `data.nowPlaying`
  // directly, but the REST snapshot is frozen at first load — without
  // this merge they'd never reflect track changes that arrive over
  // WebSocket.
  //
  // The REST/query snapshot is authoritative when it explicitly contains a
  // now-playing row. Local idle clears also null the query cache, so a stale
  // client-side clear cannot hide a valid server snapshot for the same song.
  const enrichedOverlayData = useMemo<OverlayData>(() => {
    const base = (overlayData ?? {}) as OverlayData;
    const mergedSettings = liveSettings
      ? { ...base.settings, ...liveSettings } as OverlayData['settings']
      : base.settings;
    if (!nowPlaying) {
      return {
        ...base,
        settings: mergedSettings,
        nowPlaying: base.nowPlaying ?? null,
      };
    }
    const songId =
      typeof nowPlaying.songId === 'number' && nowPlaying.songId > 0
        ? nowPlaying.songId
        : null;
    const liveNowPlaying: ApiSongRequest = {
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
    return {
      ...base,
      settings: mergedSettings,
      nowPlaying: liveNowPlaying,
    };
  }, [
    overlayData,
    nowPlaying,
    liveSettings,
  ]);

  // Snapshot reader: when enabled AND a fresh converged snapshot exists, the
  // reconciler is the single source of the rendered now-playing. Otherwise
  // (flag off, no snapshot yet, or staleness fallback) we keep rendering the
  // legacy `enrichedOverlayData` path — exactly today's behavior.
  const authoritativePlayback = useAuthoritativePlayback({
    enabled: authoritativePlaybackEnabled,
    base: overlayData,
    view: authoritativePlaybackView,
  });
  const dataForTheme = useMemo<OverlayData>(() => {
    if (authoritativePlayback.active && authoritativePlayback.overlayData) {
      // Reader owns playback; keep the widget's live-settings merge for parity.
      return { ...authoritativePlayback.overlayData, settings: enrichedOverlayData.settings };
    }
    return enrichedOverlayData;
  }, [authoritativePlayback, enrichedOverlayData]);

  // Merge theme options: catalog defaults ← API resolvedOptions ← live WS override ← preview URL.
  const mergedThemeOptions = useMemo(() => {
    const apiOptions = overlayData?.resolvedOptions?.[WIDGET_TYPE] ?? {};
    return {
      ...(registryTheme?.defaultOptions ?? {}),
      ...apiOptions,
      ...(liveResolvedOptions ?? {}),
      ...(isPreviewMode && previewOptions ? previewOptions : {}),
    };
  }, [registryTheme, overlayData, liveResolvedOptions, isPreviewMode, previewOptions]);

  if (!isOverlayReady && !overlayError) {
    return null;
  }

  // Theme is still loading → transparent placeholder (avoids flicker).
  if (!registryTheme) {
    return <WidgetShell widget="now-playing" customCss={customCss} />;
  }

  const ThemeWidget = registryTheme.widgets[WIDGET_TYPE];
  if (!ThemeWidget) {
    return <WidgetShell widget="now-playing" customCss={customCss} />;
  }

  return (
    <WidgetShell widget="now-playing" customCss={customCss}>
      <TextStrokeWrapper options={mergedThemeOptions}>
        <ThemeWidget
          key={registryTheme.id}
          data={dataForTheme}
          options={mergedThemeOptions}
          animations={registryTheme.animations}
          fonts={registryTheme.fonts}
          reducedMotion={reducedMotion}
          connectionStatus={connectionStatus}
          playbackProgress={playbackProgress}
        />
      </TextStrokeWrapper>
    </WidgetShell>
  );
}
