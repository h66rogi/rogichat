import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LiveSessionStatus, LiveSessionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { mergeEffectiveSongRequestSettings } from '../song-live/effective-song-request-settings';

/**
 * 채널 신청곡 설정 변경 시 후속 반영을 일괄 처리.
 *
 *  1. chat-dispatcher-v2 webhook (POST /internal/session-events with
 *     `channel.settings-updated`) — dispatcher 내부 SessionCache 의 채널 매칭
 *     entry 무효화. 다음 채팅 이벤트에 새 settings 로 repopulate.
 *  2. 라이브 active 인 채널이면 overlay socket broadcast 이벤트 emit
 *     ('song-request.settings-updated') — overlay-stream.events.service 가
 *     widget 들에 effective settings publish.
 *
 * 호출자 (session.service.updateSettings / channel-song-request-settings.controller)
 * 가 settings DB write 직후 호출. 실패는 best-effort 로 warn log 만.
 */
@Injectable()
export class ChannelSongRequestSettingsNotifierService {
  private readonly logger = new Logger(
    ChannelSongRequestSettingsNotifierService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async notify(channelId: number): Promise<void> {
    this.notifyDispatcher(channelId).catch((err) => {
      this.logger.warn(
        `Dispatcher webhook failed (channel ${channelId} settings): ${err?.message}`,
      );
    });

    const active = await this.prisma.liveSession.findFirst({
      where: {
        channelId,
        status: LiveSessionStatus.ACTIVE,
        sessionType: LiveSessionType.STANDARD,
      },
      include: { settings: true },
    });
    if (!active) return;

    const channelSettings =
      await this.prisma.channelSongRequestSettings.findUnique({
        where: { channelId },
      });
    if (!channelSettings) return;

    const effective = mergeEffectiveSongRequestSettings(
      active.settings,
      channelSettings,
    );
    this.eventEmitter.emit('song-request.settings-updated', {
      liveSessionId: active.id,
      settings: effective,
    });
  }

  private async notifyDispatcher(channelId: number): Promise<void> {
    const webhookUrl = this.configService.get<string>(
      'CHAT_DISPATCHER_WEBHOOK_URL',
    );
    if (!webhookUrl) return;

    const apiKey = this.configService.get<string>('INTERNAL_API_KEY');
    const response = await fetch(`${webhookUrl}/internal/session-events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': apiKey ?? '',
      },
      body: JSON.stringify({
        event: 'channel.settings-updated',
        channelId,
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      throw new Error(`Dispatcher webhook returned ${response.status}`);
    }
  }
}
