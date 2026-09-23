import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from './session.service';

/**
 * meloming-live-service 가 IVS Stream Start / Stream End (LL_HLS) 또는
 * audio session 시작/종료 hook 에서 호출하는 internal endpoint.
 *
 * 본 endpoint 가 meloming-back live_sessions 테이블에 platform=MELOMING row 를
 * INSERT/UPDATE 함으로써 chat-dispatcher-v2 watcher 가 그 row 를 polling 으로
 * 인식하고 chat:meloming:{channelId} Redis stream 의 신청곡 명령을 dispatch.
 *
 * - 인증: X-Internal-Api-Key (service-to-service)
 * - idempotent: start 가 활성 meloming session 있으면 noop, end 가 없는 session
 *   이면 noop. live-service 의 lifecycle hook 이 multiple SQS event delivery 에
 *   안전하게 호출 가능.
 */
@ApiTags('Song Live (Internal)')
@Controller({ path: 'internal/channels', version: '1' })
@UseGuards(InternalApiKeyGuard)
export class InternalMelomingLiveController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
  ) {}

  @Post(':channelId/meloming-live/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'meloming-native 라이브 시작 — live_sessions row INSERT + dispatcher webhook',
  })
  @ApiHeader({ name: 'X-Internal-Api-Key', required: true })
  async start(
    @Param('channelId', ParseIntPipe) channelId: number,
  ): Promise<{ sessionId: number; platform: string }> {
    if (!channelId || channelId <= 0) {
      throw new BadRequestException('invalid channelId');
    }
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, userId: true },
    });
    if (!channel) {
      throw new NotFoundException('channel not found');
    }
    const session = await this.sessionService.startMelomingLiveSession(
      channel.id,
      channel.userId,
    );
    return {
      sessionId: session.id,
      platform: session.platform ?? 'MELOMING',
    };
  }

  @Post(':channelId/meloming-live/end')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'meloming-native 라이브 종료 — live_sessions status=ENDED',
  })
  @ApiHeader({ name: 'X-Internal-Api-Key', required: true })
  async end(
    @Param('channelId', ParseIntPipe) channelId: number,
  ): Promise<void> {
    if (!channelId || channelId <= 0) {
      throw new BadRequestException('invalid channelId');
    }
    await this.sessionService.endMelomingLiveSession(channelId);
  }
}
