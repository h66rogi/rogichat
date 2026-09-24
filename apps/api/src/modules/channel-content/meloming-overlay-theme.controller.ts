import { Controller, Get, Inject, Param, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { consoleOrCommand, consoleOrSession } from './meloming-console-token.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { MelomingOverlayThemeService } from './meloming-overlay-theme.service.js';
import { MelomingSongLiveGateway } from './meloming-song-live.gateway.js';

@ApiTags('Channel overlay theme/Meloming compatibility')
@Controller('v1/channel/:identifier/overlay-theme')
export class MelomingOverlayThemeController {
  constructor(
    @Inject(MelomingOverlayThemeService) private readonly themes: MelomingOverlayThemeService,
    @Inject(MelomingSongLiveGateway) private readonly gateway: MelomingSongLiveGateway,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Get() @channelDoc('melomingOverlayTheme', '원본 오버레이 테마 조회', 'read')
  get(@Param('identifier') identifier: string, @Req() request: Request) {
    if (identifier !== 'hurogi') throw new ApiError('NOT_FOUND', 404);
    return this.themes.get(consoleOrSession(request, this.config));
  }

  @Put() @channelDoc('melomingOverlayThemeUpdate', '원본 오버레이 테마 저장', 'write')
  async update(@Param('identifier') identifier: string, @Req() request: Request) {
    if (identifier !== 'hurogi') throw new ApiError('NOT_FOUND', 404);
    const result = await this.themes.update(consoleOrCommand(request, this.config), request.body);
    this.gateway.broadcast('settings.updated', {});
    return result;
  }
}
