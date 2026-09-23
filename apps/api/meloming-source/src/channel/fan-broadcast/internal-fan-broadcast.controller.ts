import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InternalApiKeyGuard } from '../../common/guards/internal-api-key.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { FanBroadcastService } from './fan-broadcast.service';

interface TriggerLiveBody {
  title?: string;
}

/**
 * meloming-live-service 가 라이브 시작 이벤트 처리 직후 호출하는 internal endpoint.
 * 채널 owner 를 조회해 그 owner 권한으로 fanBroadcast.sendBroadcast 를 실행한다.
 *
 * - 인증: X-Internal-Api-Key (service-to-service)
 * - rate limit: fanBroadcast 의 일일 quota 가 그대로 enforce — 자동 트리거도 같은 카운터를
 *   차감. (트위치는 자동 알림 별도 카운터인데, meloming 의 현재 quota 모델 통일 정책상 같이.)
 */
@ApiTags('Fan Broadcast (Internal)')
@Controller({ path: 'internal/channels', version: '1' })
@UseGuards(InternalApiKeyGuard)
export class InternalFanBroadcastController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fanBroadcast: FanBroadcastService,
  ) {}

  @Post(':channelId/fan-broadcast/trigger-live')
  @ApiOperation({
    summary: '라이브 시작 시 팬 알림 자동 발송 (live-service → meloming-back)',
  })
  @ApiHeader({ name: 'X-Internal-Api-Key', required: true })
  async triggerLive(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Body() body: TriggerLiveBody,
  ): Promise<{
    success: boolean;
    enqueuedCount: number;
    dailyQuota: number;
    usedQuotaToday: number;
    resetAt: string;
  }> {
    if (!channelId || channelId <= 0) {
      throw new BadRequestException('invalid channelId');
    }
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, userId: true, name: true, webPath: true },
    });
    if (!channel) {
      throw new NotFoundException('channel not found');
    }
    const titleText = body?.title?.trim() || `${channel.name}님이 라이브를 시작했어요`;
    const result = await this.fanBroadcast.sendBroadcast({
      channelId: channel.id,
      ownerUserId: channel.userId,
      title: `${channel.name} · 라이브 시작`,
      body: titleText,
    });
    return {
      success: result.success,
      enqueuedCount: result.enqueuedCount,
      dailyQuota: result.dailyQuota,
      usedQuotaToday: result.usedQuotaToday,
      resetAt: result.resetAt,
    };
  }
}
