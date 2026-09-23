import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChannelPermission } from '../channel/guards/channel-permission.decorator';
import { ChannelPermissionGuard } from '../channel/guards/channel-permission.guard';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import { ConsoleTokenGuard } from '../console-api/guards/console-token.guard';
import { GetConsoleAuth } from '../console-api/decorators/console-auth.decorator';
import type { ConsoleAuth } from '../console-api/guards/console-token.guard';
import {
  FromChatOmakaseRequestDto,
  OmakaseAdjustDto,
  OmakaseConsumeDto,
  OmakaseSetCountDto,
  UpdateOmakaseSettingsDto,
} from './dto/omakase.dto';
import { OmakaseService } from './omakase.service';

@ApiTags('Omakase')
@Controller()
export class OmakaseController {
  constructor(private readonly omakaseService: OmakaseService) {}

  @Get('channel/:channelId/omakase-settings')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), ChannelPermissionGuard)
  @ChannelPermission('settings')
  async getSettings(@Param('channelId', ParseIntPipe) channelId: number) {
    return this.omakaseService.getStatus(channelId);
  }

  @Patch('channel/:channelId/omakase-settings')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), ChannelPermissionGuard)
  @ChannelPermission('settings')
  async updateSettings(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Body() dto: UpdateOmakaseSettingsDto,
  ) {
    return this.omakaseService.updateSettings(channelId, dto);
  }

  @Get('console-api/omakase/status')
  @UseGuards(ConsoleTokenGuard)
  async getConsoleStatus(@GetConsoleAuth() auth: ConsoleAuth) {
    return this.omakaseService.getStatus(auth.channelId);
  }

  @Get('console-api/omakase/history')
  @UseGuards(ConsoleTokenGuard)
  async getConsoleHistory(
    @GetConsoleAuth() auth: ConsoleAuth,
    @Query('limit') limit?: string,
  ) {
    return this.omakaseService.listHistory(
      auth.channelId,
      limit ? Number(limit) : 50,
    );
  }

  @Post('console-api/omakase/adjust')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ConsoleTokenGuard)
  async adjust(
    @GetConsoleAuth() auth: ConsoleAuth,
    @Body() dto: OmakaseAdjustDto,
  ) {
    return this.omakaseService.manualAdjust({
      channelId: auth.channelId,
      liveSessionId: dto.liveSessionId,
      delta: dto.delta,
      actorUserId: auth.userId,
      reason: dto.reason,
    });
  }

  @Post('console-api/omakase/set-count')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ConsoleTokenGuard)
  async setCount(
    @GetConsoleAuth() auth: ConsoleAuth,
    @Body() dto: OmakaseSetCountDto,
  ) {
    return this.omakaseService.setCount({
      channelId: auth.channelId,
      liveSessionId: dto.liveSessionId,
      count: dto.count,
      actorUserId: auth.userId,
      reason: dto.reason,
    });
  }

  @Post('console-api/omakase/consume')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ConsoleTokenGuard)
  async consume(
    @GetConsoleAuth() auth: ConsoleAuth,
    @Body() dto: OmakaseConsumeDto,
  ) {
    return this.omakaseService.consumeWithSongRequest({
      channelId: auth.channelId,
      actorUserId: auth.userId,
      request: dto.request,
      playNow: dto.playNow,
    });
  }

  @Post('internal/chat-dispatcher/omakase-requests')
  @ApiOperation({ summary: '채팅 오마카세 신청 생성 (chat-dispatcher 전용)' })
  @UseGuards(InternalApiKeyGuard)
  async fromChat(@Body() dto: FromChatOmakaseRequestDto) {
    return this.omakaseService.createFromChat(dto);
  }
}
