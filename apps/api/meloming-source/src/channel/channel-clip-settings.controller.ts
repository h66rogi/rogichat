import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { ChannelClipSettingsService } from './channel-clip-settings.service';
import {
  ChannelClipSettingsResponseDto,
  ChannelClipSettingsUpdateDto,
} from './dto/channel-clip-settings.dto';
import { ChannelPermission } from './guards/channel-permission.decorator';
import { ChannelPermissionGuard } from './guards/channel-permission.guard';

/**
 * 채널별 클립 자동 게시 설정 endpoint.
 * recording-worker 가 추출한 high/medium confidence 클립을 멜로밍 클립 페이지에
 * 자동 게시할지 채널 owner/매니저가 토글한다.
 */
@ApiTags('Channel/ClipSettings')
@Controller('channel')
export class ChannelClipSettingsController {
  constructor(private readonly service: ChannelClipSettingsService) {}

  @Get(':channelId/clip-settings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '채널 클립 자동 게시 설정 조회 (소유자/매니저)' })
  @ApiParam({ name: 'channelId', type: 'number' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), ChannelPermissionGuard)
  @ChannelPermission('settings')
  @ApiResponse({ status: 200, type: ChannelClipSettingsResponseDto })
  async get(
    @Param('channelId') channelIdParam: string,
  ): Promise<ChannelClipSettingsResponseDto> {
    const channelId = Number(channelIdParam);
    const setting = await this.service.getByChannelId(channelId);
    // 기본 ON — row 없는 채널은 true 응답. 명시적으로 false 인 row 만 false.
    return {
      channelId,
      autoClipEnabled: setting?.autoClipEnabled ?? true,
    };
  }

  @Patch(':channelId/clip-settings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '채널 클립 자동 게시 설정 변경 (소유자/매니저)',
  })
  @ApiParam({ name: 'channelId', type: 'number' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), ChannelPermissionGuard)
  @ChannelPermission('settings')
  @ApiResponse({ status: 200, type: ChannelClipSettingsResponseDto })
  async patch(
    @Param('channelId') channelIdParam: string,
    @Body() body: ChannelClipSettingsUpdateDto,
  ): Promise<ChannelClipSettingsResponseDto> {
    const channelId = Number(channelIdParam);
    const saved = await this.service.upsert(
      channelId,
      body.autoClipEnabled,
    );
    return {
      channelId,
      autoClipEnabled: saved.autoClipEnabled,
    };
  }
}
