import { isChannelIdentifier } from './channel-identity.js';
import { ApiTags } from '@nestjs/swagger';
import { Controller, Delete, Get, Inject, Param, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { MelomingChannelService } from './meloming-channel.service.js';
import { MelomingMusicbookSettingsService } from './meloming-musicbook-settings.service.js';
import { MelomingSongLiveGateway } from './meloming-song-live.gateway.js';

function channel(identifier: string): void {
  if (!isChannelIdentifier(identifier)) throw new ApiError('NOT_FOUND', 404);
}

@ApiTags('Channel/Meloming compatibility')
@Controller('v1/channel/:identifier')
export class MelomingChannelController {
  constructor(
    @Inject(MelomingChannelService) private readonly service: MelomingChannelService,
    @Inject(MelomingMusicbookSettingsService) private readonly musicbookSettings: MelomingMusicbookSettingsService,
    @Inject(MelomingSongLiveGateway) private readonly gateway: MelomingSongLiveGateway,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Get() @channelDoc('melomingChannelDetail', '원본 채널 레이아웃 정보')
  detail(@Param('identifier') identifier: string) {
    channel(identifier);
    return this.service.detail();
  }

  @Put() @channelDoc('melomingChannelUpdate', '원본 채널 설정 저장', 'write')
  update(@Param('identifier') identifier: string, @Req() request: Request) {
    channel(identifier);
    return this.service.update(readCommandCredentials(request, this.config), request.body);
  }

  @Get('permission') @channelDoc('melomingChannelPermission', '원본 채널 권한', 'read')
  permission(@Param('identifier') identifier: string, @Req() request: Request) {
    channel(identifier);
    return this.service.permission(readSessionCredentials(request, this.config));
  }

  @Get('feature-settings') @channelDoc('melomingChannelFeatureSettings', '원본 채널 메뉴 설정')
  features(@Param('identifier') identifier: string) {
    channel(identifier);
    return this.service.features();
  }

  @Get('overlay-token') @channelDoc('melomingOverlayToken', '원본 오버레이 토큰 조회', 'read')
  overlayToken(@Param('identifier') identifier: string, @Req() request: Request) {
    channel(identifier);
    return this.service.overlayToken(readSessionCredentials(request, this.config));
  }

  @Patch('overlay-token/regenerate') @channelDoc('melomingOverlayTokenRegenerate', '원본 오버레이 토큰 재생성', 'write')
  regenerateOverlayToken(@Param('identifier') identifier: string, @Req() request: Request) {
    channel(identifier);
    return this.service.regenerateOverlayToken(readCommandCredentials(request, this.config));
  }

  @Post('overlay/refresh') @channelDoc('melomingOverlayRefresh', '오버레이 새로고침', 'write')
  async refreshOverlay(@Param('identifier') identifier: string, @Req() request: Request) {
    channel(identifier);
    await this.service.overlayToken(readCommandCredentials(request, this.config));
    this.gateway.broadcast('settings.updated', {});
    return {};
  }

  @Get('console-token') @channelDoc('melomingConsoleToken', '원본 콘솔 토큰 조회', 'read')
  consoleToken(@Param('identifier') identifier: string, @Req() request: Request) {
    channel(identifier);
    return this.service.consoleToken(readSessionCredentials(request, this.config));
  }

  @Patch('console-token/regenerate') @channelDoc('melomingConsoleTokenRegenerate', '원본 콘솔 토큰 재생성', 'write')
  regenerateConsoleToken(@Param('identifier') identifier: string, @Req() request: Request) {
    channel(identifier);
    return this.service.regenerateConsoleToken(readCommandCredentials(request, this.config));
  }

  @Delete('console-token') @channelDoc('melomingConsoleTokenDelete', '원본 콘솔 토큰 삭제', 'write')
  deleteConsoleToken(@Param('identifier') identifier: string, @Req() request: Request) {
    channel(identifier);
    return this.service.deleteConsoleToken(readCommandCredentials(request, this.config));
  }

  @Put('feature-settings') @channelDoc('melomingChannelFeatureSettingsUpdate', '채널 메뉴 설정 저장', 'write')
  updateFeatures(@Param('identifier') identifier: string, @Req() request: Request) {
    channel(identifier);
    return this.service.updateFeatureSettings(readCommandCredentials(request, this.config), request.body);
  }

  @Patch('schedule-notice') @channelDoc('melomingChannelScheduleNotice', '원본 일정 공지 수정', 'write')
  scheduleNotice(@Param('identifier') identifier: string, @Req() request: Request) {
    channel(identifier);
    return this.service.updateScheduleNotice(readCommandCredentials(request, this.config), request.body);
  }

  @Get('musicbook-settings') @channelDoc('melomingMusicbookSettings', '원본 노래책 설정 조회')
  getMusicbookSettings(@Param('identifier') identifier: string) {
    channel(identifier);
    return this.musicbookSettings.getSettings();
  }

  @Put('musicbook-settings') @channelDoc('melomingMusicbookSettingsUpdate', '원본 노래책 설정 수정', 'write')
  updateMusicbookSettings(@Param('identifier') identifier: string, @Req() request: Request) {
    channel(identifier);
    return this.musicbookSettings.updateSettings(readCommandCredentials(request, this.config), request.body);
  }

  @Post('musicbook-settings/copy-difficulty-to-proficiency')
  @channelDoc('melomingMusicbookCopyDifficulty', '원본 노래책 난이도 복사', 'write')
  copyDifficulty(@Param('identifier') identifier: string, @Req() request: Request) {
    channel(identifier);
    return this.musicbookSettings.copyDifficultyToProficiency(readCommandCredentials(request, this.config));
  }
}
