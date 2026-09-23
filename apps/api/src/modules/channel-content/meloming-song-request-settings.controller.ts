import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Inject, Param, Patch, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { MelomingSongRequestSettingsService } from './meloming-song-request-settings.service.js';
import { MelomingSongLiveGateway } from './meloming-song-live.gateway.js';

@ApiTags('Channel song request settings/Meloming compatibility')
@Controller('v1/channel/:channelId/song-request-settings')
export class MelomingSongRequestSettingsController {
  constructor(@Inject(MelomingSongRequestSettingsService) private readonly settings: MelomingSongRequestSettingsService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(MelomingSongLiveGateway) private readonly gateway: MelomingSongLiveGateway) {}

  @Get() @channelDoc('melomingSongRequestSettingsGet', '원본 채널 신청곡 설정', 'read')
  get(@Param('channelId') channelId: string, @Req() request: Request) {
    if (channelId !== '1') throw new ApiError('NOT_FOUND', 404);
    return this.settings.get(readSessionCredentials(request, this.config));
  }

  @Patch() @channelDoc('melomingSongRequestSettingsUpdate', '원본 채널 신청곡 설정 변경', 'write')
  async update(@Param('channelId') channelId: string, @Req() request: Request) {
    if (channelId !== '1') throw new ApiError('NOT_FOUND', 404);
    const settings=await this.settings.update(readCommandCredentials(request, this.config), request.body);
    this.gateway.broadcast('settings.updated',{});
    return settings;
  }
}
