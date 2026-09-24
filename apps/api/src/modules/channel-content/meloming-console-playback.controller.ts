import { Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { ApiError } from '../auth/auth-primitives.js';
import { consoleOrCommand } from './meloming-console-token.js';
import { MelomingConsolePlaybackService } from './meloming-console-playback.service.js';
import { channelDoc } from './channel-content.openapi.js';

@ApiTags('Console API - Playback')
@Controller('v1/console-api/sessions')
export class MelomingConsolePlaybackController {
  constructor(
    @Inject(MelomingConsolePlaybackService) private readonly service: MelomingConsolePlaybackService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Post(':sessionId/playback-url')
  @HttpCode(200)
  @channelDoc('melomingConsolePlaybackUrl', '원본 콘솔 서명 재생 URL 발급')
  create(@Param('sessionId') rawId: string, @Req() request: Request) {
    if (!/^[1-9]\d{0,9}$/.test(rawId) || !Number.isSafeInteger(Number(rawId))) throw new ApiError('INVALID_REQUEST', 400);
    return this.service.create(consoleOrCommand(request, this.config), Number(rawId), request.body);
  }
}
