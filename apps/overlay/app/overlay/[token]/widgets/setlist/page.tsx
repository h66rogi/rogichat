'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useOverlaySocket, SongRequest } from '@/domains/overlay/hooks/use-overlay-socket';
import { useOverlay, overlayKeys } from '@/domains/overlay/hooks/use-overlay';
import { useWidgetCustomCss } from '@/domains/overlay/hooks/use-widget-custom-css';
import {
  OVERLAY_BACKUP_SYNC_INTERVAL_MS,
  OVERLAY_BACKUP_SYNC_MAX_INTERVAL_MS,
  OVERLAY_SYNC_RESPONSE_TIMEOUT_MS,
} from '@/domains/overlay/constants/realtime-sync';
import { WidgetShell } from '@/domains/overlay/components/WidgetShell';
import { TextStrokeWrapper } from '@/domains/overlay/components/TextStrokeWrapper';
import { parsePreviewOptions } from '@/domains/overlay/utils/parse-preview-options';
import {
  useReducedMotion,
  useThemeLoader,
} from '@/domains/overlay/themes/shared';
import { DEFAULT_FALLBACK_THEME_ID } from '@/domains/overlay/themes/registry';
import { isAuthoritativePlaybackEnabled } from '@/domains/overlay/utils/snapshot-reader-flag';
import { useAuthoritativePlayback } from '@/domains/overlay/hooks/use-snapshot-reader';
import type {
  OverlayData,
  OverlayOmakase,
  SongRequest as ApiSongRequest,
} from '@/domains/overlay/types/overlay';

// ---------------------------------------------------------------------------
// Local item type: extends the socket SongRequest with formattedPrice from REST
// ---------------------------------------------------------------------------
interface SetlistItem {
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
}

const WIDGET_TYPE = 'setlist' as const;

const BASE_SYNC_INTERVAL_MS = OVERLAY_BACKUP_SYNC_INTERVAL_MS;
const MAX_SYNC_INTERVAL_MS = OVERLAY_BACKUP_SYNC_MAX_INTERVAL_MS;
const SYNC_RESPONSE_TIMEOUT_MS = OVERLAY_SYNC_RESPONSE_TIMEOUT_MS;

export default function SetlistWidgetPage() {
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
  const [setlist, setSetlist] = useState<SetlistItem[]>([]);
  const [hasHydratedInitial, setHasHydratedInitial] = useState(false);
  const [liveSettings, setLiveSettings] = useState<Record<string, unknown> | null>(null);
  const [liveOmakase, setLiveOmakase] = useState<OverlayOmakase | null>(null);
  const [hasRealtimeLiveSignal, setHasRealtimeLiveSignal] = useState(false);
  const [sessionLive, setSessionLive] = useState(false);
  // isFrozen: when a session ends, we freeze the last setlist state instead of hiding
  const [isFrozen, setIsFrozen] = useState(false);
  const [isOverlayReady, setIsOverlayReady] = useState(isPreviewMode);
  const initialLoadedRef = useRef(false);
  const syncIntervalRef = useRef(BASE_SYNC_INTERVAL_MS);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSyncRef = useRef(false);
  const requestSyncRef = useRef<((reason?: string) => void) | null>(null);
  const isJoinedRef = useRef(false);

  const queryClient = useQueryClient();

  // --- REST initial load ---
  const { data: overlayData, error: overlayError } = useOverlay(token, {
    enabled: !!token,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const { css: customCss, applyWsUpdate: applyWidgetCssUpdate } = useWidgetCustomCss(
    'setlist',
    overlayData?.widgetCustomCss?.['setlist'],
  );

  // --- Map an API SongRequest to local SetlistItem ---
  function apiToSetlistItem(r: any, idx: number): SetlistItem {
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
      isHomework: r.source === 'HOMEWORK' || r.isHomework,
      albumArt: r.song?.albumArt ?? r.albumArt,
      formattedPrice: r.formattedPrice,
      calculatedPrice: r.calculatedPrice,
      priceSource: r.priceSource,
    };
  }

  // --- Hydrate from REST (once) ---
  useEffect(() => {
    if (!overlayData) return;

    if (!initialLoadedRef.current) {
      initialLoadedRef.current = true;
      setHasHydratedInitial(true);

      // Use data.setlist (full setlist) if available, otherwise fall back to data.queue
      const source = overlayData.setlist ?? overlayData.queue;
      if (source) {
        setSetlist(
          source
            .filter((r: any) => r.status !== 'REJECTED')
            .map(apiToSetlistItem),
        );
      }
    }

    setIsOverlayReady(true);
  }, [overlayData]);

  // --- Periodic sync scheduling (same as queue) ---
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

  // --- Map socket SongRequest to local SetlistItem (no formattedPrice from socket) ---
  function socketToSetlistItem(r: SongRequest): SetlistItem {
    return {
      id: r.id,
      title: r.title,
      artist: r.artist,
      requester: r.requester,
      position: r.position,
      status: r.status === 'pending'
        ? 'PENDING'
        : r.status === 'accepted'
          ? 'ACCEPTED'
          : r.status === 'playing'
            ? 'PLAYING'
            : r.status === 'completed'
              ? 'COMPLETED'
              : 'REJECTED',
      isDonation: r.isDonation,
      donationAmount: r.donationAmount,
      isHomework: r.isHomework,
      albumArt: r.albumArt,
    };
  }

  // Authoritative playback is default-on; explicit false is the rollback path.
  const authoritativePlaybackEnabled = useMemo(
    () => isAuthoritativePlaybackEnabled({ token, webPath: overlayData?.channel?.webPath }),
    [token, overlayData?.channel?.webPath],
  );

  // --- WebSocket ---
  const { isConnected, isJoined, connectionStatus, requestSync, authoritativePlaybackView } = useOverlaySocket(token, {
    widgetType: WIDGET_TYPE,
    enabled: !!token && !isPreviewMode,
    authoritativePlaybackEnabled,

    onRequestAdded: (request: SongRequest) => {
      // Insert new item sorted by position (skip if already exists)
      setSetlist((prev) => {
        if (prev.some((item) => item.id === request.id)) return prev;
        const newItem = socketToSetlistItem(request);
        return [...prev, newItem].sort((a, b) => a.position - b.position);
      });
    },

    onRequestUpdated: (request: SongRequest) => {
      // UPSERT: update if exists, insert if missing (handles reconnection gaps)
      setSetlist((prev) => {
        const nextItem = socketToSetlistItem(request);

        // Remove rejected items
        if (nextItem.status === 'REJECTED') {
          return prev.filter((item) => item.id !== request.id);
        }

        if (prev.some((item) => item.id === request.id)) {
          // Update existing — preserve formattedPrice from REST
          return prev
            .map((item) =>
              item.id === request.id
                ? { ...item, ...nextItem, formattedPrice: item.formattedPrice ?? nextItem.formattedPrice }
                : item,
            )
            .sort((a, b) => a.position - b.position);
        }
        // Insert missing (reconnection gap recovery)
        return [...prev, nextItem].sort((a, b) => a.position - b.position);
      });
    },

    onRequestRemoved: (requestId: number) => {
      // Remove item (forced delete/rejection only)
      setSetlist((prev) => prev.filter((item) => item.id !== requestId));
    },

    onSetlistReordered: (newSetlist: SongRequest[]) => {
      // setlist는 PENDING + ACCEPTED + PLAYING + COMPLETED 모두 포함 (backend
      // queue.reordered payload의 setlist 필드). 다음곡 전환 시 앞곡이 유지된다.
      setSetlist(
        newSetlist
          .filter((r) => r.status !== 'rejected')
          .map(socketToSetlistItem),
      );
    },
    onOmakaseUpdated: (omakase) => {
      setLiveOmakase(omakase);
    },

    onQueueSync: (data) => {
      if (typeof data?.isLive === 'boolean') {
        setHasRealtimeLiveSignal(true);
        setSessionLive(Boolean(data.isLive));
        if (data.isLive) {
          setIsFrozen(false);
        }
      }

      // Total overlay only replaces setlist when the sync payload explicitly
      // contains a full setlist. Keep standalone behavior aligned: a queue-only
      // sync must not collapse the setlist history into the pending queue.
      const syncSource = Array.isArray((data as any)?.setlist)
        ? (data as any).setlist
        : null;
      setLiveOmakase(data?.omakase ?? null);

      if (syncSource) {
        setSetlist(
          syncSource
            .filter((r: any) => {
              const status = r.status?.toUpperCase?.() ?? r.status;
              return status !== 'REJECTED';
            })
            .map(apiToSetlistItem),
        );
      }

      initialLoadedRef.current = true;
      setHasHydratedInitial(true);
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

    onSessionStarted: () => {
      setHasRealtimeLiveSignal(true);
      setSessionLive(true);
      setIsFrozen(false);
      setSetlist([]); // Clear setlist on new session
      initialLoadedRef.current = false;
      triggerSync('session.started');
    },

    onSessionEnded: () => {
      setHasRealtimeLiveSignal(true);
      setSessionLive(false);
      setIsFrozen(true); // Freeze last state (don't clear)
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
    console.log('[SetlistWidget] Status:', {
      isConnected,
      isJoined,
      isLive: isSessionLive,
      isFrozen,
      connectionStatus,
      overlayError: overlayError?.message,
    });
  }, [isConnected, isJoined, isSessionLive, isFrozen, connectionStatus, overlayError]);

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

  // === Enriched OverlayData for theme widgets ===
  const enrichedOverlayData = useMemo<OverlayData>(() => {
    const base = (overlayData ?? {}) as OverlayData;
    if (
      !hasHydratedInitial &&
      setlist.length === 0 &&
      ((base.setlist?.length ?? 0) > 0 || (base.queue?.length ?? 0) > 0)
    ) {
      return base;
    }
    const liveSetlist: ApiSongRequest[] = setlist.map((item) => ({
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
    const omakase = liveOmakase ?? base.omakase ?? null;
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
      ...base,
      settings: liveSettings
        ? { ...base.settings, ...liveSettings } as OverlayData['settings']
        : base.settings,
      setlist: [...omakaseItem, ...liveSetlist],
      omakase,
    };
  }, [overlayData, setlist, hasHydratedInitial, liveSettings, liveOmakase]);

  // Snapshot reader: single source of the rendered setlist when a fresh snapshot
  // exists; otherwise the legacy `enrichedOverlayData` path renders (today). The
  // omakase pseudo-row is prepended identically so the render matches.
  const authoritativePlayback = useAuthoritativePlayback({
    enabled: authoritativePlaybackEnabled,
    base: overlayData,
    view: authoritativePlaybackView,
  });
  const dataForTheme = useMemo<OverlayData>(() => {
    if (authoritativePlayback.active && authoritativePlayback.overlayData) {
      const omakase = liveOmakase ?? authoritativePlayback.overlayData.omakase ?? null;
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
        ...authoritativePlayback.overlayData,
        settings: liveSettings
          ? ({ ...authoritativePlayback.overlayData.settings, ...liveSettings } as OverlayData['settings'])
          : authoritativePlayback.overlayData.settings,
        setlist: [...omakaseItem, ...(authoritativePlayback.overlayData.setlist ?? [])],
        omakase,
      };
    }
    return enrichedOverlayData;
  }, [authoritativePlayback, enrichedOverlayData, liveSettings, liveOmakase]);

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

  // === Session lifecycle: hide when not live and not frozen ===
  // In preview mode, always render regardless of session state
  if (!isPreviewMode && !isSessionLive && !isFrozen) {
    // Not live, not frozen — no session data to show
    if (isOverlayReady) return null;
  }

  if (!isOverlayReady && !overlayError) {
    return null;
  }

  // Theme is still loading → transparent placeholder (avoids flicker).
  if (!registryTheme) {
    return <WidgetShell widget="setlist" customCss={customCss} />;
  }

  const ThemeWidget = registryTheme.widgets[WIDGET_TYPE];
  if (!ThemeWidget) {
    return <WidgetShell widget="setlist" customCss={customCss} />;
  }

  return (
    <WidgetShell widget="setlist" customCss={customCss}>
      <TextStrokeWrapper options={mergedThemeOptions}>
        <ThemeWidget
          key={registryTheme.id}
          data={dataForTheme}
          options={mergedThemeOptions}
          animations={registryTheme.animations}
          fonts={registryTheme.fonts}
          reducedMotion={reducedMotion}
          connectionStatus={connectionStatus}
        />
      </TextStrokeWrapper>
    </WidgetShell>
  );
}
