import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger, OnApplicationShutdown } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { ChatMessage, DonationEvent } from './chat.types';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService } from '../session.service';
import { SONG_REQUEST_EVENTS } from '../../song-request/events/song-request.events';
import { ChannelService } from '../../channel/channel.service';

/**
 * 신청곡 라이브 WebSocket Gateway
 * 채팅 메시지와 후원 이벤트를 클라이언트에게 전달
 */
@WebSocketGateway({
  namespace: '/song-live',
  cors: {
    origin: '*', // TODO: 프로덕션 환경에서는 제한 필요
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class ChatGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnApplicationShutdown
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private readonly clientMeta = new Map<
    string,
    { room: string; channelId: number | null; lastActive: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly channelService: ChannelService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('ChatGateway initialized');
  }

  /** Graceful shutdown — 클라이언트에 재연결 알림 후 연결 종료 */
  async onApplicationShutdown(): Promise<void> {
    try {
      this.server?.emit('server_shutdown', { reconnectIn: 2000 });
      await new Promise((resolve) => setTimeout(resolve, 2000));
      this.server?.disconnectSockets(true);
      this.clientMeta.clear();
      this.logger.log('Chat gateway shutdown complete');
    } catch (error) {
      this.logger.error(`Chat gateway shutdown error: ${error}`);
    }
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
    this.clientMeta.set(client.id, {
      room: '',
      channelId: null,
      lastActive: Date.now(),
    });
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.clientMeta.delete(client.id);
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { identifier?: string },
  ) {
    const identifier = data?.identifier?.trim();
    if (!identifier) {
      client.emit('error', { message: 'identifier is required' });
      return;
    }

    const channelId =
      await this.channelService.resolveChannelIdByIdentifier(identifier);
    if (!channelId) {
      client.emit('error', { message: 'Invalid channel identifier' });
      return;
    }

    const room = `song-live:channel:${channelId}`;
    const previousMeta = this.clientMeta.get(client.id);
    if (previousMeta?.room && previousMeta.room !== room) {
      await client.leave(previousMeta.room);
    }
    await client.join(room);

    this.clientMeta.set(client.id, {
      room,
      channelId,
      lastActive: Date.now(),
    });

    let publicSession: any = null;
    try {
      publicSession =
        await this.sessionService.getPublicActiveSession(identifier);
    } catch (error) {
      this.logger.warn(
        `Failed to fetch public session for identifier ${identifier}: ${error.message}`,
      );
    }

    client.emit('joined', {
      channelId,
      room,
      session: publicSession,
    });
  }

  @SubscribeMessage('leave')
  async handleLeave(@ConnectedSocket() client: Socket) {
    const meta = this.clientMeta.get(client.id);
    if (meta?.room) {
      await client.leave(meta.room);
    }

    this.clientMeta.set(client.id, {
      room: '',
      channelId: meta?.channelId ?? null,
      lastActive: Date.now(),
    });

    client.emit('left', {
      message: 'Successfully left song-live room',
    });
  }

  /**
   * 채팅 메시지 이벤트 수신 및 브로드캐스트
   */
  @OnEvent('chat.message')
  handleChatMessage(message: ChatMessage) {
    this.broadcastChatMessage(message);
  }

  /**
   * 채팅 메시지를 채널룸에 브로드캐스트 (Internal API에서 직접 호출 가능)
   */
  broadcastChatMessage(message: ChatMessage) {
    const payload = {
      platform: message.platform,
      userId: message.userId,
      nickname: message.nickname,
      message: message.message,
      type: message.type,
      donationAmount: message.donationAmount,
      donationNativeAmount: message.donationNativeAmount,
      donationCurrency: message.donationCurrency,
      timestamp: message.timestamp,
    };

    if (message.channelId) {
      // channelId가 있으면 해당 채널룸에만 전송 (Internal API 경로)
      this.broadcastToChannel(message.channelId, 'chat.message', payload);
    } else {
      // channelId가 없으면 전체 전��� (기존 ChzzkChatService/SoopChatService 이벤트 경로)
      this.server.emit('chat.message', payload);
    }
  }

  /**
   * 후원 이벤트 수신 및 브로드캐스트
   */
  @OnEvent('donation.received')
  handleDonation(donation: DonationEvent) {
    this.logger.debug(
      `Broadcasting donation from ${donation.donorNickname}: ${donation.amountKRW}원`,
    );
    this.server.emit('donation.received', donation);
  }

  /**
   * 특정 세션에 메시지 전송
   */
  sendToSession(sessionId: number, event: string, data: unknown) {
    const room = `session:${sessionId}`;
    this.server.to(room).emit(event, data);
  }

  // Song request events (public viewers)

  @OnEvent(SONG_REQUEST_EVENTS.CREATED)
  async handleSongRequestCreated(payload: { liveSessionId: number }) {
    const channelId = await this.getChannelIdBySessionId(payload.liveSessionId);
    if (!channelId) return;

    this.broadcastToChannel(channelId, 'request.added', {
      sessionId: payload.liveSessionId,
    });
  }

  @OnEvent(SONG_REQUEST_EVENTS.STATUS_CHANGED)
  async handleSongRequestStatusChanged(payload: {
    request: { liveSessionId: number };
  }) {
    const liveSessionId = payload?.request?.liveSessionId;
    if (!liveSessionId) return;
    const channelId = await this.getChannelIdBySessionId(liveSessionId);
    if (!channelId) return;

    this.broadcastToChannel(channelId, 'request.updated', {
      sessionId: liveSessionId,
    });
  }

  @OnEvent(SONG_REQUEST_EVENTS.DELETED)
  async handleSongRequestDeleted(payload: {
    liveSessionId: number;
    requestId: number;
  }) {
    const channelId = await this.getChannelIdBySessionId(payload.liveSessionId);
    if (!channelId) return;

    this.broadcastToChannel(channelId, 'request.removed', {
      sessionId: payload.liveSessionId,
      requestId: payload.requestId,
    });
  }

  @OnEvent(SONG_REQUEST_EVENTS.QUEUE_UPDATED)
  async handleSongRequestQueueUpdated(payload: { liveSessionId: number }) {
    const channelId = await this.getChannelIdBySessionId(payload.liveSessionId);
    if (!channelId) return;

    this.broadcastToChannel(channelId, 'queue.reordered', {
      sessionId: payload.liveSessionId,
    });
  }

  @OnEvent('overlay.info-display')
  handleInfoDisplay(payload: {
    channelId: number;
    sessionId: number;
    command: string;
    title: string;
    lines: string[];
    nickname?: string;
  }) {
    this.logger.log(
      `broadcast info.display channel=${payload.channelId} command=${payload.command}`,
    );
    this.broadcastToChannel(payload.channelId, 'info.display', {
      sessionId: payload.sessionId,
      command: payload.command,
      title: payload.title,
      lines: payload.lines,
      nickname: payload.nickname,
    });
  }

  @OnEvent(SONG_REQUEST_EVENTS.CHAT_FEEDBACK)
  handleSongRequestChatFeedback(payload: {
    channelId: number;
    sessionId: number;
    outcome: 'accepted' | 'rejected';
    reason?: string;
    nickname: string;
    rawArtist: string;
    rawTitle: string;
    rawMessage: string;
    source: string;
  }) {
    // controller에서 channelId를 이미 resolve한 상태로 emit함 → 여기선 그대로 broadcast.
    this.logger.log(
      `broadcast request.feedback channel=${payload.channelId} outcome=${payload.outcome}`,
    );
    this.broadcastToChannel(payload.channelId, 'request.feedback', {
      sessionId: payload.sessionId,
      outcome: payload.outcome,
      reason: payload.reason,
      nickname: payload.nickname,
      rawArtist: payload.rawArtist,
      rawTitle: payload.rawTitle,
      rawMessage: payload.rawMessage,
      source: payload.source,
    });
  }

  @OnEvent('song-request.settings-updated')
  async handleSongRequestSettingsUpdated(payload: {
    liveSessionId: number;
    settings: any;
  }) {
    const channelId = await this.getChannelIdBySessionId(payload.liveSessionId);
    if (!channelId) return;

    this.broadcastToChannel(channelId, 'settings.updated', {
      sessionId: payload.liveSessionId,
      settings: payload.settings,
    });
  }

  @OnEvent('live-session.started')
  async handleLiveSessionStarted(payload: {
    overlayToken: string;
    sessionId: number;
    settings: any;
  }) {
    const channelId = await this.getChannelIdByOverlayToken(
      payload.overlayToken,
    );
    if (!channelId) return;

    this.broadcastToChannel(channelId, 'session.started', {
      sessionId: payload.sessionId,
      settings: payload.settings,
      isLive: true,
    });
  }

  @OnEvent('live-session.ended')
  async handleLiveSessionEnded(payload: {
    overlayToken: string;
    sessionId: number;
  }) {
    const channelId = await this.getChannelIdByOverlayToken(
      payload.overlayToken,
    );
    if (!channelId) return;

    this.broadcastToChannel(channelId, 'session.ended', {
      sessionId: payload.sessionId,
      isLive: false,
    });
  }

  private broadcastToChannel(channelId: number, event: string, data: unknown) {
    const room = `song-live:channel:${channelId}`;
    this.server.to(room).emit(event, data);
  }

  private async getChannelIdBySessionId(
    liveSessionId: number,
  ): Promise<number | null> {
    const session = await this.prisma.liveSession.findUnique({
      where: { id: liveSessionId },
      select: { channelId: true },
    });

    return session?.channelId ?? null;
  }

  private async getChannelIdByOverlayToken(
    overlayToken: string,
  ): Promise<number | null> {
    if (!overlayToken) return null;
    const channel = await this.prisma.channel.findUnique({
      where: { overlayToken },
      select: { id: true },
    });

    return channel?.id ?? null;
  }
}
