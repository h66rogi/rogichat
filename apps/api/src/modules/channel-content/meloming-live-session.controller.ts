import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { MelomingLiveSessionService } from './meloming-live-session.service.js';
import { MelomingSongLiveGateway } from './meloming-song-live.gateway.js';

function id(value: string): number {
  if (!/^[1-9]\d{0,9}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ApiError('INVALID_REQUEST', 400);
  return Number(value);
}

@ApiTags('Song live sessions/Meloming compatibility')
@Controller('v1/song-live')
export class MelomingLiveSessionController {
  constructor(@Inject(MelomingLiveSessionService) private readonly sessions: MelomingLiveSessionService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(MelomingSongLiveGateway) private readonly gateway: MelomingSongLiveGateway) {}

  @Post('sessions') @channelDoc('melomingLiveSessionStart', '원본 라이브 세션 시작', 'write', 201)
  async start(@Req() request: Request) {
    const session = await this.sessions.start(readCommandCredentials(request,this.config),request.query as Record<string,unknown>,request.body);
    if(session)this.gateway.broadcast('session.started',{sessionId:session.id,isLive:true});
    return session;
  }

  @Get('sessions/active') @channelDoc('melomingLiveSessionActive', '원본 활성 세션', 'read')
  active(@Req() request: Request) { return this.sessions.active(readSessionCredentials(request,this.config),request.query as Record<string,unknown>); }

  @Get('public/active') @channelDoc('melomingPublicLiveSession', '원본 공개 활성 세션')
  publicActive(@Req() request: Request) { return this.sessions.publicActive(readSessionCredentials(request,this.config),request.query as Record<string,unknown>); }

  @Post('sessions/:id/end') @channelDoc('melomingLiveSessionEnd', '원본 라이브 세션 종료', 'write', 201)
  async end(@Param('id') sessionId: string, @Req() request: Request) {
    const ended=await this.sessions.end(readCommandCredentials(request,this.config),id(sessionId));
    this.gateway.broadcast('session.ended',{sessionId:ended.id,isLive:false});
    return ended;
  }

  @Patch('sessions/:id') @channelDoc('melomingLiveSessionSettings','원본 라이브 세션 설정 변경','write')
  async update(@Param('id') sessionId:string,@Req() request:Request) {
    const parsedId=id(sessionId);
    const settings=await this.sessions.updateSettings(readCommandCredentials(request,this.config),parsedId,request.body);
    this.gateway.broadcast('settings.updated',{sessionId:parsedId});
    return settings;
  }

  @Post('sessions/:id/clone') @channelDoc('melomingLiveSessionClone','원본 방송 기록 복제','write',201)
  async clone(@Param('id') sessionId:string,@Req() request:Request) {
    const session=await this.sessions.clone(readCommandCredentials(request,this.config),id(sessionId),request.query as Record<string,unknown>);
    if(session)this.gateway.broadcast('session.started',{sessionId:session.id,isLive:true});
    return session;
  }

  @Get('sessions/history') @channelDoc('melomingLiveSessionHistory', '원본 방송 기록', 'read')
  history(@Req() request: Request) { return this.sessions.history(readSessionCredentials(request,this.config),request.query as Record<string,unknown>); }

  @Get('sessions/:id/detail') @channelDoc('melomingLiveSessionDetail', '원본 방송 기록 상세', 'read')
  detail(@Param('id') sessionId: string, @Req() request: Request) {
    return this.sessions.detail(readSessionCredentials(request,this.config),id(sessionId));
  }
}
