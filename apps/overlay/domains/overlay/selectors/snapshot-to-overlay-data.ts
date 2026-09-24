/**
 * Authoritative playback snapshot -> OverlayData selector.
 *
 * Materializes a converged `OverlayPlaybackSnapshotData` (the reconciler's
 * single source of truth) into the exact `OverlayData` shape the theme widgets
 * already consume, so a widget can render now-playing / queue / setlist from the
 * snapshot instead of legacy local state.
 *
 * Ownership split (runbook Task 4.1): the snapshot owns ONLY playback
 * (nowPlaying / queue / setlist / omakase / isLive / sessionId / startedAt +
 * settings when carried). Every config field the widgets need — channel,
 * settings, resolvedThemes, resolvedOptions, widgetCustomCss, totalLayout /
 * totalLayoutVersion / totalLayoutUpdatedAt, themes, widgetConfigs, themeId —
 * is taken from `base` (the existing REST/config path). So a snapshot that omits
 * config never blanks a theme; the `?theme`/`?layout` preview alias, the
 * `songlist -> queue` fallback, custom CSS and the OBS-legacy root classes all
 * keep working via `base` and the widget page that owns them.
 *
 * The row mapping reuses `toApiSongRequest` (the same mapper
 * `mergeQueueSyncIntoOverlayData` uses) so a snapshot-driven render is
 * byte-for-byte the shape a `queue.sync`-driven render produces.
 */

import type {
  OverlayData,
  OverlayOmakase,
  SongRequest as ApiSongRequest,
} from '@/domains/overlay/types/overlay';
import type { OverlayPlaybackSnapshotData } from '@/domains/overlay/utils/playback-snapshot';
import { normalizePlaybackSnapshotItem } from '@/domains/overlay/utils/playback-snapshot';
import { toApiSongRequest } from '@/domains/overlay/utils/merge-queue-sync-into-overlay-data';

/** A superset of the playback fields we read; both snapshot and queue.sync fit. */
export interface PlaybackMaterializeSource {
  sessionId?: number | null;
  liveSessionId?: number | null;
  activeSessionId?: number | null;
  isLive?: boolean | null;
  startedAt?: string | null;
  queue?: unknown[];
  setlist?: unknown[];
  nowPlaying?: unknown | null;
  omakase?: unknown | null;
  settings?: unknown;
  requestSettings?: unknown;
}

function normalizeSessionId(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function mapRow(row: unknown, fallbackOrder: number): ApiSongRequest {
  // Snapshot rows key off `requestId`/`song`; normalize to the flat shape
  // `toApiSongRequest` expects (it reads `.id`, `.title`, `.rawTitle`, ...).
  return toApiSongRequest(normalizePlaybackSnapshotItem(row), fallbackOrder);
}

function mapRows(rows: unknown[]): ApiSongRequest[] {
  return rows.map((row, index) => mapRow(row, index + 1));
}

/**
 * Build an `OverlayData` from a converged playback snapshot on top of the
 * existing config `base`. Playback fields come from `source`; every other field
 * is preserved from `base`.
 */
export function materializeOverlayDataFromSnapshot(
  source: OverlayPlaybackSnapshotData | PlaybackMaterializeSource,
  base: OverlayData,
): OverlayData {
  const next: OverlayData = { ...base };

  if (Array.isArray(source.queue)) {
    next.queue = mapRows(source.queue);
  }

  // Setlist with the songlist -> queue fallback (a queue-only payload must not
  // collapse the setlist; mirror the standalone setlist widget's behavior).
  const setlistRows = Array.isArray(source.setlist)
    ? source.setlist
    : Array.isArray(source.queue)
      ? source.queue
      : null;
  if (setlistRows) {
    next.setlist = mapRows(setlistRows);
  }

  // nowPlaying is authoritative on the converged snapshot: a real row, or an
  // authoritative null (the reconciler already ran the hold-null debounce, so a
  // null here is a confirmed clear — never a transient flicker).
  if ('nowPlaying' in source) {
    next.nowPlaying = source.nowPlaying
      ? mapRow(source.nowPlaying, 0)
      : null;
  }

  if ('omakase' in source) {
    next.omakase = (source.omakase ?? null) as OverlayOmakase | null;
  }

  const requestSettings = source.requestSettings ?? source.settings;
  if (requestSettings && typeof requestSettings === 'object') {
    next.settings = {
      ...(base.settings ?? {}),
      ...(requestSettings as Record<string, unknown>),
    } as OverlayData['settings'];
  }

  if (typeof source.isLive === 'boolean') {
    next.isLive = source.isLive;
  }

  const sessionId = normalizeSessionId(
    source.sessionId ?? source.liveSessionId ?? source.activeSessionId,
  );
  if (sessionId !== null) {
    next.sessionId = sessionId;
  } else if ('activeSessionId' in source && source.activeSessionId === null) {
    next.sessionId = null;
  }

  if ('startedAt' in source && source.startedAt !== undefined) {
    next.startedAt = source.startedAt ?? null;
  }

  return next;
}

/** Convenience: the now-playing id a materialized OverlayData renders (or null). */
export function readMaterializedNowPlayingId(
  data: OverlayData | null | undefined,
): number | null {
  const id = (data?.nowPlaying as { id?: number | null } | null | undefined)?.id;
  return typeof id === 'number' && Number.isFinite(id) ? id : null;
}
