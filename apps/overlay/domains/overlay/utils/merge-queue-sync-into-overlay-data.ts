import type { QueueSyncData } from '@/domains/overlay/hooks/use-overlay-socket';
import type {
  OverlayData,
  SongRequest as ApiSongRequest,
} from '@/domains/overlay/types/overlay';
import { resolveQueueSyncNowPlaying } from '@/domains/overlay/utils/playback-snapshot';

type ApiStatus = ApiSongRequest['status'];

const API_STATUSES = new Set<ApiStatus>([
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'PLAYING',
  'COMPLETED',
]);

function normalizeStatus(status: unknown, fallback: ApiStatus): ApiStatus {
  const upper = String(status ?? '').toUpperCase() as ApiStatus;
  return API_STATUSES.has(upper) ? upper : fallback;
}

export function toApiSongRequest(request: any, fallbackOrder: number): ApiSongRequest {
  const title = request?.rawTitle ?? request?.title ?? request?.song?.title ?? '';
  const artist =
    request?.rawArtist ?? request?.artist ?? request?.song?.artist?.name ?? '';
  const rawSongId = request?.song?.id ?? request?.songId;
  const songId =
    typeof rawSongId === 'number' || typeof rawSongId === 'string'
      ? Number(rawSongId)
      : null;
  const song =
    request?.song ??
    (songId || title || artist || request?.albumArt
      ? {
          id: Number.isFinite(songId) && songId ? songId : 0,
          title,
          artist: { name: artist },
          albumArt: request?.albumArt,
        }
      : undefined);

  return {
    id: request?.id,
    rawArtist: artist,
    rawTitle: title,
    requesterNickname: request?.requesterNickname ?? request?.requester ?? '',
    status: normalizeStatus(
      request?.status,
      fallbackOrder === 0 ? 'PLAYING' : 'PENDING',
    ),
    donationAmount: request?.donationAmount ?? undefined,
    isHomework:
      request?.isHomework ??
      (String(request?.source ?? '').toUpperCase() === 'HOMEWORK'),
    isRandom:
      request?.isRandom === true ||
      String(request?.requestType ?? '').toUpperCase() === 'RANDOM',
    requestType: request?.requestType,
    queueOrder: request?.queueOrder ?? request?.position ?? fallbackOrder,
    song,
    calculatedPrice: request?.calculatedPrice ?? undefined,
    priceSource: request?.priceSource ?? undefined,
    formattedPrice: request?.formattedPrice ?? undefined,
    availableChannels: request?.availableChannels,
  };
}

interface MergeQueueSyncOptions {
  allowNullNowPlaying?: boolean;
}

function normalizeSessionId(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

export function mergeQueueSyncIntoOverlayData(
  current: OverlayData | undefined,
  data: QueueSyncData | null | undefined,
  options: MergeQueueSyncOptions = {},
): OverlayData | undefined {
  if (!current || !data || typeof data !== 'object') {
    return current;
  }

  const next: OverlayData = { ...current };
  const currentSessionId = normalizeSessionId(current.sessionId);
  const incomingSessionId = normalizeSessionId(data.sessionId);
  const hasIncomingSession = incomingSessionId !== null;
  const isOlderSessionSync =
    currentSessionId !== null &&
    incomingSessionId !== null &&
    incomingSessionId < currentSessionId;
  const canMergeSessionSnapshot =
    hasIncomingSession && !isOlderSessionSync;

  if (canMergeSessionSnapshot) {
    next.sessionId = incomingSessionId;
  }
  if (canMergeSessionSnapshot && typeof data.isLive === 'boolean') {
    next.isLive = data.isLive;
  }
  if (canMergeSessionSnapshot && Array.isArray(data.queue)) {
    next.queue = data.queue.map((request, index) =>
      toApiSongRequest(request, index + 1),
    );
  }
  if (canMergeSessionSnapshot && Array.isArray(data.setlist)) {
    next.setlist = data.setlist.map((request, index) =>
      toApiSongRequest(request, index + 1),
    );
  }
  const resolvedNowPlaying = resolveQueueSyncNowPlaying(data);
  if (
    canMergeSessionSnapshot &&
    ('nowPlaying' in data || resolvedNowPlaying !== undefined)
  ) {
    if (resolvedNowPlaying) {
      next.nowPlaying = toApiSongRequest(resolvedNowPlaying, 0);
    } else if (options.allowNullNowPlaying) {
      next.nowPlaying = null;
    }
  }
  if ('settings' in data && data.settings) {
    next.settings = {
      ...(current.settings ?? {}),
      ...data.settings,
    } as OverlayData['settings'];
  }
  if ('omakase' in data) {
    next.omakase = data.omakase ?? null;
  }
  if (data.themes) {
    next.themes = data.themes;
  }
  if (Array.isArray(data.widgetConfigs)) {
    next.widgetConfigs = data.widgetConfigs as OverlayData['widgetConfigs'];
  }
  if (data.resolvedThemes) {
    next.resolvedThemes = data.resolvedThemes;
  }
  if (data.resolvedOptions) {
    next.resolvedOptions = data.resolvedOptions;
  }
  if (data.widgetCustomCss) {
    next.widgetCustomCss = data.widgetCustomCss;
  }
  if (data.totalLayout) {
    next.totalLayout = data.totalLayout;
  }
  if ('totalLayoutVersion' in data) {
    next.totalLayoutVersion = data.totalLayoutVersion ?? null;
  }
  if ('totalLayoutUpdatedAt' in data) {
    next.totalLayoutUpdatedAt = data.totalLayoutUpdatedAt ?? null;
  }
  if ('startedAt' in data) {
    next.startedAt = data.startedAt ?? null;
  }

  return next;
}
