'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useOverlaySocket,
  type SongRequest,
} from '@/domains/overlay/hooks/use-overlay-socket';
import { useOverlay, overlayKeys } from '@/domains/overlay/hooks/use-overlay';
import { useSyncIdRefetch } from '@/domains/overlay/hooks/use-sync-id-refetch';
import { useAnchorState } from '@/domains/overlay/hooks/use-anchor-state';
import { useWidgetCustomCss } from '@/domains/overlay/hooks/use-widget-custom-css';
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
import type { OverlayData } from '@/domains/overlay/types/overlay';

const WIDGET_TYPE = 'lyrics' as const;

type LyricsNowPlayingSnapshot = {
  id: number;
  songId?: number | null;
  song?: { id?: number | null } | null;
};

/**
 * Standalone lyrics widget page.
 *
 * 곡 ID 는 socket(request.updated/queue.sync) 으로 직접 추적 — REST snapshot
 * 만 의존하면 useAnchorState 의 promote 메커니즘이 작동 안 함 (REST 가 영원히
 * stale 일 때 anchor pending deadlock).
 *
 * useAnchorState 가 race 모두 처리. SharedLyricsWidget 은 enrichedOverlayData 의
 * REST nowPlaying.song.id 또는 socket nowPlaying.songId 로 가사 fetch —
 * REST snapshot 갱신은 useSyncIdRefetch 가 mismatch 시 invalidate.
 */
export default function LyricsWidgetPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = params.token as string;
  const isPreviewMode = searchParams.get('preview') === '1';
  const previewThemeParam =
    searchParams.get('theme') ?? searchParams.get('layout');
  const previewOptions = parsePreviewOptions(searchParams.get('options'));

  const [liveThemeOverride, setLiveThemeOverride] = useState<string | null>(null);
  const [liveResolvedOptions, setLiveResolvedOptions] = useState<
    Record<string, unknown> | null
  >(null);

  // socket 으로 직접 추적하는 nowPlayingId (REST snapshot 보다 빠름).
  // setSongId 호출 사이트마다 ref 동기 set 으로 1-render stale 윈도우 제거.
  const [nowPlayingId, setNowPlayingId] = useState<number | null>(null);
  const nowPlayingIdRef = useRef<number | null>(null);
  const [liveNowPlaying, setLiveNowPlaying] =
    useState<LyricsNowPlayingSnapshot | null>(null);
  const [isLegacyOverlay, setIsLegacyOverlay] = useState(false);
  const setSongId = (id: number | null) => {
    nowPlayingIdRef.current = id;
    setNowPlayingId(id);
  };
  const setNowPlayingRequest = (request: SongRequest | null) => {
    setLiveNowPlaying(
      request
        ? {
            id: request.id,
            songId: request.songId ?? null,
          }
        : null,
    );
    setSongId(request?.id ?? null);
  };

  const queryClient = useQueryClient();

  const { data: overlayData, error: overlayError } = useOverlay(token, {
    enabled: !!token,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // REST snapshot 초기 hydrate — socket 이 아직 안 도착했을 때 fallback.
  useEffect(() => {
    if (nowPlayingIdRef.current !== null) return;
    const restId =
      (overlayData?.nowPlaying as { id?: number | null } | null | undefined)?.id ?? null;
    if (restId !== null) {
      setSongId(restId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayData]);

  useEffect(() => {
    const root = document.documentElement;
    setIsLegacyOverlay(
      root.classList.contains('overlay-legacy-chromium') ||
      root.classList.contains('obs-legacy-cef'),
    );
  }, []);

  const overlayDataNowPlayingId =
    (overlayData?.nowPlaying as { id?: number | null } | null | undefined)?.id ?? null;

  const {
    lyricsSyncState,
    applyIncoming: applyLyricsAnchor,
    reset: resetLyricsAnchor,
  } = useAnchorState(nowPlayingId);

  const { css: customCss, applyWsUpdate: applyWidgetCssUpdate } = useWidgetCustomCss(
    WIDGET_TYPE,
    overlayData?.widgetCustomCss?.[WIDGET_TYPE],
  );

  // Authoritative playback is default-on; explicit false is the rollback path.
  const authoritativePlaybackEnabled = useMemo(
    () => isAuthoritativePlaybackEnabled({ token, webPath: overlayData?.channel?.webPath }),
    [token, overlayData?.channel?.webPath],
  );

  const { isJoined, connectionStatus, requestSync, authoritativePlaybackView } = useOverlaySocket(token, {
    widgetType: WIDGET_TYPE,
    enabled: !!token && !isPreviewMode,
    authoritativePlaybackEnabled,
    onLyricsPlaybackState: applyLyricsAnchor,
    onRequestUpdated: (request: SongRequest) => {
      if (request.status === 'playing') {
        setNowPlayingRequest(request);
      }
      if (request.status === 'completed' || request.status === 'rejected') {
        if (nowPlayingIdRef.current === request.id) {
          setNowPlayingRequest(null);
        }
      }
    },
    onRequestRemoved: (requestId: number) => {
      if (nowPlayingIdRef.current === requestId) {
        setNowPlayingRequest(null);
      }
    },
    onQueueSync: (data) => {
      if (data?.nowPlaying) {
        setNowPlayingRequest(data.nowPlaying as SongRequest);
      } else if (data && data.nowPlaying === null) {
        setNowPlayingRequest(null);
      }
    },
    onThemeConfigUpdated: (data) => {
      const nextTheme = data.resolvedThemes?.[WIDGET_TYPE];
      const nextOptions = data.resolvedOptions?.[WIDGET_TYPE];
      if (nextTheme) setLiveThemeOverride(nextTheme);
      if (nextOptions) setLiveResolvedOptions(nextOptions);
      queryClient.invalidateQueries({ queryKey: overlayKeys.data(token) });
    },
    onWidgetCssUpdated: applyWidgetCssUpdate,
    onSessionEnded: () => {
      setNowPlayingRequest(null);
      resetLyricsAnchor();
      queryClient.invalidateQueries({ queryKey: overlayKeys.data(token) });
    },
  });

  // Snapshot reader: single source of the rendered now-playing (for lyrics
  // fetch) when a fresh snapshot exists; otherwise the legacy path (today).
  const authoritativePlayback = useAuthoritativePlayback({
    enabled: authoritativePlaybackEnabled,
    base: overlayData,
    view: authoritativePlaybackView,
  });

  // socket nowPlayingId 와 REST nowPlayingId mismatch 면 REST refetch — REST 가
  // 늦게 따라오는 race 차단. lyrics hook 은 socket songId 도 읽지만 REST snapshot
  // 동기화는 다른 nowPlaying 표시와 세션 상태 일관성 때문에 계속 필요.
  //
  // Reader on: compare against the reconciler snapshot's now-playing id (not the
  // REST cache) so a snapshot-driven render never loops invalidateQueries (F3).
  useSyncIdRefetch({
    token,
    syncId: nowPlayingId,
    overlayDataNowPlayingId: authoritativePlayback.active
      ? authoritativePlayback.nowPlayingId
      : overlayDataNowPlayingId,
    queryClient,
  });

  // mount/reconnect 시 gateway 에 fresh queue.sync 요청. lyrics widget 은 anchor
  // 기반이라 다른 widget 처럼 interval polling 은 불필요하지만, init 1회는 필수 —
  // 안 그러면 socket 끊김→재연결 후 nowPlayingId 가 stale 한 REST snapshot 에만
  // 의존해서 새 곡 sync 미동기화 (Codex P2-26).
  useEffect(() => {
    if (isJoined) {
      requestSync('init');
    }
  }, [isJoined, requestSync]);

  // === Theme resolution ===
  const apiTheme = overlayData?.resolvedThemes?.[WIDGET_TYPE];
  const requestedThemeId =
    previewThemeParam ??
    liveThemeOverride ??
    apiTheme ??
    DEFAULT_FALLBACK_THEME_ID;
  const reducedMotion = useReducedMotion();
  const { theme: registryTheme } = useThemeLoader(requestedThemeId);

  const enrichedOverlayData = useMemo<OverlayData>(() => {
    const base = (overlayData ?? {}) as OverlayData;
    const nowPlayingForLyrics =
      (liveNowPlaying ?? base.nowPlaying ?? null) as unknown as OverlayData['nowPlaying'];
    return {
      ...base,
      nowPlaying: nowPlayingForLyrics,
      lyricsSync: lyricsSyncState,
    } as OverlayData;
  }, [overlayData, liveNowPlaying, lyricsSyncState]);

  // When the reader is active, the snapshot owns now-playing; keep the live
  // lyrics anchor. Otherwise render the legacy path (today).
  const dataForTheme = useMemo<OverlayData>(() => {
    if (authoritativePlayback.active && authoritativePlayback.overlayData) {
      return {
        ...authoritativePlayback.overlayData,
        lyricsSync: lyricsSyncState,
      } as OverlayData;
    }
    return enrichedOverlayData;
  }, [authoritativePlayback, enrichedOverlayData, lyricsSyncState]);

  const mergedThemeOptions = useMemo(() => {
    const apiOptions = overlayData?.resolvedOptions?.[WIDGET_TYPE] ?? {};
    return {
      ...(registryTheme?.defaultOptions ?? {}),
      ...apiOptions,
      ...(liveResolvedOptions ?? {}),
      ...(isPreviewMode && previewOptions ? previewOptions : {}),
      ...(isLegacyOverlay ? { lyricsHideWhenEmpty: false } : {}),
    };
  }, [
    registryTheme,
    overlayData,
    liveResolvedOptions,
    isPreviewMode,
    previewOptions,
    isLegacyOverlay,
  ]);

  if (overlayError && !overlayData) {
    return <WidgetShell widget={WIDGET_TYPE} customCss={customCss} />;
  }

  if (!registryTheme) {
    return <WidgetShell widget={WIDGET_TYPE} customCss={customCss} />;
  }

  const ThemeWidget = registryTheme.widgets[WIDGET_TYPE];
  if (!ThemeWidget) {
    return <WidgetShell widget={WIDGET_TYPE} customCss={customCss} />;
  }

  return (
    <WidgetShell widget={WIDGET_TYPE} customCss={customCss}>
      <TextStrokeWrapper options={mergedThemeOptions}>
        <div
          data-overlay-lyrics-widget="true"
          style={{ width: '100%', height: '100%' }}
        >
          <ThemeWidget
            key={registryTheme.id}
            data={dataForTheme}
            options={mergedThemeOptions}
            animations={registryTheme.animations}
            fonts={registryTheme.fonts}
            reducedMotion={reducedMotion}
            connectionStatus={connectionStatus}
          />
        </div>
      </TextStrokeWrapper>
    </WidgetShell>
  );
}
