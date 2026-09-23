import { ApiTags } from '@nestjs/swagger';
import { Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readSessionCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { SerperService } from './upstream/serper/serper.service.js';
import { MelomingReadAccessService } from './meloming-read-access.service.js';

function searchBody(value:unknown,kind:'images'|'video'|'web',max=50) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError('INVALID_REQUEST',400);
  const raw=value as Record<string,unknown>;
  const keys=kind==='images'?['title','artist']:['query','num'];
  if(Object.keys(raw).some(key=>!keys.includes(key)))throw new ApiError('INVALID_REQUEST',400);
  if(kind==='images') {
    if(typeof raw.title!=='string'||!raw.title.trim()||raw.title.length>255||
      typeof raw.artist!=='string'||!raw.artist.trim()||raw.artist.length>255)throw new ApiError('INVALID_REQUEST',400);
    return {title:raw.title.trim(),artist:raw.artist.trim()};
  }
  if(typeof raw.query!=='string'||!raw.query.trim()||raw.query.length>255||
    raw.num!==undefined&&(typeof raw.num!=='number'||!Number.isInteger(raw.num)||raw.num<1||raw.num>max))
    throw new ApiError('INVALID_REQUEST',400);
  return {query:raw.query.trim(),...(typeof raw.num==='number'?{num:raw.num}:{})};
}

@ApiTags('Song metadata search/Meloming compatibility')
@Controller('v1/serper')
export class MelomingSearchController {
  constructor(@Inject(MelomingReadAccessService) private readonly access:MelomingReadAccessService,
    @Inject(AUTH_CONFIG) private readonly config:AuthConfig,
    @Inject(SerperService) private readonly search:SerperService) {}

  private async authenticated(request:Request) {
    await this.access.requireAccount(readSessionCredentials(request,this.config));
  }

  @Post('search') @HttpCode(200) @channelDoc('melomingImageSearch','원본 이미지 검색','read')
  async images(@Req() request:Request) {
    const dto=searchBody(request.body,'images');
    await this.authenticated(request);
    return this.search.searchImages(dto as {title:string;artist:string});
  }
  @Post('search-video') @HttpCode(200) @channelDoc('melomingVideoSearch','원본 영상 검색','read')
  async videos(@Req() request:Request) {
    const dto=searchBody(request.body,'video');
    await this.authenticated(request);
    return this.search.searchVideos(dto as {query:string;num?:number});
  }
  @Post('search-web') @HttpCode(200) @channelDoc('melomingWebSearch','원본 웹 검색','read')
  async web(@Req() request:Request) {
    const dto=searchBody(request.body,'web');
    await this.authenticated(request);
    return this.search.searchWeb(dto as {query:string;num?:number});
  }
}

@ApiTags('Song metadata search/Meloming compatibility')
@Controller('v1/console-api/serper')
export class MelomingConsoleSearchController {
  constructor(@Inject(MelomingReadAccessService) private readonly access:MelomingReadAccessService,
    @Inject(AUTH_CONFIG) private readonly config:AuthConfig,
    @Inject(SerperService) private readonly search:SerperService) {}
  @Post('search-video') @HttpCode(200) @channelDoc('melomingConsoleVideoSearch','원본 콘솔 영상 검색','read')
  async videos(@Req() request:Request) {
    const dto=searchBody(request.body,'video',20);
    await this.access.requireAccount(readSessionCredentials(request,this.config));
    return this.search.searchVideos(dto as {query:string;num?:number});
  }
}
