'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

const SOCKET_PATH = process.env.NEXT_PUBLIC_API_SOCKET_PATH || '/socket.io';

const RECONNECTION_CONFIG = {
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
  randomizationFactor: 0.5,
  timeout: 20000,
};

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export interface SongLiveEventPayload {
  sessionId?: number;
  requestId?: number;
  settings?: any;
  isLive?: boolean;
}

interface UseSongLiveSocketOptions {
  enabled?: boolean;
  onJoined?: (payload: {
    channelId: number;
    room: string;
    session: any | null;
  }) => void;
  onRequestAdded?: (payload: SongLiveEventPayload) => void;
  onRequestUpdated?: (payload: SongLiveEventPayload) => void;
  onRequestRemoved?: (payload: SongLiveEventPayload) => void;
  onQueueReordered?: (payload: SongLiveEventPayload) => void;
  onSettingsUpdated?: (payload: SongLiveEventPayload) => void;
  onSessionStarted?: (payload: SongLiveEventPayload) => void;
  onSessionEnded?: (payload: SongLiveEventPayload) => void;
  onConnectionStatusChange?: (status: ConnectionStatus) => void;
  onError?: (error: string) => void;
}

export function useSongLiveSocket(
  identifier: string | undefined,
  options: UseSongLiveSocketOptions,
) {
  const {
    enabled = true,
    onJoined,
    onRequestAdded,
    onRequestUpdated,
    onRequestRemoved,
    onQueueReordered,
    onSettingsUpdated,
    onSessionStarted,
    onSessionEnded,
    onConnectionStatusChange,
    onError,
  } = options;

  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isJoined, setIsJoined] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('disconnected');

  const callbacksRef = useRef({
    onJoined,
    onRequestAdded,
    onRequestUpdated,
    onRequestRemoved,
    onQueueReordered,
    onSettingsUpdated,
    onSessionStarted,
    onSessionEnded,
    onConnectionStatusChange,
    onError,
  });

  useEffect(() => {
    callbacksRef.current = {
      onJoined,
      onRequestAdded,
      onRequestUpdated,
      onRequestRemoved,
      onQueueReordered,
      onSettingsUpdated,
      onSessionStarted,
      onSessionEnded,
      onConnectionStatusChange,
      onError,
    };
  }, [
    onJoined,
    onRequestAdded,
    onRequestUpdated,
    onRequestRemoved,
    onQueueReordered,
    onSettingsUpdated,
    onSessionStarted,
    onSessionEnded,
    onConnectionStatusChange,
    onError,
  ]);

  const updateConnectionStatus = useCallback((status: ConnectionStatus) => {
    setConnectionStatus(status);
    callbacksRef.current.onConnectionStatusChange?.(status);
  }, []);

  useEffect(() => {
    if (!enabled || !identifier) {
      return;
    }

    if (socketRef.current?.connected) {
      return;
    }

    updateConnectionStatus('connecting');

    const socket = io(`${SOCKET_BASE_URL}/song-live`, {
      path: SOCKET_PATH,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: RECONNECTION_CONFIG.reconnectionAttempts,
      reconnectionDelay: RECONNECTION_CONFIG.reconnectionDelay,
      reconnectionDelayMax: RECONNECTION_CONFIG.reconnectionDelayMax,
      randomizationFactor: RECONNECTION_CONFIG.randomizationFactor,
      timeout: RECONNECTION_CONFIG.timeout,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      setIsJoined(false);
      updateConnectionStatus('connected');
      socket.emit('join', { identifier });
    });

    socket.on('joined', (payload) => {
      setIsJoined(true);
      callbacksRef.current.onJoined?.(payload);
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

    socket.io.on('reconnect_attempt', () => {
      updateConnectionStatus('reconnecting');
    });

    socket.io.on('reconnect_failed', () => {
      updateConnectionStatus('disconnected');
    });

    socket.on('connect_error', (error) => {
      callbacksRef.current.onError?.(error?.message || 'socket error');
    });

    socket.on('request.added', (payload: SongLiveEventPayload) => {
      callbacksRef.current.onRequestAdded?.(payload);
    });
    socket.on('request.updated', (payload: SongLiveEventPayload) => {
      callbacksRef.current.onRequestUpdated?.(payload);
    });
    socket.on('request.removed', (payload: SongLiveEventPayload) => {
      callbacksRef.current.onRequestRemoved?.(payload);
    });
    socket.on('queue.reordered', (payload: SongLiveEventPayload) => {
      callbacksRef.current.onQueueReordered?.(payload);
    });
    socket.on('settings.updated', (payload: SongLiveEventPayload) => {
      callbacksRef.current.onSettingsUpdated?.(payload);
    });
    socket.on('session.started', (payload: SongLiveEventPayload) => {
      callbacksRef.current.onSessionStarted?.(payload);
    });
    socket.on('session.ended', (payload: SongLiveEventPayload) => {
      callbacksRef.current.onSessionEnded?.(payload);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setIsConnected(false);
      setIsJoined(false);
      updateConnectionStatus('disconnected');
    };
  }, [enabled, identifier, updateConnectionStatus]);

  return {
    isConnected,
    isJoined,
    connectionStatus,
  };
}
