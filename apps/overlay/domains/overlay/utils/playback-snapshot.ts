export interface OverlayPlaybackSnapshotData {
  event: 'overlay.playback.snapshot.v1';
  contractVersion: 1;
  sessionId?: number | null;
  liveSessionId?: number | null;
  activeSessionId?: number | null;
  requestedSessionId?: number | null;
  // GATE 0 ordering key (top-level on the emitted snapshot, verified against
  // meloming-back OverlayPlaybackSnapshotDto / buildPlaybackSnapshot):
  //   sessionEpoch = LiveSession.id (autoincrement, monotonic per token; the
  //     just-ended session's id after live end; null only if no session ever existed)
  //   revision     = LiveSession.playbackRevision (monotonic per-session counter,
  //     bumped { increment: 1 } in-transaction on every state change; null with epoch)
  // Both nullable together: the reconciler applies without dedup when either is
  // missing (never coerce to 0, which would freeze on the first snapshot).
  sessionEpoch?: number | null;
  revision?: number | null;
  session?: {
    sessionId?: number | null;
    liveSessionId?: number | null;
    activeSessionId?: number | null;
    requestedSessionId?: number | null;
    isLive?: boolean | null;
    startedAt?: string | null;
    [key: string]: unknown;
  } | null;
  isLive?: boolean | null;
  startedAt?: string | null;
  queue?: unknown[];
  setlist?: unknown[];
  settings?: unknown;
  requestSettings?: unknown;
  nowPlaying?: unknown | null;
  omakase?: unknown | null;
  themeKey?: string | null;
  themes?: Record<string, string>;
  widgetConfigs?: unknown[];
  totalLayout?: Record<string, unknown>;
  layoutVersion?: number | null;
  layoutUpdatedAt?: string | null;
  totalLayoutVersion?: number | null;
  totalLayoutUpdatedAt?: string | null;
  resolvedThemes?: Record<string, string>;
  resolvedOptions?: Record<string, Record<string, unknown>>;
  widgetCustomCss?: Partial<Record<string, string | null>>;
  sourceMode?: string;
  [key: string]: unknown;
}

interface QueueSyncLike {
  nowPlaying?: unknown | null;
  playbackSnapshot?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string');
}

export function normalizePlaybackSnapshotItem(item: unknown): unknown {
  if (!isRecord(item)) {
    return item;
  }

  const song = isRecord(item.song) ? item.song : null;
  const rawSongArtist = song?.artist;
  const songArtist = isRecord(rawSongArtist) ? rawSongArtist : null;
  const id = toFiniteNumber(item.id) ?? toFiniteNumber(item.requestId);
  const songId = toFiniteNumber(item.songId) ?? toFiniteNumber(song?.id);
  const title = firstString(item.title, item.rawTitle, song?.title) ?? '';
  const artist =
    firstString(item.artist, item.rawArtist, songArtist?.name) ?? '';
  const albumArt = firstString(item.albumArt, song?.albumArt) ?? null;
  const requester = firstString(item.requester, item.requesterNickname) ?? '';

  return {
    ...item,
    ...(id ? { id } : {}),
    songId,
    title,
    artist,
    albumArt,
    requester,
    song:
      song ??
      (songId || title || artist || albumArt
        ? {
            id: songId ?? 0,
            title,
            artist: { name: artist },
            albumArt,
          }
        : undefined),
  };
}

export function isOverlayPlaybackSnapshotData(
  value: unknown,
): value is OverlayPlaybackSnapshotData {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.event === 'overlay.playback.snapshot.v1' &&
    value.contractVersion === 1
  );
}

export function getOverlayPlaybackSnapshot(
  data: { playbackSnapshot?: unknown } | null | undefined,
): OverlayPlaybackSnapshotData | null {
  return isOverlayPlaybackSnapshotData(data?.playbackSnapshot)
    ? data.playbackSnapshot
    : null;
}

export function resolveQueueSyncNowPlaying(
  data: QueueSyncLike | null | undefined,
): unknown | null | undefined {
  const snapshot = getOverlayPlaybackSnapshot(data);
  if (!snapshot || !hasOwn(snapshot, 'nowPlaying')) {
    return data?.nowPlaying;
  }

  if (snapshot.nowPlaying) {
    return normalizePlaybackSnapshotItem(snapshot.nowPlaying);
  }

  if (data?.nowPlaying) {
    return data.nowPlaying;
  }

  return snapshot.nowPlaying;
}
