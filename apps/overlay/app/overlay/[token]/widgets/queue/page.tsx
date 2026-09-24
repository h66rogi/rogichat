'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useOverlaySocket,
  type SongRequest,
  type RandomSlotCandidate,
} from '@/domains/overlay/hooks/use-overlay-socket';
import { useOverlay, overlayKeys } from '@/domains/overlay/hooks/use-overlay';
import { useWidgetCustomCss } from '@/domains/overlay/hooks/use-widget-custom-css';
import {
  OVERLAY_BACKUP_SYNC_INTERVAL_MS,
  OVERLAY_BACKUP_SYNC_MAX_INTERVAL_MS,
  OVERLAY_SYNC_RESPONSE_TIMEOUT_MS,
} from '@/domains/overlay/constants/realtime-sync';
import { WidgetShell } from '@/domains/overlay/components/WidgetShell';
import { RandomSlotMachine } from '@/domains/overlay/components/random-slot/RandomSlotMachine';
import { TextStrokeWrapper } from '@/domains/overlay/components/TextStrokeWrapper';
import { parsePreviewOptions } from '@/domains/overlay/utils/parse-preview-options';
import {
  useReducedMotion,
  useThemeLoader,
} from '@/domains/overlay/themes/shared';
import { DEFAULT_FALLBACK_THEME_ID } from '@/domains/overlay/themes/registry';
import { AutoScrollContainer } from '@/domains/overlay/components/shared/AutoScrollContainer';
import { isAuthoritativePlaybackEnabled } from '@/domains/overlay/utils/snapshot-reader-flag';
import { useAuthoritativePlayback } from '@/domains/overlay/hooks/use-snapshot-reader';
import type {
  OverlayData,
  OverlayOmakase,
  SongRequest as ApiSongRequest,
} from '@/domains/overlay/types/overlay';

function readBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === '1';
  if (typeof value === 'number') return value !== 0;
  return false;
}

type QueueItem = {
  id: number;
  title: string;
  artist: string;
  requester: string;
  position: number;
  isDonation?: boolean;
  donationAmount?: number | null;
  isHomework?: boolean;
  /** 랜덤 신청 (백엔드가 노래책에서 1곡 자동 추출). */
  isRandom?: boolean;
  albumArt?: string | null;
};

const WIDGET_TYPE = 'queue' as const;

const BASE_SYNC_INTERVAL_MS = OVERLAY_BACKUP_SYNC_INTERVAL_MS;
const MAX_SYNC_INTERVAL_MS = OVERLAY_BACKUP_SYNC_MAX_INTERVAL_MS;
const SYNC_RESPONSE_TIMEOUT_MS = OVERLAY_SYNC_RESPONSE_TIMEOUT_MS;

export default function QueueWidgetPage() {
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
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [randomSlot, setRandomSlot] = useState<{
    requestId: number;
    candidates: RandomSlotCandidate[];
    requester: string;
    pendingRequest: SongRequest;
  } | null>(null);
  const [hasHydratedInitial, setHasHydratedInitial] = useState(false);
  const [liveSettings, setLiveSettings] = useState<Record<string, unknown> | null>(null);
  const [liveOmakase, setLiveOmakase] = useState<OverlayOmakase | null>(null);
  const [hasRealtimeLiveSignal, setHasRealtimeLiveSignal] = useState(false);
  const [sessionLive, setSessionLive] = useState(false);
  const [isOverlayReady, setIsOverlayReady] = useState(isPreviewMode);
  const initialLoadedRef = useRef(false);
  const syncIntervalRef = useRef(BASE_SYNC_INTERVAL_MS);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSyncRef = useRef(false);
  const requestSyncRef = useRef<((reason?: string) => void) | null>(null);
  const isJoinedRef = useRef(false);

  const queryClient = useQueryClient();

  const { data: overlayData, isLoading: isLoadingOverlay, error: overlayError } = useOverlay(token, {
    enabled: !!token,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const { css: customCss, applyWsUpdate: applyWidgetCssUpdate } = useWidgetCustomCss(
    'queue',
    overlayData?.widgetCustomCss?.['queue'],
  );

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
          return [...prev.filter((item) => item.id !== pending.id), newItem]
            .sort((a, b) => a.position - b.position);
        });
      }
      return null;
    });
  }, []);

  useEffect(() => {
    if (!randomSlot) return;
    const id = setTimeout(handleRandomSlotDismiss, 5000);
    return () => clearTimeout(id);
  }, [randomSlot, handleRandomSlotDismiss]);

  // 초기 데이터로 큐 설정 (최초 1회만)
  useEffect(() => {
    if (!overlayData) {
      return;
    }

    if (overlayData?.queue && !initialLoadedRef.current) {
      initialLoadedRef.current = true;
      setHasHydratedInitial(true);
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
          }))
      );
    }

    setIsOverlayReady(true);
  }, [overlayData]);

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

  // Authoritative playback is default-on; explicit false is the rollback path.
  const authoritativePlaybackEnabled = useMemo(
    () => isAuthoritativePlaybackEnabled({ token, webPath: overlayData?.channel?.webPath }),
    [token, overlayData?.channel?.webPath],
  );

  const { isConnected, isJoined, connectionStatus, requestSync, authoritativePlaybackView } = useOverlaySocket(token, {
    widgetType: 'songlist',
    enabled: !!token && !isPreviewMode,
    authoritativePlaybackEnabled,
    onRequestAdded: (request: SongRequest) => {
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

            isRandom: !!request.isRandom,
            albumArt: request.albumArt,
          };
          return [...prev.filter((item) => item.id !== request.id), newItem]
            .sort((a, b) => a.position - b.position);
        });
      }
    },
    onRequestUpdated: (request: SongRequest) => {
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

          isRandom: !!request.isRandom,
          albumArt: request.albumArt,
        };
        if (prev.some((item) => item.id === request.id)) {
          return prev
            .map((item) => (item.id === request.id ? { ...item, ...nextItem } : item))
            .sort((a, b) => a.position - b.position);
        }
        return [...prev, nextItem].sort((a, b) => a.position - b.position);
      });
    },
    onRequestRemoved: (requestId: number) => {
      setQueue((prev) => prev.filter((item) => item.id !== requestId));
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

            isRandom: !!r.isRandom,
            albumArt: r.albumArt,
          }))
      );
    },
    onOmakaseUpdated: (omakase) => {
      setLiveOmakase(omakase);
    },
    onQueueSync: (data) => {
      if (typeof data?.isLive === 'boolean') {
        setHasRealtimeLiveSignal(true);
        setSessionLive(Boolean(data.isLive));
      }
      const syncedQueue = Array.isArray(data?.queue) ? data.queue : [];
      setLiveOmakase(data?.omakase ?? null);
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

            isRandom: !!r.isRandom,
            albumArt: r.albumArt,
          }))
      );
      initialLoadedRef.current = true;
      setHasHydratedInitial(true);
      setIsOverlayReady(true);
      handleSyncSuccess();
    },
    onSyncError: handleSyncError,
    onThemeConfigUpdated: (data) => {
      const nextTheme = data.resolvedThemes?.[WIDGET_TYPE] ?? data.resolvedThemes?.songlist;
      const nextOptions = data.resolvedOptions?.[WIDGET_TYPE] ?? data.resolvedOptions?.songlist;
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
    onSessionStarted: () => {
      setHasRealtimeLiveSignal(true);
      setSessionLive(true);
      initialLoadedRef.current = false;
      triggerSync('session.started');
    },
    onSessionEnded: () => {
      setHasRealtimeLiveSignal(true);
      setSessionLive(false);
      setQueue([]);
    },
  });

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

  const isSessionLive = hasRealtimeLiveSignal
    ? sessionLive
    : Boolean(overlayData?.isLive);

  useEffect(() => {
    console.log('[QueueWidget] Status:', { isConnected, isJoined, isLive: isSessionLive, connectionStatus, overlayError: overlayError?.message });
  }, [isConnected, isJoined, isSessionLive, connectionStatus, overlayError]);

  // === Theme resolution ===
  // Priority: preview URL param > WS live override > REST resolvedThemes > DEFAULT.
  const apiTheme = overlayData?.resolvedThemes?.[WIDGET_TYPE] ?? overlayData?.resolvedThemes?.songlist;
  const requestedThemeId =
    previewThemeParam ??
    liveThemeOverride ??
    apiTheme ??
    DEFAULT_FALLBACK_THEME_ID;
  const reducedMotion = useReducedMotion();
  const { theme: registryTheme } = useThemeLoader(requestedThemeId);

  // Enriched data for realtime queue updates.
  const enrichedOverlayData = useMemo<OverlayData>(() => {
    const base = (overlayData ?? {}) as OverlayData;
    if (
      !hasHydratedInitial &&
      queue.length === 0 &&
      (base.queue?.length ?? 0) > 0
    ) {
      return base;
    }
    const liveQueue: ApiSongRequest[] = queue.map((item) => ({
      id: item.id,
      rawArtist: item.artist,
      rawTitle: item.title,
      requesterNickname: item.requester,
      status: 'PENDING' as const,
      donationAmount: item.donationAmount ?? undefined,
      isHomework: item.isHomework ?? false,

      isRandom: item.isRandom ?? false,
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
      settings: liveSettings
        ? { ...base.settings, ...liveSettings } as OverlayData['settings']
        : base.settings,
      queue: liveQueue,
      omakase: liveOmakase ?? base.omakase ?? null,
    };
  }, [overlayData, queue, hasHydratedInitial, liveSettings, liveOmakase]);

  // Snapshot reader: single source of the rendered queue when a fresh snapshot
  // exists; otherwise the legacy `enrichedOverlayData` path renders (today).
  const authoritativePlayback = useAuthoritativePlayback({
    enabled: authoritativePlaybackEnabled,
    base: overlayData,
    view: authoritativePlaybackView,
  });
  const dataForTheme = useMemo<OverlayData>(() => {
    if (authoritativePlayback.active && authoritativePlayback.overlayData) {
      return {
        ...authoritativePlayback.overlayData,
        settings: liveSettings
          ? ({ ...authoritativePlayback.overlayData.settings, ...liveSettings } as OverlayData['settings'])
          : authoritativePlayback.overlayData.settings,
        omakase: liveOmakase ?? authoritativePlayback.overlayData.omakase ?? null,
      };
    }
    return enrichedOverlayData;
  }, [authoritativePlayback, enrichedOverlayData, liveSettings, liveOmakase]);

  // Merge theme options: catalog defaults ← API resolvedOptions ← live WS override ← preview URL.
  const mergedThemeOptions = useMemo(() => {
    const apiOptions = overlayData?.resolvedOptions?.[WIDGET_TYPE] ?? overlayData?.resolvedOptions?.songlist ?? {};
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
    return <WidgetShell widget="queue" customCss={customCss} />;
  }

  const ThemeWidget = registryTheme.widgets[WIDGET_TYPE];
  if (!ThemeWidget) {
    return <WidgetShell widget="queue" customCss={customCss} />;
  }

  const autoScrollEnabled = readBoolean(
    (mergedThemeOptions as Record<string, unknown>).autoScrollEnabled,
  );

  return (
    <>
      <WidgetShell widget="queue" customCss={customCss}>
        <TextStrokeWrapper options={mergedThemeOptions}>
          <AutoScrollContainer enabled={autoScrollEnabled}>
            <ThemeWidget
              key={registryTheme.id}
              data={dataForTheme}
              options={mergedThemeOptions}
              animations={registryTheme.animations}
              fonts={registryTheme.fonts}
              reducedMotion={reducedMotion}
              connectionStatus={connectionStatus}
            />
          </AutoScrollContainer>
        </TextStrokeWrapper>
      </WidgetShell>
      {randomSlot && (
        <RandomSlotMachine
          key={randomSlot.requestId}
          candidates={randomSlot.candidates}
          requester={randomSlot.requester}
          onDismiss={handleRandomSlotDismiss}
        />
      )}
    </>
  );
}
