'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { OmakaseStatus } from '@/meloming/domains/overlay/apis/omakase';
import type { PriceSource } from '@/meloming/domains/channel/types/pricing';
import { useFeatureFlag } from '@/meloming/shared/hooks/use-feature-flag';
import { rogichatApiOrigin } from '@/core/meloming-api-bridge';

const SOCKET_PATH = process.env.NEXT_PUBLIC_API_SOCKET_PATH || '/socket.io';
const AUTHORITATIVE_PLAYBACK_BUILD_ENABLED =
  process.env.NEXT_PUBLIC_OVERLAY_PLAYBACK_V1_ENABLED === 'true';
const AUTHORITATIVE_PLAYBACK_CANARY_REQUIRED =
  process.env.NEXT_PUBLIC_OVERLAY_PLAYBACK_V1_CANARY_REQUIRED === 'true';

const RECONNECTION_CONFIG = {
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
  randomizationFactor: 0.5,
  timeout: 20000,
};

export interface SongRequestCategory {
  id: number;
  name: string;
  color: string;
}

export interface SyncRequestAvailableChannel {
  channelId: number;
  channelName: string;
  webPath: string;
  profileImageUrl?: string | null;
  themeColor?: string | null;
}

export interface SongRequest {
  id: number;
  position: number;
  title: string;
  artist: string;
  requester: string;
  status: 'pending' | 'accepted' | 'playing' | 'completed' | 'rejected';
  isDonation?: boolean;
  donationAmount?: number;
  donationNativeAmount?: number | null;
  donationCurrency?: string | null;
  isHomework?: boolean;
  albumArt?: string;
  songId?: number;
  karaokeUrl?: string;
  coverUrl?: string | null;
  originalUrl?: string | null;
  mrVideoUrl?: string | null;
  lyricsText?: string | null;
  // 추가 Song 정보
  lyricsLink?: string | null;
  description?: string | null;
  difficulty?: number | null;
  proficiency?: number | null;
  songKey?: string | null;
  bpm?: number | null;
  preferredPitchSemitones?: number | null;
  preferredLyricsOffsetMs?: number | null;
  categories?: SongRequestCategory[];
  calculatedPrice?: number | null;
  priceSource?: PriceSource | null;
  formattedPrice?: string | null;
  completedAt?: string | null;
  rejectionReason?: string | null;
  availableChannels?: SyncRequestAvailableChannel[];
}

interface QueueSyncData {
  sessionId?: number | null;
  isLive?: boolean;
  queue: any[];
  settings: any;
  nowPlaying: any | null;
  omakase?: OmakaseStatus | null;
  themeKey?: string;
  themes?: Record<string, string>;
  widgetConfigs?: Array<{
    widgetType?: string;
    layoutType?: string;
    preset?: { options?: Record<string, unknown> } | null;
    themeKey?: string | null;
  }>;
  totalLayout?: Record<string, unknown>;
}

interface QueueReorderedData {
  queue: SongRequest[];
  setlist?: SongRequest[];
  omakase?: OmakaseStatus | null;
}

interface PlaybackSnapshotData {
  event: 'overlay.playback.snapshot.v1';
  contractVersion: 1;
  activeSessionId?: number | null;
  sessionEpoch?: number | null;
  revision?: number | null;
  isLive?: boolean;
  queue?: unknown[];
  nowPlaying?: unknown | null;
  omakase?: OmakaseStatus | null;
  requestSettings?: unknown;
}

export interface LyricsPlaybackStateData {
  songRequestId: number | null;
  playbackSource: 'video' | 'manual';
  /** anchor 시점의 곡 진행 위치(ms). */
  anchorMs: number;
  /** anchor 시점의 wall-clock(ISO). null = 정지. */
  anchorAt: string | null;
  playbackRate: number;
  /** 곡 총 길이(ms). 0 = 미상. */
  durationMs: number;
  offsetMs: number;
  clientInstanceId: string;
  emittedAt: string;
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

interface UseOverlaySocketOptions {
  widgetType: string;
  enabled?: boolean;
  onRequestAdded?: (request: SongRequest) => void;
  onRequestUpdated?: (request: SongRequest) => void;
  onRequestRemoved?: (requestId: number) => void;
  onQueueReordered?: (queue: SongRequest[], data?: QueueReorderedData) => void;
  onQueueSync?: (data: QueueSyncData) => void;
  onSyncError?: (error: string) => void;
  onThemeUpdated?: (data: { themeKey?: string; widgetType?: string }) => void;
  onLayoutUpdated?: (data: any) => void;
  onSettingsUpdated?: (settings: any) => void;
  onSessionStarted?: (data: { sessionId: number; settings: any; isLive: boolean }) => void;
  onSessionEnded?: (data: { sessionId: number; isLive: boolean }) => void;
  onLyricsPlaybackState?: (data: LyricsPlaybackStateData) => void;
  onConnectionStatusChange?: (status: ConnectionStatus) => void;
  onError?: (error: string) => void;
}

function parsePayload(payload: unknown): any {
  if (payload == null) {
    return null;
  }
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch {
      return payload;
    }
  }
  return payload;
}

function normalizeSnapshotRequest(value: unknown): any {
  if (!value || typeof value !== 'object') return value;
  const item = value as Record<string, any>;
  return {
    ...item,
    id: item.id ?? item.requestId,
    requester: item.requester ?? item.requesterNickname ?? '',
    requesterNickname: item.requesterNickname ?? item.requester ?? '',
    status:
      typeof item.status === 'string' ? item.status.toLowerCase() : item.status,
    song:
      item.song ??
      (item.songId || item.title || item.artist
        ? {
            id: item.songId ?? 0,
            title: item.title ?? item.rawTitle ?? '',
            artist: { name: item.artist ?? item.rawArtist ?? '' },
            albumArt: item.albumArt ?? null,
            coverUrl: item.coverUrl ?? null,
          }
        : null),
  };
}

function requestIdentity(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const id = item.id ?? item.requestId;
  return typeof id === 'number' ? id : null;
}

function mergeSnapshotRequest(value: unknown, detailed: unknown): any {
  const canonical = normalizeSnapshotRequest(value);
  if (!detailed || typeof detailed !== 'object') return canonical;
  const rich = detailed as Record<string, any>;
  const canonicalRecord = canonical as Record<string, any>;
  return {
    ...rich,
    ...canonicalRecord,
    song:
      rich.song || canonicalRecord.song
        ? {
            ...(rich.song ?? {}),
            ...(canonicalRecord.song ?? {}),
            artist:
              rich.song?.artist || canonicalRecord.song?.artist
                ? {
                    ...(rich.song?.artist ?? {}),
                    ...(canonicalRecord.song?.artist ?? {}),
                  }
                : undefined,
          }
        : null,
  };
}

function isPlaybackSnapshot(value: unknown): value is PlaybackSnapshotData {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  return (
    snapshot.event === 'overlay.playback.snapshot.v1' &&
    snapshot.contractVersion === 1 &&
    (snapshot.sessionEpoch === null || Number.isInteger(snapshot.sessionEpoch)) &&
    (snapshot.revision === null || Number.isInteger(snapshot.revision))
  );
}

export function useOverlaySocket(widgetId: string | null, options: UseOverlaySocketOptions) {
  const playbackCanaryEnabled = useFeatureFlag('overlayPlaybackV1');
  const authoritativePlaybackEnabled =
    AUTHORITATIVE_PLAYBACK_BUILD_ENABLED &&
    (!AUTHORITATIVE_PLAYBACK_CANARY_REQUIRED || playbackCanaryEnabled);
  const {
    widgetType,
    enabled = true,
    onRequestAdded,
    onRequestUpdated,
    onRequestRemoved,
    onQueueReordered,
    onQueueSync,
    onSyncError,
    onThemeUpdated,
    onLayoutUpdated,
    onSettingsUpdated,
    onSessionStarted,
    onSessionEnded,
    onLyricsPlaybackState,
    onConnectionStatusChange,
    onError,
  } = options;

  const socketRef = useRef<Socket | null>(null);
  const playbackVersionRef = useRef<{
    sessionEpoch: number | null;
    revision: number | null;
  }>({ sessionEpoch: null, revision: null });
  // Canonical playback owns ordering and state, while the existing REST/event
  // model remains the cache for console-only media/lyrics fields.
  const detailedQueueSyncRef = useRef<QueueSyncData | null>(null);
  const authoritativePlaybackEnabledRef = useRef(authoritativePlaybackEnabled);
  const [isConnected, setIsConnected] = useState(false);
  const [isJoined, setIsJoined] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  useEffect(() => {
    authoritativePlaybackEnabledRef.current = authoritativePlaybackEnabled;
    if (authoritativePlaybackEnabled && socketRef.current?.connected) {
      socketRef.current.emit('overlay:resume', playbackVersionRef.current);
    }
  }, [authoritativePlaybackEnabled]);

  const callbacksRef = useRef({
    onRequestAdded,
    onRequestUpdated,
    onRequestRemoved,
    onQueueReordered,
    onQueueSync,
    onSyncError,
    onThemeUpdated,
    onLayoutUpdated,
    onSettingsUpdated,
    onSessionStarted,
    onSessionEnded,
    onLyricsPlaybackState,
    onConnectionStatusChange,
    onError,
  });

  useEffect(() => {
    callbacksRef.current = {
      onRequestAdded,
      onRequestUpdated,
      onRequestRemoved,
      onQueueReordered,
      onQueueSync,
      onSyncError,
      onThemeUpdated,
      onLayoutUpdated,
      onSettingsUpdated,
      onSessionStarted,
      onSessionEnded,
        onLyricsPlaybackState,
      onConnectionStatusChange,
      onError,
    };
  }, [
    onRequestAdded,
    onRequestUpdated,
    onRequestRemoved,
    onQueueReordered,
    onQueueSync,
    onSyncError,
    onThemeUpdated,
    onLayoutUpdated,
    onSettingsUpdated,
    onSessionStarted,
    onSessionEnded,
    onLyricsPlaybackState,
    onConnectionStatusChange,
    onError,
  ]);

  const updateConnectionStatus = useCallback((status: ConnectionStatus) => {
    setConnectionStatus(status);
    callbacksRef.current.onConnectionStatusChange?.(status);
  }, []);

  useEffect(() => {
    if (!enabled || !widgetId || !widgetType) {
      return;
    }

    if (socketRef.current?.connected) {
      return;
    }

    updateConnectionStatus('connecting');

    const socket = io(rogichatApiOrigin(), {
      path: SOCKET_PATH,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: RECONNECTION_CONFIG.reconnectionAttempts,
      reconnectionDelay: RECONNECTION_CONFIG.reconnectionDelay,
      reconnectionDelayMax: RECONNECTION_CONFIG.reconnectionDelayMax,
      randomizationFactor: RECONNECTION_CONFIG.randomizationFactor,
      timeout: RECONNECTION_CONFIG.timeout,
      query: {
        widgetId,
        widgetType,
      },
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      setReconnectAttempt(0);
      updateConnectionStatus('connected');
    });

    socket.on('ready', () => {
      setIsJoined(true);
      if (authoritativePlaybackEnabledRef.current) {
        socket.emit('overlay:resume', playbackVersionRef.current);
      }
    });

    socket.on('disconnect', (reason) => {
      setIsConnected(false);
      setIsJoined(false);
      if (reason !== 'io server disconnect') {
        updateConnectionStatus('reconnecting');
      } else {
        updateConnectionStatus('disconnected');
      }
    });

    socket.io.on('reconnect_attempt', (attempt) => {
      setReconnectAttempt(attempt);
      updateConnectionStatus('reconnecting');
    });

    socket.io.on('reconnect_failed', () => {
      updateConnectionStatus('disconnected');
    });

    const handleOverlayEvent = (eventName: string | undefined, rawPayload: unknown) => {
      const payload = parsePayload(rawPayload);
      if (!eventName) {
        return;
      }

      switch (eventName) {
        case 'request.added': {
          const current = detailedQueueSyncRef.current;
          if (current) {
            detailedQueueSyncRef.current = {
              ...current,
              queue: [...current.queue, payload as SongRequest],
            };
          }
          callbacksRef.current.onRequestAdded?.(payload as SongRequest);
          break;
        }
        case 'request.updated': {
          const current = detailedQueueSyncRef.current;
          const updatedId = requestIdentity(payload);
          if (current && updatedId != null) {
            const merge = (item: any) =>
              requestIdentity(item) === updatedId ? { ...item, ...payload } : item;
            detailedQueueSyncRef.current = {
              ...current,
              queue: current.queue.map(merge),
              nowPlaying: current.nowPlaying ? merge(current.nowPlaying) : null,
            };
          }
          callbacksRef.current.onRequestUpdated?.(payload as SongRequest);
          break;
        }
        case 'request.removed': {
          const removedId = (payload as any)?.requestId ?? (payload as any)?.id;
          const current = detailedQueueSyncRef.current;
          if (current) {
            detailedQueueSyncRef.current = {
              ...current,
              queue: current.queue.filter((item) => requestIdentity(item) !== removedId),
            };
          }
          callbacksRef.current.onRequestRemoved?.(removedId);
          break;
        }
        case 'queue.reordered': {
          const reordered = (payload as any)?.queue ?? payload;
          if (detailedQueueSyncRef.current && Array.isArray(reordered)) {
            detailedQueueSyncRef.current = {
              ...detailedQueueSyncRef.current,
              queue: reordered,
            };
          }
          callbacksRef.current.onQueueReordered?.(
            reordered,
            payload && typeof payload === 'object' ? (payload as QueueReorderedData) : undefined,
          );
          break;
        }
        case 'queue.sync':
          if (payload && typeof (payload as any).isLive === 'boolean') {
            setIsLive(Boolean((payload as any).isLive));
          }
          detailedQueueSyncRef.current = payload as QueueSyncData;
          callbacksRef.current.onQueueSync?.(payload as QueueSyncData);
          break;
        case 'overlay.playback.snapshot.v1': {
          if (
            !authoritativePlaybackEnabledRef.current ||
            !isPlaybackSnapshot(payload)
          ) {
            break;
          }
          const epoch = payload.sessionEpoch ?? null;
          const revision = payload.revision ?? null;
          const current = playbackVersionRef.current;
          const newer =
            epoch != null &&
            revision != null &&
            (current.sessionEpoch == null ||
              epoch > current.sessionEpoch ||
              (epoch === current.sessionEpoch &&
                (current.revision == null || revision > current.revision)));
          if (!newer) break;
          playbackVersionRef.current = {
            sessionEpoch: epoch,
            revision,
          };
          if (typeof payload.isLive === 'boolean') setIsLive(payload.isLive);
          const detailed = detailedQueueSyncRef.current;
          const richItems = [detailed?.nowPlaying, ...(detailed?.queue ?? [])].filter(
            Boolean,
          );
          const detailedById = new Map(
            richItems
              .map((item) => [requestIdentity(item), item] as const)
              .filter((entry): entry is readonly [number, any] => entry[0] != null),
          );
          const mergeCanonical = (item: unknown) =>
            mergeSnapshotRequest(
              item,
              detailedById.get(requestIdentity(item) ?? -1),
            );
          callbacksRef.current.onQueueSync?.({
            ...(detailed ?? {}),
            sessionId: payload.activeSessionId ?? null,
            isLive: payload.isLive,
            queue: Array.isArray(payload.queue)
              ? payload.queue.map(mergeCanonical)
              : [],
            settings: {
              ...(detailed?.settings ?? {}),
              ...((payload.requestSettings as Record<string, unknown>) ?? {}),
            },
            nowPlaying: payload.nowPlaying
              ? mergeCanonical(payload.nowPlaying)
              : null,
            omakase:
              'omakase' in payload ? payload.omakase ?? null : detailed?.omakase,
          });
          break;
        }
        case 'theme.updated':
          callbacksRef.current.onThemeUpdated?.(payload as any);
          break;
        case 'layout.updated':
          callbacksRef.current.onLayoutUpdated?.(payload as any);
          break;
        case 'settings.updated':
          callbacksRef.current.onSettingsUpdated?.(payload);
          break;
        case 'session.started':
          setIsLive(true);
          callbacksRef.current.onSessionStarted?.(payload as any);
          break;
        case 'session.ended':
          setIsLive(false);
          callbacksRef.current.onSessionEnded?.(payload as any);
          break;
        case 'lyrics.playback.state':
          callbacksRef.current.onLyricsPlaybackState?.(payload as LyricsPlaybackStateData);
          break;
        default:
          break;
      }
    };

    socket.on('connect_error', (error) => {
      callbacksRef.current.onError?.(error?.message || 'socket error');
    });
    socket.on('overlay:sync:error', (error) => {
      const message = error?.message || 'sync error';
      callbacksRef.current.onSyncError?.(message);
      callbacksRef.current.onError?.(message);
    });

    socket.on('overlay:event', (message: Record<string, string>) => {
      handleOverlayEvent(message?.event, message?.payload);
    });

    socket.on('request.added', (payload) => handleOverlayEvent('request.added', payload));
    socket.on('request.updated', (payload) => handleOverlayEvent('request.updated', payload));
    socket.on('request.removed', (payload) => handleOverlayEvent('request.removed', payload));
    socket.on('queue.reordered', (payload) => handleOverlayEvent('queue.reordered', payload));
    socket.on('queue.sync', (payload) => handleOverlayEvent('queue.sync', payload));
    socket.on('theme.updated', (payload) => handleOverlayEvent('theme.updated', payload));
    socket.on('layout.updated', (payload) => handleOverlayEvent('layout.updated', payload));
    socket.on('settings.updated', (payload) => handleOverlayEvent('settings.updated', payload));
    socket.on('session.started', (payload) => handleOverlayEvent('session.started', payload));
    socket.on('session.ended', (payload) => handleOverlayEvent('session.ended', payload));
    socket.on('lyrics.playback.state', (payload) =>
      handleOverlayEvent('lyrics.playback.state', payload),
    );

    return () => {
      socket.disconnect();
      socketRef.current = null;
      playbackVersionRef.current = { sessionEpoch: null, revision: null };
      detailedQueueSyncRef.current = null;
      setIsConnected(false);
      setIsJoined(false);
      setIsLive(false);
      updateConnectionStatus('disconnected');
    };
  }, [widgetId, widgetType, enabled, updateConnectionStatus]);

  const reconnect = useCallback(() => {
    if (socketRef.current) {
      updateConnectionStatus('reconnecting');
      socketRef.current.disconnect();
      socketRef.current.connect();
    }
  }, [updateConnectionStatus]);

  const requestSync = useCallback((reason?: string) => {
    if (
      authoritativePlaybackEnabledRef.current &&
      (reason === 'play-next-success' || reason === 'queue.exhausted')
    ) {
      return;
    }
    if (!socketRef.current?.connected) {
      return;
    }
    socketRef.current.emit('overlay:sync', reason ? { reason } : undefined);
  }, []);

  const getConnectionInfo = useCallback(
    () => ({
      isConnected,
      isJoined,
      isLive,
      connectionStatus,
      reconnectAttempt,
      socketId: socketRef.current?.id,
    }),
    [isConnected, isJoined, isLive, connectionStatus, reconnectAttempt],
  );

  return {
    isConnected,
    isJoined,
    isLive,
    connectionStatus,
    reconnectAttempt,
    reconnect,
    requestSync,
    getConnectionInfo,
  };
}
