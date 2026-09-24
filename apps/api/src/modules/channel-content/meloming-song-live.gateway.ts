import { isChannelIdentifier } from './channel-identity.js';
import type { Server as HttpServer } from 'node:http';
import { HttpAdapterHost } from '@nestjs/core';
import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import { LifecycleState } from '../../common/lifecycle/lifecycle-state.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { SongRequestService } from './upstream/song-request.service.js';

/** Transport boundary for the copied Meloming /song-live Socket.IO client. */
@Injectable()
export class MelomingSongLiveGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly io: Server;
  private attached = false;

  constructor(
    @Inject(HttpAdapterHost) private readonly host: HttpAdapterHost,
    @Inject(AUTH_CONFIG) config: AuthConfig,
    @Inject(LifecycleState) private readonly lifecycle: LifecycleState,
    @Inject(Transactions) private readonly transactions: Transactions,
  ) {
    this.io = new Server({
      path: '/socket.io', transports: ['websocket', 'polling'], serveClient: false,
      maxHttpBufferSize: 1024, perMessageDeflate: false, httpCompression: false,
      connectTimeout: 5000, pingInterval: 25000, pingTimeout: 20000,
      cors: { origin: config.origin, credentials: true },
      allowRequest: (request, callback) => callback(null,
        !this.lifecycle.draining && request.headers.origin === config.origin &&
        request.url !== undefined && request.url.length <= 2048 &&
        this.io.engine.clientsCount < 500),
    });
    const namespace = this.io.of('/song-live');
    namespace.on('connection', (socket: Socket) => {
      if (this.lifecycle.draining) { socket.disconnect(true); return; }
      socket.on('join', (data: unknown) => {
        if (!data || typeof data !== 'object' || Array.isArray(data) ||
          Object.keys(data).length !== 1 || !isChannelIdentifier((data as { identifier?: unknown }).identifier)) {
          socket.emit('error', { message: 'Invalid channel identifier' });
          return;
        }
        void socket.join('song-live:channel:1');
        socket.emit('joined', { channelId: 1, room: 'song-live:channel:1', session: null });
      });
      socket.on('leave', () => {
        void socket.leave('song-live:channel:1');
        socket.emit('left', { message: 'Successfully left song-live room' });
      });
      socket.onAny((event: string) => { if (event !== 'join' && event !== 'leave') socket.disconnect(true); });
    });
    this.io.on('connection', (socket: Socket) => {
      if (this.lifecycle.draining) { socket.disconnect(true); return; }
      const token = socket.handshake.query.widgetId;
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
        socket.disconnect(true);
        return;
      }
      void this.transactions.read(async tx => tx.prisma.liveSession.findFirst({
        where: { overlayToken: token }, select: { id: true },
      })).then(session => {
        if (!session || this.lifecycle.draining || !socket.connected) { socket.disconnect(true); return; }
        void socket.join(`overlay:${token}`);
        socket.emit('ready');
        void this.snapshot(token).then(snapshot => {
          if (snapshot && socket.connected) socket.emit('queue.sync', snapshot);
        }).catch(() => socket.emit('overlay:sync:error', { message: '동기화에 실패했습니다.' }));
      }).catch(() => socket.disconnect(true));
      socket.on('overlay:resume', () => {
        void this.snapshot(token).then(snapshot => {
          if (snapshot && socket.connected) socket.emit('queue.sync', snapshot);
        }).catch(() => socket.emit('overlay:sync:error', { message: '동기화에 실패했습니다.' }));
      });
    });
  }

  private snapshot(token: string) {
    return this.transactions.read(async tx => {
      const session = await tx.prisma.liveSession.findFirst({
        where: { overlayToken: token }, select: { id: true, channelId: true, status: true,
          settings: true },
      });
      if (!session) return null;
      const requests = new SongRequestService(tx.prisma, session.channelId);
      const queue = (await requests.getQueueBySessionId(session.id)).requests;
      const nowPlaying = await requests.getNowPlaying(session.id);
      return { sessionId: session.id, isLive: session.status === 'ACTIVE',
        queue, nowPlaying, settings: session.settings, omakase: null };
    });
  }

  private async refreshOverlay(): Promise<void> {
    const active = await this.transactions.read(async tx => tx.prisma.liveSession.findMany({
      where: { status: 'ACTIVE' }, select: { overlayToken: true },
    }));
    for (const { overlayToken } of active) {
      const snapshot = await this.snapshot(overlayToken);
      if (snapshot) this.io.to(`overlay:${overlayToken}`).emit('queue.sync', snapshot);
    }
  }

  onApplicationBootstrap(): void {
    if (this.attached) return;
    this.io.attach(this.host.httpAdapter.getHttpServer() as HttpServer);
    this.attached = true;
  }

  broadcast(event: 'request.added' | 'request.updated' | 'request.removed' | 'queue.reordered' |
    'settings.updated' | 'session.started' | 'session.ended', payload: { sessionId?: number; requestId?: number; isLive?: boolean }): void {
    if (this.lifecycle.draining) return;
    this.io.of('/song-live').to('song-live:channel:1').emit(event, payload);
    void this.refreshOverlay().catch(() => undefined);
  }

  broadcastLyricsPlaybackState(overlayToken: string, state: Record<string, unknown>): void {
    if (this.lifecycle.draining) return;
    this.io.to(`overlay:${overlayToken}`).emit('lyrics.playback.state', state);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.attached) await new Promise<void>(resolve => { void this.io.close(() => resolve()); });
  }
}
