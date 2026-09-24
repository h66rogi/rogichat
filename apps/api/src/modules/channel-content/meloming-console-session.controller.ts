import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../auth/auth-primitives.js';
import { MelomingLiveSessionService } from './meloming-live-session.service.js';
import { MelomingSongLiveGateway } from './meloming-song-live.gateway.js';
import { consoleCredentials as credentials } from './meloming-console-token.js';
import { MelomingLiveSongRequestService } from './meloming-live-song-request.service.js';
import { channelDoc } from './channel-content.openapi.js';

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

  @Post() @channelDoc('melomingConsoleSessionStart', '원본 콘솔 라이브 시작', 'none', 201)
  async startSession(@Req() request: Request) {
    const session = await this.sessions.start(credentials(request), {}, request.body);
    if (session) this.gateway.broadcast('session.started', { sessionId: session.id, isLive: true });
    return session;
  }

  @Get('active') @channelDoc('melomingConsoleSessionActive', '원본 콘솔 활성 라이브 조회')
  getActiveSession(@Req() request: Request) {
    return this.sessions.active(credentials(request), {});
  }

  @Post(':id/end') @channelDoc('melomingConsoleSessionEnd', '원본 콘솔 라이브 종료', 'none', 201, true)
  async endSession(@Param('id') sessionId: string, @Req() request: Request) {
    const ended = await this.sessions.end(credentials(request), id(sessionId));
    this.gateway.broadcast('session.ended', { sessionId: ended.id, isLive: false });
    return ended;
  }

  @Patch(':id') @channelDoc('melomingConsoleSessionSettings', '원본 콘솔 라이브 설정 변경', 'none', 200, true)
  async updateSettings(@Param('id') sessionId: string, @Req() request: Request) {
    const parsedId = id(sessionId);
    const result = await this.sessions.updateSettings(credentials(request), parsedId, request.body);
    this.gateway.broadcast('settings.updated', { sessionId: parsedId });
    return result;
  }

  @Post(':id/lyrics-playback-state') @HttpCode(204) @channelDoc('melomingConsoleLyricsPlaybackState', '원본 가사 재생 상태 전송', 'none', 204, true)
  async publishLyricsPlaybackState(@Param('id') sessionId: string, @Req() request: Request) {
    const event = await this.sessions.publishLyricsPlaybackState(credentials(request), id(sessionId), request.body);
    if (event) this.gateway.broadcastLyricsPlaybackState(event.overlayToken, event.state);
  }

  @Post(':id/manual-requests') @channelDoc('melomingConsoleManualRequest', '원본 콘솔 수동 신청곡 등록', 'none', 201, true)
  async createManualRequest(@Param('id') sessionId: string, @Req() request: Request) {
    const parsedId = id(sessionId);
    const result = await this.requests.manual(credentials(request), parsedId, request.body);
    this.gateway.broadcast('request.added', { sessionId: parsedId });
    return result;
  }

  @Get('history') @channelDoc('melomingConsoleSessionHistory', '원본 라이브 방송 기록 조회')
  getSessionHistory(@Req() request: Request) {
    const { page, limit } = request.query;
    return this.sessions.history(credentials(request), {
      ...(page !== undefined ? { page } : {}), ...(limit !== undefined ? { limit } : {}),
    });
  }

  @Get(':id/detail') @channelDoc('melomingConsoleSessionDetail', '원본 라이브 방송 상세', 'none', 200, true)
  getSessionDetail(@Param('id') sessionId: string, @Req() request: Request) {
    return this.sessions.detail(credentials(request), id(sessionId));
  }

  @Post(':id/clone') @channelDoc('melomingConsoleSessionClone', '원본 라이브 방송 복제', 'none', 201, true)
  async cloneSession(@Param('id') sessionId: string, @Req() request: Request) {
    const session = await this.sessions.clone(credentials(request), id(sessionId), {});
    if (session) this.gateway.broadcast('session.started', { sessionId: session.id, isLive: true });
    return session;
  }
}
