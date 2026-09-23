import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelPermission } from './guards/channel-permission.decorator';
import { ChannelPermissionGuard } from './guards/channel-permission.guard';
import { ChannelService } from './channel.service';
import { ChannelMusicbookSettingsService } from './channel-musicbook-settings.service';
import {
  ChannelMusicbookSettingsResponseDto,
  CopyDifficultyToProficiencyResponseDto,
  UpdateChannelMusicbookSettingsDto,
} from './dto/channel-musicbook-settings.dto';

@ApiTags('Channel/MusicbookSettings')
@Controller('channel')
export class ChannelMusicbookSettingsController {
  constructor(
    private readonly channelService: ChannelService,
    private readonly musicbookSettingsService: ChannelMusicbookSettingsService,
  ) {}

  @ApiOperation({ summary: '채널 노래책 설정 조회' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
  })
  @ApiResponse({
    status: 200,
    description: '채널 노래책 설정 조회 성공',
    type: ChannelMusicbookSettingsResponseDto,
  })
  @Get(':identifier/musicbook-settings')
  @HttpCode(HttpStatus.OK)
  async getMusicbookSettings(
    @Param('identifier') identifier: string,
  ): Promise<ChannelMusicbookSettingsResponseDto> {
    const channel = await this.channelService.findByIdentifier(identifier);
    return this.musicbookSettingsService.getSettings(channel.id);
  }

  @ApiOperation({ summary: '채널 노래책 설정 업데이트' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
  })
  @ApiResponse({
    status: 200,
    description: '채널 노래책 설정 업데이트 성공',
    type: ChannelMusicbookSettingsResponseDto,
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('settings')
  @Put(':identifier/musicbook-settings')
  @HttpCode(HttpStatus.OK)
  async updateMusicbookSettings(
    @Param('identifier') identifier: string,
    @Body() body: UpdateChannelMusicbookSettingsDto,
  ): Promise<ChannelMusicbookSettingsResponseDto> {
    const channel = await this.channelService.findByIdentifier(identifier);
    return this.musicbookSettingsService.updateSettings(channel.id, body);
  }

  @ApiOperation({ summary: '난이도를 숙련도로 일괄 복사' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
  })
  @ApiResponse({
    status: 200,
    description: '난이도에서 숙련도로 일괄 복사 성공',
    type: CopyDifficultyToProficiencyResponseDto,
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('settings')
  @Post(':identifier/musicbook-settings/copy-difficulty-to-proficiency')
  @HttpCode(HttpStatus.OK)
  async copyDifficultyToProficiency(
    @Param('identifier') identifier: string,
  ): Promise<CopyDifficultyToProficiencyResponseDto> {
    const channel = await this.channelService.findByIdentifier(identifier);
    return this.musicbookSettingsService.copyDifficultyToProficiency(
      channel.id,
    );
  }
}
