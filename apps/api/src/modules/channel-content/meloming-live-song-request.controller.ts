import { ApiTags } from '@nestjs/swagger';
import { Controller, Delete, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { MelomingLiveSongRequestService } from './meloming-live-song-request.service.js';
import { MelomingSongLiveGateway } from './meloming-song-live.gateway.js';

function id(value:string):number {
  if (!/^[1-9]\d{0,9}$/.test(value)||!Number.isSafeInteger(Number(value))) throw new ApiError('INVALID_REQUEST',400);
  return Number(value);
}

@ApiTags('Live song requests/Meloming compatibility')
@Controller('v1/song-requests')
export class MelomingLiveSongRequestController {
  constructor(@Inject(MelomingLiveSongRequestService) private readonly requests:MelomingLiveSongRequestService,
    @Inject(AUTH_CONFIG) private readonly config:AuthConfig,
    @Inject(MelomingSongLiveGateway) private readonly gateway:MelomingSongLiveGateway) {}

  private async announce<T>(work:Promise<T>,event:'request.added'|'request.updated'|'request.removed'|'queue.reordered'):Promise<T> {
    const result=await work;
    this.gateway.broadcast(event,{});
    return result;
  }

  @Get() @channelDoc('melomingLiveSongRequestQueue','원본 신청곡 대기열')
  queue(@Req() request:Request) { return this.requests.queue(readSessionCredentials(request,this.config),request.query as Record<string,unknown>); }
  @Post() @channelDoc('melomingLiveSongRequestCreate','원본 라이브 신청곡', 'write',201)
  create(@Req() request:Request) { return this.announce(this.requests.create(readCommandCredentials(request,this.config),request.body),'request.added'); }

  @Get('now-playing') @channelDoc('melomingLiveNowPlaying','원본 현재 재생곡')
  nowPlaying(@Req() request:Request) { return this.requests.nowPlaying(readSessionCredentials(request,this.config),request.query as Record<string,unknown>); }
  @Get('operator-status') @channelDoc('melomingLiveOperatorStatus','원본 신청곡 운영자 상태')
  operator(@Req() request:Request) { return this.requests.operator(readSessionCredentials(request,this.config),request.query as Record<string,unknown>); }
  @Get('requested-song-ids') @channelDoc('melomingRequestedSongIds','원본 세션 신청곡 ID')
  requestedIds(@Req() request:Request) { return this.requests.requestedIds(readSessionCredentials(request,this.config),request.query as Record<string,unknown>); }
  @Get('stats') @channelDoc('melomingLiveSongStats','원본 곡별 신청 통계')
  stats(@Req() request:Request) { return this.requests.stats(request.query as Record<string,unknown>); }
  @Get('history') @channelDoc('melomingLiveSongHistory','원본 곡별 신청 이력')
  history(@Req() request:Request) { return this.requests.history(request.query as Record<string,unknown>); }

  @Post('play-next') @channelDoc('melomingLivePlayNext','원본 다음 신청곡 재생','write',201)
  playNext(@Req() request:Request) { return this.announce(this.requests.advance(readCommandCredentials(request,this.config),request.query as Record<string,unknown>,'next'),'request.updated'); }
  @Post('skip-current') @channelDoc('melomingLiveSkipCurrent','원본 현재 신청곡 스킵','write',201)
  skipCurrent(@Req() request:Request) { return this.announce(this.requests.advance(readCommandCredentials(request,this.config),request.query as Record<string,unknown>,'skip'),'request.updated'); }
  @Delete('queue') @channelDoc('melomingLiveQueueClear','원본 신청곡 대기열 초기화','write')
  clear(@Req() request:Request) { return this.announce(this.requests.clear(readCommandCredentials(request,this.config),request.query as Record<string,unknown>),'queue.reordered'); }

  @Post(':id/play-now') @channelDoc('melomingLivePlayNow','원본 신청곡 즉시 재생','write',201)
  playNow(@Param('id') requestId:string,@Req() request:Request) { return this.announce(this.requests.playNow(readCommandCredentials(request,this.config),id(requestId)),'request.updated'); }
  @Patch(':id/status') @channelDoc('melomingLiveRequestStatus','원본 신청곡 상태 변경','write')
  status(@Param('id') requestId:string,@Req() request:Request) { return this.announce(this.requests.status(readCommandCredentials(request,this.config),id(requestId),request.body),'request.updated'); }
  @Patch(':id/order') @channelDoc('melomingLiveRequestOrder','원본 신청곡 순서 변경','write')
  order(@Param('id') requestId:string,@Req() request:Request) { return this.announce(this.requests.order(readCommandCredentials(request,this.config),id(requestId),request.body),'queue.reordered'); }
  @Delete(':id/mine') @channelDoc('melomingLiveRequestCancel','원본 내 신청곡 취소','write')
  mine(@Param('id') requestId:string,@Req() request:Request) { return this.announce(this.requests.remove(readCommandCredentials(request,this.config),id(requestId),true),'request.removed'); }
  @Delete(':id') @channelDoc('melomingLiveRequestDelete','원본 신청곡 삭제','write')
  remove(@Param('id') requestId:string,@Req() request:Request) { return this.announce(this.requests.remove(readCommandCredentials(request,this.config),id(requestId)),'request.removed'); }
}

@ApiTags('Live song requests/Meloming compatibility')
@Controller('v1/song-live/sessions')
export class MelomingManualSongRequestController {
  constructor(@Inject(MelomingLiveSongRequestService) private readonly requests:MelomingLiveSongRequestService,
    @Inject(AUTH_CONFIG) private readonly config:AuthConfig,
    @Inject(MelomingSongLiveGateway) private readonly gateway:MelomingSongLiveGateway) {}
  @Post(':id/manual-requests') @channelDoc('melomingManualSongRequest','원본 수동 신청곡 추가','write',201)
  async manual(@Param('id') sessionId:string,@Req() request:Request) {
    const parsedId=id(sessionId);
    const result=await this.requests.manual(readCommandCredentials(request,this.config),parsedId,request.body);
    this.gateway.broadcast('request.added',{sessionId:parsedId});
    return result;
  }
}
