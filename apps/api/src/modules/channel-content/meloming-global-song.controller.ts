import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { MelomingReadAccessService } from './meloming-read-access.service.js';
import { GlobalSongMatcherService } from './upstream/global-song/global-song-matcher.service.js';
import { GlobalSongQuickAddService } from './upstream/global-song/global-song-quick-add.service.js';
import { GlobalSongRecommendationService } from './upstream/global-song/global-song-recommendation.service.js';

function channelId(value:string) {if(value!=='1')throw new ApiError('NOT_FOUND',404);return 1;}

@ApiTags('Global songs/Meloming compatibility')
@Controller('v1/global-songs')
export class MelomingGlobalSongController {
  constructor(@Inject(MelomingReadAccessService) private readonly access:MelomingReadAccessService,
    @Inject(AUTH_CONFIG) private readonly config:AuthConfig,
    @Inject(GlobalSongMatcherService) private readonly matcher:GlobalSongMatcherService,
    @Inject(GlobalSongQuickAddService) private readonly quickAdd:GlobalSongQuickAddService,
    @Inject(GlobalSongRecommendationService) private readonly recommendations:GlobalSongRecommendationService) {}

  @Post('match') @HttpCode(200) @channelDoc('melomingGlobalSongMatch','원본 글로벌 곡 검색','read')
  async match(@Req() request:Request) {
    const raw=request.body as Record<string,unknown>;
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!['query','channelId','limit'].includes(key))||
      typeof raw.query!=='string'||!raw.query.trim()||raw.query.length>300||
      raw.channelId!==undefined&&raw.channelId!==1||
      raw.limit!==undefined&&(!Number.isSafeInteger(raw.limit)||Number(raw.limit)<1||Number(raw.limit)>20))throw new ApiError('INVALID_REQUEST',400);
    await this.access.requireAccount(readSessionCredentials(request,this.config));
    return this.matcher.match({query:raw.query,...(raw.channelId!==undefined?{channelId:raw.channelId as number}:{}),
      ...(raw.limit!==undefined?{limit:raw.limit as number}:{})});
  }

  @Post('quick-add/channel/:channelId') @channelDoc('melomingGlobalSongQuickAdd','원본 글로벌 곡 빠른 등록','write',201)
  add(@Param('channelId') value:string,@Req() request:Request) {
    return this.quickAdd.quickAdd(channelId(value),request.body,readCommandCredentials(request,this.config));
  }

  @Get('recommendations/channel/:channelId') @channelDoc('melomingGlobalSongRecommendations','원본 글로벌 곡 추천','read')
  async list(@Param('channelId') value:string,@Req() request:Request) {
    channelId(value);
    const raw=request.query as Record<string,unknown>;
    if(Object.keys(raw).some(key=>!['limit','offset'].includes(key)))throw new ApiError('INVALID_REQUEST',400);
    const limit=raw.limit===undefined?20:Number(raw.limit),offset=raw.offset===undefined?0:Number(raw.offset);
    if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0)throw new ApiError('INVALID_REQUEST',400);
    await this.access.requireAccount(readSessionCredentials(request,this.config));
    return this.recommendations.getRecommendations(1,limit,offset);
  }
}
