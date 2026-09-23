import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ChannelOwnershipGuard } from '../guards/channel-ownership.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import type { AuthUserDto } from '../../common/dto/auth-user.dto';
import { FanBroadcastService } from './fan-broadcast.service';
import { SendFanBroadcastRequestDto } from './dto/send-fan-broadcast-request.dto';
import { SendFanBroadcastResponseDto } from './dto/send-fan-broadcast-response.dto';
import { FanBroadcastQuotaDto } from './dto/fan-broadcast-quota.dto';
import { FanBroadcastHistoryResponseDto } from './dto/fan-broadcast-history.dto';

@ApiTags('Channel / Fan Broadcast')
@ApiBearerAuth()
@Controller('channels/:channelId/fan-broadcast')
export class FanBroadcastController {
  constructor(private readonly fanBroadcast: FanBroadcastService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'), ChannelOwnershipGuard)
  @ApiOperation({
    summary: '스트리머 팬 알림 발송',
    description:
      '내 채널을 즐겨찾기한 유저들(본인 제외)에게 푸시+인앱 알림을 발송합니다. ' +
      '일반 1회/일, PRO 5회/일까지 발송 가능 (KST 자정 리셋).',
  })
  @ApiParam({ name: 'channelId', type: 'number', example: 5 })
  @ApiOkResponse({ type: SendFanBroadcastResponseDto })
  async send(
    @Param('channelId', ParseIntPipe) channelId: number,
    @AuthUser() user: AuthUserDto,
    @Body() dto: SendFanBroadcastRequestDto,
  ): Promise<SendFanBroadcastResponseDto> {
    return this.fanBroadcast.sendBroadcast({
      channelId,
      ownerUserId: user.id,
      title: dto.title,
      body: dto.body,
      url: dto.url,
    });
  }

  @Get('quota')
  @UseGuards(AuthGuard('jwt'), ChannelOwnershipGuard)
  @ApiOperation({
    summary: '팬 알림 남은 쿼터 조회',
    description: '오늘(KST) 사용한 횟수 / 일일 한도 / PRO 여부 / 리셋 시각',
  })
  @ApiParam({ name: 'channelId', type: 'number', example: 5 })
  @ApiOkResponse({ type: FanBroadcastQuotaDto })
  async getQuota(
    @Param('channelId', ParseIntPipe) _channelId: number,
    @AuthUser() user: AuthUserDto,
  ): Promise<FanBroadcastQuotaDto> {
    return this.fanBroadcast.getQuota(user.id);
  }

  @Get('history')
  @UseGuards(AuthGuard('jwt'), ChannelOwnershipGuard)
  @ApiOperation({
    summary: '팬 알림 발송 이력 + 읽음 통계',
    description:
      'broadcastId 별로 그룹화한 최근 발송 목록. 각 항목은 발송 시각, 인앱 ' +
      'recipient 수, readAt non-null 수신자 수(읽음)을 포함한다. 최대 50건.',
  })
  @ApiParam({ name: 'channelId', type: 'number', example: 5 })
  @ApiOkResponse({ type: FanBroadcastHistoryResponseDto })
  async getHistory(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<FanBroadcastHistoryResponseDto> {
    return this.fanBroadcast.getHistory(channelId, limit);
  }
}
