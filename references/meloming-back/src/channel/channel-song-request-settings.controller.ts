import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ChannelSongRequestSettingsService } from './channel-song-request-settings.service';
import { ChannelSongRequestSettingsNotifierService } from './channel-song-request-settings-notifier.service';
import {
  ChannelSongRequestSettingsResponseDto,
  UpdateChannelSongRequestSettingsDto,
} from './dto/channel-song-request-settings.dto';
import { ChannelPermission } from './guards/channel-permission.decorator';
import { ChannelPermissionGuard } from './guards/channel-permission.guard';

/**
 * 채널 단위 신청곡 설정 endpoint.
 *
 * LiveSessionSettings(라이브 1:1) 가 라이브 비활성 상태에서 설정 변경 불가능했던 근본 결함을
 * 해소. 라이브 상태와 무관하게 채널 owner/매니저(canManageSettings) 가 토글을 변경 가능.
 */
@ApiTags('Channel/SongRequestSettings')
@Controller('channel')
export class ChannelSongRequestSettingsController {
  constructor(
    private readonly service: ChannelSongRequestSettingsService,
    private readonly notifier: ChannelSongRequestSettingsNotifierService,
  ) {}

  @Get(':channelId/song-request-settings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '채널 신청곡 설정 조회 (소유자/매니저)' })
  @ApiParam({ name: 'channelId', type: 'number' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), ChannelPermissionGuard)
  @ChannelPermission('settings')
  @ApiResponse({ status: 200, type: ChannelSongRequestSettingsResponseDto })
  async get(
    @Param('channelId', ParseIntPipe) channelId: number,
  ): Promise<ChannelSongRequestSettingsResponseDto> {
    const settings = await this.service.getByChannelId(channelId);
    return this.service.toResponseDto(settings);
  }

  @Patch(':channelId/song-request-settings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '채널 신청곡 설정 변경 (소유자/매니저)' })
  @ApiParam({ name: 'channelId', type: 'number' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), ChannelPermissionGuard)
  @ChannelPermission('settings')
  @ApiResponse({ status: 200, type: ChannelSongRequestSettingsResponseDto })
  async patch(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Body() body: UpdateChannelSongRequestSettingsDto,
  ): Promise<ChannelSongRequestSettingsResponseDto> {
    const saved = await this.service.update(channelId, body);
    await this.notifier.notify(channelId);
    return this.service.toResponseDto(saved);
  }
}
