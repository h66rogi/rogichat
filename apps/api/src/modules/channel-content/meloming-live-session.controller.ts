import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { MelomingLiveSessionService } from './meloming-live-session.service.js';

function id(value: string): number {
  if (!/^[1-9]\d{0,9}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ApiError('INVALID_REQUEST', 400);
  return Number(value);
}

@ApiTags('Song live sessions/Meloming compatibility')
@Controller('v1/song-live')
export class MelomingLiveSessionController {
  constructor(@Inject(MelomingLiveSessionService) private readonly sessions: MelomingLiveSessionService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  @Post('sessions') @channelDoc('melomingLiveSessionStart', '원본 라이브 세션 시작', 'write', 201)
  start(@Req() request: Request) { return this.sessions.start(readCommandCredentials(request,this.config),request.query as Record<string,unknown>,request.body); }

  @Get('sessions/active') @channelDoc('melomingLiveSessionActive', '원본 활성 세션', 'read')
  active(@Req() request: Request) { return this.sessions.active(readSessionCredentials(request,this.config),request.query as Record<string,unknown>); }

  @Get('public/active') @channelDoc('melomingPublicLiveSession', '원본 공개 활성 세션')
  publicActive(@Req() request: Request) { return this.sessions.publicActive(readSessionCredentials(request,this.config),request.query as Record<string,unknown>); }

  @Post('sessions/:id/end') @channelDoc('melomingLiveSessionEnd', '원본 라이브 세션 종료', 'write', 201)
  end(@Param('id') sessionId: string, @Req() request: Request) {
    return this.sessions.end(readCommandCredentials(request,this.config),id(sessionId));
  }

  @Get('sessions/history') @channelDoc('melomingLiveSessionHistory', '원본 방송 기록', 'read')
  history(@Req() request: Request) { return this.sessions.history(readSessionCredentials(request,this.config),request.query as Record<string,unknown>); }

  @Get('sessions/:id/detail') @channelDoc('melomingLiveSessionDetail', '원본 방송 기록 상세', 'read')
  detail(@Param('id') sessionId: string, @Req() request: Request) {
    return this.sessions.detail(readSessionCredentials(request,this.config),id(sessionId));
  }
}
