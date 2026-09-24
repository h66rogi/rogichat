import { isChannelIdentifier } from './channel-identity.js';
import { Controller, Get, Inject, Param, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { consoleOrCommand, consoleOrSession } from './meloming-console-token.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { MelomingOverlayLayoutService } from './meloming-overlay-layout.service.js';
import { MelomingSongLiveGateway } from './meloming-song-live.gateway.js';

@ApiTags('Channel overlay layouts/Meloming compatibility')
@Controller('v1/channel/:identifier/overlay-layouts')
export class MelomingOverlayLayoutController {
  constructor(
    @Inject(MelomingOverlayLayoutService) private readonly layouts: MelomingOverlayLayoutService,
    @Inject(MelomingSongLiveGateway) private readonly gateway: MelomingSongLiveGateway,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Get(':layoutType') @channelDoc('melomingOverlayLayout', '원본 오버레이 레이아웃 조회', 'read')
  get(@Param('identifier') identifier: string, @Param('layoutType') layoutType: string, @Req() request: Request) {
    if (!isChannelIdentifier(identifier)) throw new ApiError('NOT_FOUND', 404);
    return this.layouts.get(consoleOrSession(request, this.config), layoutType);
  }

  @Put(':layoutType') @channelDoc('melomingOverlayLayoutUpdate', '원본 오버레이 레이아웃 저장', 'write')
  async update(@Param('identifier') identifier: string, @Param('layoutType') layoutType: string, @Req() request: Request) {
    if (!isChannelIdentifier(identifier)) throw new ApiError('NOT_FOUND', 404);
    const result = await this.layouts.update(consoleOrCommand(request, this.config), layoutType, request.body);
    this.gateway.broadcast('settings.updated', {});
    return result;
  }
}
