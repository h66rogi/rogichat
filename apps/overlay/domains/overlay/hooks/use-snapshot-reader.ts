'use client';

import { useMemo } from 'react';
import type { OverlayData } from '@/domains/overlay/types/overlay';
import { shouldFallbackToLegacy } from '@/domains/overlay/state/playback-reconciler';
import {
  materializeOverlayDataFromSnapshot,
  readMaterializedNowPlayingId,
} from '@/domains/overlay/selectors/snapshot-to-overlay-data';
import { OVERLAY_SNAPSHOT_READER_STALE_MS } from '@/domains/overlay/constants/realtime-sync';
import type { PlaybackReaderView } from '@/domains/overlay/hooks/use-overlay-socket';

export interface AuthoritativePlaybackResult {
  /**
   * True only while a FRESH converged snapshot is the single source driving the
   * rendered playback. When false the caller must render its existing (warm)
   * legacy path — that is what enforces single-writer at the render boundary and
   * what degrades to today's behavior on staleness / publish-off.
   */
  active: boolean;
  /** Materialized OverlayData to render when `active`; null otherwise. */
  overlayData: OverlayData | null;
  /**
   * The now-playing id the reader renders. Feed this into `useSyncIdRefetch` so
   * its anchor-vs-cache comparison uses the snapshot id (not the REST cache) and
   * cannot loop `invalidateQueries` (overlay F3).
   */
  nowPlayingId: number | null;
}

const INACTIVE: AuthoritativePlaybackResult = {
  active: false,
  overlayData: null,
  nowPlayingId: null,
};

/**
 * Reader-side glue: turn the socket hook's reactive `PlaybackReaderView` into a
 * render-ready OverlayData, but ONLY while the snapshot is fresh.
 *
 * - flag off (`enabled` false) -> always INACTIVE -> caller renders today's path.
 * - no snapshot yet             -> INACTIVE -> caller renders today's path.
 * - snapshot stale vs a newer legacy queue.sync (`shouldFallbackToLegacy`)
 *                               -> INACTIVE -> caller renders today's (warm) path.
 * - fresh snapshot              -> active + materialized OverlayData.
 */
export function useAuthoritativePlayback(params: {
  enabled: boolean;
  base: OverlayData | undefined | null;
  view: PlaybackReaderView;
  staleMs?: number;
  /** Injectable clock (tests). Defaults to Date.now. */
  now?: () => number;
}): AuthoritativePlaybackResult {
  const {
    enabled,
    base,
    view,
    staleMs = OVERLAY_SNAPSHOT_READER_STALE_MS,
    now,
  } = params;

  return useMemo(() => {
    if (!enabled || !base || view.stalled) {
      return INACTIVE;
    }
    const snapshot = view.snapshot;
    if (!snapshot) {
      return INACTIVE;
    }
    const currentTime = now ? now() : Date.now();
    if (
      shouldFallbackToLegacy(
        view.lastSnapshotAt,
        view.lastQueueSyncAt,
        currentTime,
        staleMs,
      )
    ) {
      return INACTIVE;
    }
    const overlayData = materializeOverlayDataFromSnapshot(snapshot, base);
    return {
      active: true,
      overlayData,
      nowPlayingId: readMaterializedNowPlayingId(overlayData),
    };
  }, [enabled, base, view, staleMs, now]);
}

/** @deprecated Use the domain name: this selects authoritative playback state. */
export const useSnapshotReader = useAuthoritativePlayback;
/** @deprecated Use AuthoritativePlaybackResult. */
export type SnapshotReaderResult = AuthoritativePlaybackResult;
