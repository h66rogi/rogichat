import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../auth/auth-primitives.js';
import { MelomingLiveSessionService } from './meloming-live-session.service.js';
import { MelomingSongLiveGateway } from './meloming-song-live.gateway.js';
import { consoleCredentials as credentials } from './meloming-console-token.js';
import { MelomingLiveSongRequestService } from './meloming-live-song-request.service.js';

function id(value: string): number {
  if (!/^[1-9]\d{0,9}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ApiError('INVALID_REQUEST', 400);
  return Number(value);
}

@ApiTags('Console API - Sessions')
@Controller('v1/console-api/sessions')
export class MelomingConsoleSessionController {
  constructor(
    @Inject(MelomingLiveSessionService) private readonly sessions: MelomingLiveSessionService,
    @Inject(MelomingLiveSongRequestService) private readonly requests: MelomingLiveSongRequestService,
    @Inject(MelomingSongLiveGateway) private readonly gateway: MelomingSongLiveGateway,
  ) {}

  @Post()
  async startSession(@Req() request: Request) {
    const session = await this.sessions.start(credentials(request), {}, request.body);
    if (session) this.gateway.broadcast('session.started', { sessionId: session.id, isLive: true });
    return session;
  }

  @Get('active')
  getActiveSession(@Req() request: Request) {
    return this.sessions.active(credentials(request), {});
  }

  @Post(':id/end')
  async endSession(@Param('id') sessionId: string, @Req() request: Request) {
    const ended = await this.sessions.end(credentials(request), id(sessionId));
    this.gateway.broadcast('session.ended', { sessionId: ended.id, isLive: false });
    return ended;
  }

  @Patch(':id')
  async updateSettings(@Param('id') sessionId: string, @Req() request: Request) {
    const parsedId = id(sessionId);
    const result = await this.sessions.updateSettings(credentials(request), parsedId, request.body);
    this.gateway.broadcast('settings.updated', { sessionId: parsedId });
    return result;
  }

  @Post(':id/lyrics-playback-state') @HttpCode(204)
  async publishLyricsPlaybackState(@Param('id') sessionId: string, @Req() request: Request) {
    const event = await this.sessions.publishLyricsPlaybackState(credentials(request), id(sessionId), request.body);
    if (event) this.gateway.broadcastLyricsPlaybackState(event.overlayToken, event.state);
  }

  @Post(':id/manual-requests')
  async createManualRequest(@Param('id') sessionId: string, @Req() request: Request) {
    const parsedId = id(sessionId);
    const result = await this.requests.manual(credentials(request), parsedId, request.body);
    this.gateway.broadcast('request.added', { sessionId: parsedId });
    return result;
  }

  @Get('history')
  getSessionHistory(@Req() request: Request) {
    const { page, limit } = request.query;
    return this.sessions.history(credentials(request), {
      ...(page !== undefined ? { page } : {}), ...(limit !== undefined ? { limit } : {}),
    });
  }

  @Get(':id/detail')
  getSessionDetail(@Param('id') sessionId: string, @Req() request: Request) {
    return this.sessions.detail(credentials(request), id(sessionId));
  }

  @Post(':id/clone')
  async cloneSession(@Param('id') sessionId: string, @Req() request: Request) {
    const session = await this.sessions.clone(credentials(request), id(sessionId), {});
    if (session) this.gateway.broadcast('session.started', { sessionId: session.id, isLive: true });
    return session;
  }
}
