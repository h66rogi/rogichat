import { Controller, Get, Header, Inject, Param, ParseIntPipe, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { consoleOrSession } from './meloming-console-token.js';
import { MelomingConsoleLyricsService } from './meloming-console-lyrics.service.js';
import { channelDoc } from './channel-content.openapi.js';

/** Original console lyrics endpoint, mapped to Rogichat's versioned API and auth. */
@ApiTags('Console API - Lyrics')
@Controller('v1/console-api/songs/channel/:identifier')
export class MelomingConsoleLyricsController {
  constructor(
    @Inject(MelomingConsoleLyricsService) private readonly service: MelomingConsoleLyricsService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Get(':songId/lyrics')
  @channelDoc('melomingConsoleLyrics', '원본 콘솔 노래 가사 조회')
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  @Header('Surrogate-Control', 'no-store')
  async getLyrics(
    @Param('identifier') identifier: string,
    @Param('songId', ParseIntPipe) songId: number,
    @Query('liveSessionId', new ParseIntPipe({ optional: true })) liveSessionId: number | undefined,
    @Query('songRequestId', new ParseIntPipe({ optional: true })) songRequestId: number | undefined,
    @Query('include') include: string | undefined,
    @Req() request: Request,
  ) {
    const { payload } = await this.service.getLyrics(consoleOrSession(request, this.config), {
      identifier, songId, includeRichsync: include === 'richsync' || include === 'true',
      ...(liveSessionId !== undefined ? { liveSessionId } : {}),
      ...(songRequestId !== undefined ? { songRequestId } : {}),
    });
    return payload;
  }
}
