'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { OverlayChatEvent } from '@/domains/overlay/types/chat';
import {
  isOverlayPlaybackSnapshotData,
  type OverlayPlaybackSnapshotData,
} from '@/domains/overlay/utils/playback-snapshot';
import {
  reconcile,
  shouldFallbackToLegacy,
  type PlaybackReconcilerState,
} from '@/domains/overlay/state/playback-reconciler';
import type { OverlayWidgetType } from './use-widget-custom-css';

const SOCKET_BASE_URL =
  process.env.NEXT_PUBLIC_GATEWAY_BASE_URL ||
  process.env.NEXT_PUBLIC_GATEWAY_URL ||
  (typeof window !== 'undefined' ? window.location.origin : '') ||
  'http://localhost:3000';

const SOCKET_PATH = process.env.NEXT_PUBLIC_GATEWAY_SOCKET_PATH || '/socket.io';

const RECONNECTION_CONFIG = {
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
  randomizationFactor: 0.5,
  timeout: 20000,
};

const SYNC_REASON_PRIORITY = new Set([
  'request-terminal-recheck',
  'now-playing-null-recheck',
  'session.started',
  'session-mismatch-recheck',
  'session-unknown-recheck',
]);

// When the snapshot reader is on, these playback-session rechecks are redundant:
// the reconciler orders snapshots by (sessionEpoch, revision) and debounces null
// clears, so the legacy reject-and-refetch is never needed. Suppressing them is
// what removes the /overlay/:token/sync recheck storm (the meloming-back HPA driver).
// Queue-scoped rechecks (request-terminal-recheck) and session.started are NOT
// suppressed, and the reader staleness fallback still issues a legacy sync if a
// snapshot never arrives.
const READER_REDUNDANT_RECHECK_REASONS = new Set([
  'session-mismatch-recheck',
  'session-unknown-recheck',
  'now-playing-null-recheck',
]);

const LEGACY_PLAYBACK_MUTATION_EVENTS = new Set([
  'request.added',
  'request.updated',
  'request.removed',
  'queue.reordered',
  'omakase.updated',
  'settings.updated',
  'session.started',
  'session.ended',
]);

function chooseQueuedSyncReason(
  current: string | null,
  next?: string,
): string {
  if (!next) {
    return current ?? 'deferred';
  }
  if (!current) {
    return next;
  }
  if (SYNC_REASON_PRIORITY.has(next) && !SYNC_REASON_PRIORITY.has(current)) {
    return next;
  }
  return current;
}

interface QueuedSyncRequest {
  reason: string;
  sessionId?: number | null;
}

function normalizeSyncSessionId(sessionId?: number | null): number | undefined {
  if (
    typeof sessionId !== 'number' ||
    !Number.isFinite(sessionId) ||
    sessionId <= 0
  ) {
    return undefined;
  }
  return Math.trunc(sessionId);
}

function chooseQueuedSyncRequest(
  current: QueuedSyncRequest | null,
  reason?: string,
  sessionId?: number | null,
): QueuedSyncRequest {
  return {
    reason: chooseQueuedSyncReason(current?.reason ?? null, reason),
    sessionId: normalizeSyncSessionId(sessionId) ?? current?.sessionId ?? null,
  };
}

function buildSyncPayload(
  reason?: string,
  sessionId?: number | null,
): { reason?: string; sessionId?: number } | undefined {
  const normalizedSessionId = normalizeSyncSessionId(sessionId);
  if (!reason && !normalizedSessionId) {
    return undefined;
  }
  return {
    ...(reason ? { reason } : {}),
    ...(normalizedSessionId ? { sessionId: normalizedSessionId } : {}),
  };
}

/** 랜덤 신청 슬롯머신 후보 곡. 백엔드가 winner + decoy 합쳐 보내는 1회성 payload. */
export interface RandomSlotCandidate {
  id: number;
  title: string;
  artistName: string;
  albumArt: string | null;
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
  sessionId?: number | null;
  liveSessionId?: number | null;
  position: number;
  title: string;
  artist: string;
  requester: string;
  status: 'pending' | 'accepted' | 'playing' | 'completed' | 'rejected';
  isDonation?: boolean;
  donationAmount?: number;
  isHomework?: boolean;
  /** 랜덤 신청 (백엔드가 노래책에서 1곡 자동 추출). 일반 신청과 구분 표시용. */
  isRandom?: boolean;
  requestType?: 'NORMAL' | 'RANDOM';
  source?: string;
  /**
   * RANDOM 신청 시 슬롯머신 애니메이션용 후보 곡 (winner 포함, 첫번째 = winner).
   * request.added 이벤트에만 동봉. queue.reordered 등 후속 이벤트에는 없음.
   */
  randomSlotCandidates?: RandomSlotCandidate[] | null;
  albumArt?: string;
  songId?: number;
  karaokeUrl?: string;
  coverUrl?: string | null;
  originalUrl?: string | null;
  availableChannels?: SyncRequestAvailableChannel[];
}

export interface OverlayOmakase {
  enabled: boolean;
  displayName: string;
  count: number;
}

interface WidgetConfig {
  widgetType: string;
  layoutType?: string;
  presetId?: number | null;
  preset?: {
    id: number;
    name: string;
    layoutType: string;
    options: Record<string, unknown>;
    isDefault: boolean;
  } | null;
  themeKey?: string | null;
  layout?: Record<string, unknown>;
  layoutVersion?: number | null;
  layoutUpdatedAt?: string | null;
}

export interface QueueSyncData {
  sessionId?: number | null;
  isLive?: boolean;
  queue: any[];
  setlist?: any[];
  settings: any;
  nowPlaying: any | null;
  omakase?: OverlayOmakase | null;
  themeKey?: string;
  themes?: Record<string, string>;
  widgetConfigs?: WidgetConfig[];
  totalLayout?: Record<string, unknown>;
  totalLayoutVersion?: number | null;
  totalLayoutUpdatedAt?: string | null;
  resolvedThemes?: Record<string, string>;
  resolvedOptions?: Record<string, Record<string, unknown>>;
  widgetCustomCss?: Partial<Record<OverlayWidgetType, string | null>>;
  startedAt?: string | null;
  playbackSnapshot?: OverlayPlaybackSnapshotData | null;
}

/**
 * Reactive projection of the converged playback snapshot for the READER cutover
 * (Phase 4). Populated ONLY when `snapshotReaderEnabled` is passed; otherwise it
 * stays the stable `EMPTY_PLAYBACK_READER_VIEW` and never triggers a re-render,
 * so a reader-off overlay behaves exactly as today. Consumed by
 * `useSnapshotReader`, which also owns the staleness-fallback decision.
 */
export interface PlaybackReaderView {
  /** Converged snapshot (post-reconcile, hold-null applied), or null before first. */
  snapshot: OverlayPlaybackSnapshotData | null;
  /** ms a snapshot last converged; null if none yet. */
  lastSnapshotAt: number | null;
  /** ms a legacy queue.sync last arrived; null if none yet. */
  lastQueueSyncAt: number | null;
  /** Gateway resume probe health. Stalled readers yield to the warm legacy path. */
  stalled: boolean;
}

const EMPTY_PLAYBACK_READER_VIEW: PlaybackReaderView = {
  snapshot: null,
  lastSnapshotAt: null,
  lastQueueSyncAt: null,
  stalled: false,
};

const PLAYBACK_RESUME_PROBE_MS = 15_000;
const PLAYBACK_RESUME_STALL_MS = 45_000;
const PLAYBACK_PROGRESS_STALL_MS = 8_000;
const PLAYBACK_WATCHDOG_TICK_MS = 5_000;

/**
 * now-playing 컴포넌트 prop 타입. anchor 모델 통합 후엔 socket payload 가 아니라
 * `PlaybackProgressContext` 가 anchor 를 보간해서 derive 한 표시용 snapshot.
 */
export interface PlaybackProgressData {
  currentTime: number;
  duration: number;
  state: 'playing' | 'paused' | 'ended' | 'buffering' | 'unstarted';
  percentage: number;
  songRequestId?: number;
}

/**
 * 통합 anchor 모델 — video / manual 모두 동일.
 *   재생 중: anchorAt 시점에 곡이 anchorMs 위치 → `anchorMs + (now - anchorAt) * playbackRate`
 *   정지: anchorAt = null. anchorMs 가 곧 현재 위치.
 *   intent change(play/pause/seek/song change/rate change) 시에만 publish.
 */
export interface LyricsPlaybackStateData {
  songRequestId: number | null;
  playbackSource: 'video' | 'manual';
  anchorMs: number;
  anchorAt: string | null;
  playbackRate: number;
  /** 곡 총 길이(ms). nowsong widget progress bar 용. 0 = 미상. */
  durationMs: number;
  offsetMs: number;
  clientInstanceId: string;
  emittedAt: string;
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export interface ThemeConfigUpdatedData {
  resolvedThemes: Record<string, string>;
  resolvedOptions: Record<string, Record<string, unknown>>;
}

export interface WidgetCssUpdatedData {
  widgetType: OverlayWidgetType;
  customCss: string | null;
  isEnabled: boolean;
}

export interface RequestFeedbackData {
  sessionId: number;
  outcome: 'accepted' | 'rejected';
  reason?: string;
  nickname: string;
  rawArtist: string;
  rawTitle: string;
  rawMessage: string;
  source: 'CHAT' | 'DONATION';
}

export interface InfoDisplayData {
  sessionId: number;
  command: string;
  title: string;
  lines: string[];
  nickname?: string;
}

/**
 * `!노래책추가` 채팅 명령 결과 토스트 페이로드.
 *
 * outcome 별로 토스트 카피 결정 (consumer side):
 *  - accepted: "노래책에 추가했어요: {title} / {artistName}"
 *  - already_exists: "이미 노래책에 있어요: {title} / {artistName}"
 *  - rejected_no_match: "어떤 곡인지 못 찾았어요"
 *  - rejected_no_permission: "스트리머만 사용할 수 있어요"
 *  - low_confidence: "확신이 부족해요. 정확히 다시 입력해주세요"
 *  - error: "잠시 후 다시 시도해주세요"
 */
export interface SongbookAddFeedbackData {
  sessionId: number;
  outcome:
    | 'accepted'
    | 'already_exists'
    | 'rejected_no_match'
    | 'rejected_no_permission'
    | 'low_confidence'
    | 'error';
  /** 채팅 발화자 닉네임 (있을 수도 없을 수도). */
  nickname?: string;
  /** 사용자가 입력한 원 query. */
  query: string;
  /** 매칭/등록된 곡 (accepted / already_exists 케이스). */
  title?: string;
  artistName?: string;
  /** accepted 시 0~1 confidence (admin trace 용). 토스트엔 표시 X. */
  confidence?: number;
  /** low_confidence / rejected_no_match / error 사유 (디버그). */
  reason?: string;
}

export interface StreamerRandomCandidate {
  id: number;
  name: string;
  webPath: string;
  profileImageUrl: string | null;
  themeColor: string | null;
}

export interface SyncStreamerRandomData {
  sessionId: number;
  syncRoomId: number;
  syncRoomCode: string;
  requesterNickname?: string | null;
  donationNativeAmount?: number | null;
  donationCurrency?: string | null;
  sourceChannelId?: number | null;
  candidates: StreamerRandomCandidate[];
  winner: StreamerRandomCandidate;
}

interface UseOverlaySocketOptions {
  widgetType: string;
  enabled?: boolean;
  /**
   * When true, the hook maintains a reactive `playbackReaderView` (converged
   * snapshot + arrival timestamps) so widgets render authoritative playback.
   * Pass the result of `isAuthoritativePlaybackEnabled`; the deployment
   * default is enabled and explicit false is the rollback path.
   */
  snapshotReaderEnabled?: boolean;
  /** Preferred domain name for snapshotReaderEnabled. */
  authoritativePlaybackEnabled?: boolean;
  onRequestAdded?: (request: SongRequest) => void;
  onRequestUpdated?: (request: SongRequest) => void;
  onRequestRemoved?: (requestId: number) => void;
  onQueueReordered?: (queue: SongRequest[]) => void;
  /**
   * queue.reordered 이벤트의 setlist 필드. 백엔드는 PENDING(queue) + COMPLETED/
   * PLAYING/ACCEPTED까지 포함한 setlist를 함께 보낸다. setlist 위젯이 이 콜백을
   * 구독해야 다음곡 전환 시 이전 곡이 누적된다.
  */
  onSetlistReordered?: (setlist: SongRequest[]) => void;
  onOmakaseUpdated?: (omakase: OverlayOmakase | null) => void;
  onQueueSync?: (data: QueueSyncData) => void;
  onPlaybackSnapshot?: (data: OverlayPlaybackSnapshotData) => void;
  onSyncError?: (error: string) => void;
  onThemeConfigUpdated?: (data: ThemeConfigUpdatedData) => void;
  onWidgetCssUpdated?: (data: WidgetCssUpdatedData) => void;
  onLayoutUpdated?: (data: WidgetConfig) => void;
  onSettingsUpdated?: (settings: any) => void;
  onSessionStarted?: (data: { sessionId: number; settings: any; isLive: boolean }) => void;
  onSessionEnded?: (data: { sessionId: number; isLive: boolean }) => void;
  onLyricsPlaybackState?: (data: LyricsPlaybackStateData) => void;
  onChatMessage?: (message: OverlayChatEvent) => void;
  onDonation?: (message: OverlayChatEvent) => void;
  onRequestFeedback?: (data: RequestFeedbackData) => void;
  onInfoDisplay?: (data: InfoDisplayData) => void;
  onSongbookAddFeedback?: (data: SongbookAddFeedbackData) => void;
  onSyncStreamerRandom?: (data: SyncStreamerRandomData) => void;
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

function getMessageSessionId(message: Record<string, string>): number | null {
  const raw = message.sessionId ?? message.liveSessionId;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function withMessageSession<T>(payload: T, message: Record<string, string>): T {
  const sessionId = getMessageSessionId(message);
  if (!sessionId || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const record = payload as Record<string, unknown>;
  if (record.sessionId !== undefined || record.liveSessionId !== undefined) {
    return payload;
  }
  return {
    ...record,
    sessionId,
    liveSessionId: sessionId,
  } as T;
}

// ChatPlatform 계약은 lowercase이지만, 백엔드 전 구간(dispatcher/back/WS)이 아직
// 일관되지 않아 uppercase가 새어들 수 있다. 또한 schema drift로 null/number/객체
// 같은 비문자열이 섞일 수 있는데, 하류 테마 chatbox들은 `platform.toUpperCase()`
// 같은 문자열 메서드를 직접 호출하므로 여기서 문자열 보장까지 해준다.
function normalizeChatEventPlatform(payload: unknown): OverlayChatEvent {
  if (!payload || typeof payload !== 'object') {
    return payload as OverlayChatEvent;
  }
  const raw = (payload as { platform?: unknown }).platform;
  const normalized = typeof raw === 'string' ? raw.toLowerCase() : '';
  return {
    ...(payload as OverlayChatEvent),
    platform: normalized as OverlayChatEvent['platform'],
  };
}

export function useOverlaySocket(widgetId: string | null, options: UseOverlaySocketOptions) {
  const {
    widgetType,
    enabled = true,
    snapshotReaderEnabled: legacySnapshotReaderEnabled,
    authoritativePlaybackEnabled,
    onRequestAdded,
    onRequestUpdated,
    onRequestRemoved,
    onQueueReordered,
    onSetlistReordered,
    onOmakaseUpdated,
    onQueueSync,
    onPlaybackSnapshot,
    onSyncError,
    onThemeConfigUpdated,
    onWidgetCssUpdated,
    onLayoutUpdated,
    onSettingsUpdated,
    onSessionStarted,
    onSessionEnded,
    onLyricsPlaybackState,
    onChatMessage,
    onDonation,
    onRequestFeedback,
    onInfoDisplay,
    onSongbookAddFeedback,
    onSyncStreamerRandom,
    onConnectionStatusChange,
    onError,
  } = options;
  const snapshotReaderEnabled =
    authoritativePlaybackEnabled ?? legacySnapshotReaderEnabled ?? false;

  const socketRef = useRef<Socket | null>(null);
  const joinedRef = useRef(false);
  const pendingSyncRequestRef = useRef<QueuedSyncRequest | null>(null);
  // Converge the authoritative playback snapshot by (sessionEpoch, revision).
  // Playback widgets render this state while the authoritative path is healthy.
  const playbackReconcilerRef = useRef<PlaybackReconcilerState | null>(null);
  const lastSnapshotAtRef = useRef<number | null>(null);
  const lastQueueSyncAtRef = useRef<number | null>(null);
  const lastPlaybackAckAtRef = useRef<number | null>(null);
  const lastLegacyPlaybackMutationAtRef = useRef<number | null>(null);
  const playbackStalledRef = useRef(false);
  // Only updated for playback widgets that enabled the authoritative path.
  const snapshotReaderEnabledRef = useRef(snapshotReaderEnabled);
  const [playbackReaderView, setPlaybackReaderView] = useState<PlaybackReaderView>(
    EMPTY_PLAYBACK_READER_VIEW,
  );
  const [isConnected, setIsConnected] = useState(false);
  const [isJoined, setIsJoined] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const callbacksRef = useRef({
    onRequestAdded,
    onRequestUpdated,
    onRequestRemoved,
    onQueueReordered,
    onSetlistReordered,
    onOmakaseUpdated,
    onQueueSync,
    onPlaybackSnapshot,
    onSyncError,
    onThemeConfigUpdated,
    onWidgetCssUpdated,
    onLayoutUpdated,
    onSettingsUpdated,
    onSessionStarted,
    onSessionEnded,
    onLyricsPlaybackState,
    onChatMessage,
    onDonation,
    onRequestFeedback,
    onInfoDisplay,
    onSongbookAddFeedback,
    onSyncStreamerRandom,
    onConnectionStatusChange,
    onError,
  });

  useEffect(() => {
    callbacksRef.current = {
      onRequestAdded,
      onRequestUpdated,
      onRequestRemoved,
      onQueueReordered,
      onSetlistReordered,
      onOmakaseUpdated,
      onQueueSync,
      onPlaybackSnapshot,
      onSyncError,
      onThemeConfigUpdated,
      onWidgetCssUpdated,
      onLayoutUpdated,
      onSettingsUpdated,
      onSessionStarted,
      onSessionEnded,
      onLyricsPlaybackState,
      onChatMessage,
      onDonation,
      onRequestFeedback,
      onInfoDisplay,
      onSongbookAddFeedback,
      onSyncStreamerRandom,
      onConnectionStatusChange,
      onError,
    };
  }, [
    onRequestAdded,
    onRequestUpdated,
    onRequestRemoved,
    onQueueReordered,
    onSetlistReordered,
    onOmakaseUpdated,
    onQueueSync,
    onPlaybackSnapshot,
    onSyncError,
    onThemeConfigUpdated,
    onWidgetCssUpdated,
    onLayoutUpdated,
    onSettingsUpdated,
    onSessionStarted,
    onSessionEnded,
    onLyricsPlaybackState,
    onChatMessage,
    onDonation,
    onRequestFeedback,
    onInfoDisplay,
    onSongbookAddFeedback,
    onSyncStreamerRandom,
    onConnectionStatusChange,
    onError,
  ]);

  const updateConnectionStatus = useCallback((status: ConnectionStatus) => {
    setConnectionStatus(status);
    callbacksRef.current.onConnectionStatusChange?.(status);
  }, []);

  // Keep the reader-enabled flag in a ref so the socket effect (created once per
  // token) reads the live value without reconnecting when the flag flips on
  // after `overlayData` loads (webPath-matched allowlist).
  useEffect(() => {
    snapshotReaderEnabledRef.current = snapshotReaderEnabled;
    if (!snapshotReaderEnabled) {
      // Flag turned off: drop the reader view so no widget keeps rendering from
      // a stale snapshot (returns the overlay to its legacy path immediately).
      setPlaybackReaderView((prev) =>
        prev === EMPTY_PLAYBACK_READER_VIEW ? prev : EMPTY_PLAYBACK_READER_VIEW,
      );
      lastPlaybackAckAtRef.current = null;
      playbackStalledRef.current = false;
      return;
    }

    // A webPath allowlist can become known after the socket's initial replay.
    // Promote any shadow-converged snapshot and explicitly resume at that point.
    const now = Date.now();
    lastPlaybackAckAtRef.current = now;
    playbackStalledRef.current = false;
    const current = playbackReconcilerRef.current?.snapshot ?? null;
    if (current) {
      setPlaybackReaderView({
        snapshot: current,
        lastSnapshotAt: lastSnapshotAtRef.current,
        lastQueueSyncAt: lastQueueSyncAtRef.current,
        stalled: false,
      });
    }
    const socket = socketRef.current;
    if (socket?.connected && joinedRef.current) {
      socket.emit('overlay:resume', {
        sessionEpoch: current?.sessionEpoch ?? null,
        revision: current?.revision ?? null,
      });
    }
  }, [snapshotReaderEnabled]);

  // Lightweight socket liveness lane. No REST polling is involved while the
  // gateway acknowledges resume probes. If acknowledgements stop, the reader
  // steps aside and the existing low-frequency recovery sync becomes eligible.
  useEffect(() => {
    if (!enabled || !snapshotReaderEnabled) return;
    const tick = () => {
      const socket = socketRef.current;
      if (!socket?.connected || !joinedRef.current) return;
      const now = Date.now();
      const lastAckAt = lastPlaybackAckAtRef.current;
      const ackAge = lastAckAt == null ? Infinity : now - lastAckAt;
      if (ackAge >= PLAYBACK_RESUME_PROBE_MS) {
        const current = playbackReconcilerRef.current?.snapshot;
        socket.emit('overlay:resume', {
          sessionEpoch: current?.sessionEpoch ?? null,
          revision: current?.revision ?? null,
        });
      }
      const lastMutationAt = lastLegacyPlaybackMutationAtRef.current;
      const progressStalled =
        lastMutationAt != null &&
        now - lastMutationAt >= PLAYBACK_PROGRESS_STALL_MS &&
        shouldFallbackToLegacy(
          lastSnapshotAtRef.current,
          lastMutationAt,
          now,
          PLAYBACK_PROGRESS_STALL_MS,
        );
      const stalled =
        ackAge >= PLAYBACK_RESUME_STALL_MS || progressStalled;
      if (playbackStalledRef.current !== stalled) {
        playbackStalledRef.current = stalled;
        setPlaybackReaderView((prev) => ({ ...prev, stalled }));
      }
    };
    const timer = window.setInterval(tick, PLAYBACK_WATCHDOG_TICK_MS);
    return () => window.clearInterval(timer);
  }, [enabled, snapshotReaderEnabled]);

  useEffect(() => {
    if (!enabled || !widgetId || !widgetType) {
      return;
    }

    if (socketRef.current?.connected) {
      return;
    }

    updateConnectionStatus('connecting');

    const socket = io(SOCKET_BASE_URL, {
      path: SOCKET_PATH,
      transports: ['websocket'],
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
      lastPlaybackAckAtRef.current = Date.now();
      playbackStalledRef.current = false;
      setIsConnected(true);
      setReconnectAttempt(0);
      updateConnectionStatus('connected');
    });

    socket.on('ready', () => {
      joinedRef.current = true;
      setIsJoined(true);
      if (snapshotReaderEnabledRef.current) {
        const current = playbackReconcilerRef.current?.snapshot;
        socket.emit('overlay:resume', {
          sessionEpoch: current?.sessionEpoch ?? null,
          revision: current?.revision ?? null,
        });
      }
      const pendingSync = pendingSyncRequestRef.current;
      if (pendingSync) {
        pendingSyncRequestRef.current = null;
        socket.emit(
          'overlay:sync',
          buildSyncPayload(pendingSync.reason, pendingSync.sessionId),
        );
      }
    });

    socket.on('disconnect', (reason) => {
      joinedRef.current = false;
      playbackStalledRef.current = true;
      setPlaybackReaderView((prev) => ({ ...prev, stalled: true }));
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

    socket.on('connect_error', (error) => {
      callbacksRef.current.onError?.(error?.message || 'socket error');
    });
    socket.on('overlay:sync:error', (error) => {
      const message = error?.message || 'sync error';
      callbacksRef.current.onSyncError?.(message);
      callbacksRef.current.onError?.(message);
    });
    socket.on('overlay:resume:ack', (ack) => {
      if (!ack?.available) {
        playbackStalledRef.current = true;
        setPlaybackReaderView((prev) => ({ ...prev, stalled: true }));
        return;
      }
      lastPlaybackAckAtRef.current = Date.now();
      const now = Date.now();
      const lastMutationAt = lastLegacyPlaybackMutationAtRef.current;
      const progressStalled =
        lastMutationAt != null &&
        now - lastMutationAt >= PLAYBACK_PROGRESS_STALL_MS &&
        shouldFallbackToLegacy(
          lastSnapshotAtRef.current,
          lastMutationAt,
          now,
          PLAYBACK_PROGRESS_STALL_MS,
        );
      if (playbackStalledRef.current && !progressStalled) {
        playbackStalledRef.current = false;
        setPlaybackReaderView((prev) => ({ ...prev, stalled: false }));
      }
    });

    // Feed both snapshot carriers (embedded-in-queue.sync and the standalone
    // overlay.playback.snapshot.v1) into the reconciler. Uses only refs + a pure
    // function, so it is safe to close over inside this effect.
    const ingestPlaybackSnapshot = (snapshot: OverlayPlaybackSnapshotData) => {
      const now = Date.now();
      lastPlaybackAckAtRef.current = now;
      const result = reconcile(playbackReconcilerRef.current, snapshot, now);
      const next = result.next;
      playbackReconcilerRef.current = next;
      if (result.action !== 'apply') return;
      lastSnapshotAtRef.current = now;
      lastLegacyPlaybackMutationAtRef.current = null;
      playbackStalledRef.current = false;
      if (snapshotReaderEnabledRef.current) {
        // Publish the converged snapshot (hold-null applied) reactively so the
        // reader re-renders. Only when the reader flag is on -> zero re-render
        // cost when off.
        setPlaybackReaderView({
          snapshot: next.snapshot,
          lastSnapshotAt: now,
          lastQueueSyncAt: lastQueueSyncAtRef.current,
          stalled: false,
        });
      }
    };

    socket.on('overlay:event', (message: Record<string, string>) => {
      const eventName = message?.event;
      const payload = withMessageSession(parsePayload(message?.payload), message);
      if (!eventName) {
        return;
      }

      if (LEGACY_PLAYBACK_MUTATION_EVENTS.has(eventName)) {
        lastLegacyPlaybackMutationAtRef.current = Date.now();
      }

      switch (eventName) {
        case 'request.added':
          callbacksRef.current.onRequestAdded?.(payload as SongRequest);
          break;
        case 'request.updated':
          callbacksRef.current.onRequestUpdated?.(payload as SongRequest);
          break;
        case 'request.removed':
          callbacksRef.current.onRequestRemoved?.(
            (payload as any)?.requestId ?? (payload as any)?.id,
          );
          break;
        case 'queue.reordered': {
          const p = payload as any;
          // Payload is `{ queue, setlist }` from backend. Legacy fallback: if
          // only an array arrives, treat it as queue.
          const queuePayload = p?.queue ?? (Array.isArray(p) ? p : []);
          const setlistPayload = p?.setlist;
          callbacksRef.current.onQueueReordered?.(queuePayload);
          if (Array.isArray(setlistPayload)) {
            callbacksRef.current.onSetlistReordered?.(setlistPayload);
          }
          if (p && typeof p === 'object' && 'omakase' in p) {
            callbacksRef.current.onOmakaseUpdated?.(p.omakase ?? null);
          }
          break;
        }
        case 'queue.sync': {
          // Legacy queue.sync arrival time (reader staleness fallback F3 uses
          // this to degrade to legacy when snapshots stall).
          const queueSyncAt = Date.now();
          lastQueueSyncAtRef.current = queueSyncAt;
          if (payload && typeof (payload as any).isLive === 'boolean') {
            setIsLive(Boolean((payload as any).isLive));
          }
          const playbackSnapshot = (payload as QueueSyncData)?.playbackSnapshot;
          if (isOverlayPlaybackSnapshotData(playbackSnapshot)) {
            callbacksRef.current.onPlaybackSnapshot?.(playbackSnapshot);
            ingestPlaybackSnapshot(playbackSnapshot);
          } else if (snapshotReaderEnabledRef.current) {
            // No embedded snapshot (publish off / stalled): refresh the reader
            // view so `shouldFallbackToLegacy` re-evaluates against this newer
            // queue.sync and the reader steps aside to the legacy path.
            setPlaybackReaderView({
              snapshot: playbackReconcilerRef.current?.snapshot ?? null,
              lastSnapshotAt: lastSnapshotAtRef.current,
              lastQueueSyncAt: queueSyncAt,
              stalled: playbackStalledRef.current,
            });
          }
          if (payload && typeof payload === 'object' && 'omakase' in payload) {
            callbacksRef.current.onOmakaseUpdated?.(
              (payload as QueueSyncData).omakase ?? null,
            );
          }
          callbacksRef.current.onQueueSync?.(payload as QueueSyncData);
          break;
        }
        case 'overlay.playback.snapshot.v1':
          if (isOverlayPlaybackSnapshotData(payload)) {
            callbacksRef.current.onPlaybackSnapshot?.(payload);
            ingestPlaybackSnapshot(payload);
          }
          break;
        case 'theme-config.updated':
        case 'channel-theme.updated': // dual-receive during backend transition
          callbacksRef.current.onThemeConfigUpdated?.(payload as ThemeConfigUpdatedData);
          break;
        case 'widget-css.updated':
          callbacksRef.current.onWidgetCssUpdated?.(payload as WidgetCssUpdatedData);
          break;
        case 'overlay.refresh':
          if (typeof window !== 'undefined') {
            window.location.reload();
          }
          break;
        case 'layout.updated':
          callbacksRef.current.onLayoutUpdated?.(payload as WidgetConfig);
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
        case 'chat.message':
          callbacksRef.current.onChatMessage?.(normalizeChatEventPlatform(payload));
          break;
        case 'chat.donation':
          callbacksRef.current.onDonation?.(normalizeChatEventPlatform(payload));
          break;
        case 'request.feedback':
          console.log('[overlay] request.feedback received', payload);
          callbacksRef.current.onRequestFeedback?.(payload as RequestFeedbackData);
          break;
        case 'info.display':
          console.log('[overlay] info.display received', payload);
          callbacksRef.current.onInfoDisplay?.(payload as InfoDisplayData);
          break;
        case 'songbook-add.feedback':
          callbacksRef.current.onSongbookAddFeedback?.(
            payload as SongbookAddFeedbackData,
          );
          break;
        case 'sync.streamer-random':
          callbacksRef.current.onSyncStreamerRandom?.(
            payload as SyncStreamerRandomData,
          );
          break;
        default:
          break;
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      joinedRef.current = false;
      pendingSyncRequestRef.current = null;
      // Fresh convergence baseline for a new token/unmount. (Transient reconnects
      // do not re-run this effect, so converged playback survives reconnect.)
      playbackReconcilerRef.current = null;
      lastSnapshotAtRef.current = null;
      lastQueueSyncAtRef.current = null;
      lastPlaybackAckAtRef.current = null;
      lastLegacyPlaybackMutationAtRef.current = null;
      playbackStalledRef.current = false;
      setPlaybackReaderView((prev) =>
        prev === EMPTY_PLAYBACK_READER_VIEW ? prev : EMPTY_PLAYBACK_READER_VIEW,
      );
      setIsConnected(false);
      setIsJoined(false);
      setIsLive(false);
      updateConnectionStatus('disconnected');
    };
  }, [widgetId, widgetType, enabled, updateConnectionStatus]);

  const reconnect = useCallback(() => {
    if (socketRef.current) {
      pendingSyncRequestRef.current = chooseQueuedSyncRequest(
        pendingSyncRequestRef.current,
        'manual-reconnect',
      );
      updateConnectionStatus('reconnecting');
      socketRef.current.disconnect();
      socketRef.current.connect();
    }
  }, [updateConnectionStatus]);

  const requestSync = useCallback(
    (reason?: string, sessionId?: number | null) => {
      if (
        reason &&
        snapshotReaderEnabledRef.current &&
        READER_REDUNDANT_RECHECK_REASONS.has(reason)
      ) {
        // Reader path: the reconciler already handles session ordering and null-clear
        // debounce, so this recheck /sync is redundant and is the sync storm. Suppress.
        return;
      }
      if (
        reason === 'interval' &&
        snapshotReaderEnabledRef.current &&
        !playbackStalledRef.current &&
        socketRef.current?.connected &&
        joinedRef.current
      ) {
        // Authoritative playback is replayed from Redis on reconnect and then
        // delivered by the stream. A healthy socket does not need REST polling.
        return;
      }
      if (!socketRef.current?.connected || !joinedRef.current) {
        pendingSyncRequestRef.current = chooseQueuedSyncRequest(
          pendingSyncRequestRef.current,
          reason,
          sessionId,
        );
        return;
      }
      socketRef.current.emit('overlay:sync', buildSyncPayload(reason, sessionId));
    },
    [],
  );

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

  // Returns the converged playback snapshot plus arrival timestamps used by the
  // authoritative-path staleness fallback.
  const getPlaybackReconcilerState = useCallback(
    () => ({
      state: playbackReconcilerRef.current,
      lastSnapshotAt: lastSnapshotAtRef.current,
      lastQueueSyncAt: lastQueueSyncAtRef.current,
    }),
    [],
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
    getPlaybackReconcilerState,
    // Reactive converged snapshot + arrival timestamps. Stable empty object for
    // non-playback widgets and when the authoritative path is explicitly off.
    playbackReaderView,
    authoritativePlaybackView: playbackReaderView,
  };
}
