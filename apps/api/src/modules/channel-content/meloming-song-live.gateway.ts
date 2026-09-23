import type { Server as HttpServer } from 'node:http';
import { HttpAdapterHost } from '@nestjs/core';
import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import { LifecycleState } from '../../common/lifecycle/lifecycle-state.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';

/** Transport boundary for the copied Meloming /song-live Socket.IO client. */
@Injectable()
export class MelomingSongLiveGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly io: Server;
  private attached = false;

  constructor(
    @Inject(HttpAdapterHost) private readonly host: HttpAdapterHost,
    @Inject(AUTH_CONFIG) config: AuthConfig,
    @Inject(LifecycleState) private readonly lifecycle: LifecycleState,
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
          Object.keys(data).length !== 1 || (data as { identifier?: unknown }).identifier !== 'hurogi') {
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
  }

  onApplicationBootstrap(): void {
    if (this.attached) return;
    this.io.attach(this.host.httpAdapter.getHttpServer() as HttpServer);
    this.attached = true;
  }

  broadcast(event: 'request.added' | 'request.updated' | 'request.removed' | 'queue.reordered' |
    'settings.updated' | 'session.started' | 'session.ended', payload: { sessionId?: number; requestId?: number; isLive?: boolean }): void {
    if (!this.lifecycle.draining) this.io.of('/song-live').to('song-live:channel:1').emit(event, payload);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.attached) await new Promise<void>(resolve => { void this.io.close(() => resolve()); });
  }
}
