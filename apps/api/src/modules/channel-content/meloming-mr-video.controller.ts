import { isChannelIdentifier } from './channel-identity.js';
import { ApiTags } from '@nestjs/swagger';
import { Controller, Delete, Get, Headers, Inject, Param, Post, Req, Res, StreamableFile } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { MelomingMrVideoService } from './meloming-mr-video.service.js';

function channel(identifier:string){if(!isChannelIdentifier(identifier, true))throw new ApiError('NOT_FOUND',404);}
function id(value:string){if(!/^[1-9]\d{0,9}$/.test(value)||!Number.isSafeInteger(Number(value)))throw new ApiError('INVALID_REQUEST',400);return Number(value);}

@ApiTags('Songs/MR Video')
@Controller('v1/songs/channel/:identifier/:songId/mr-video')
export class MelomingMrVideoController {
  constructor(@Inject(MelomingMrVideoService) private readonly service:MelomingMrVideoService,
    @Inject(AUTH_CONFIG) private readonly config:AuthConfig) {}
  @Post('multipart/init') @channelDoc('melomingMrVideoInit','원본 MR 영상 멀티파트 시작','write')
  init(@Param('identifier') identifier:string,@Param('songId') songId:string,@Req() request:Request){
    channel(identifier);return this.service.initiate(readCommandCredentials(request,this.config),id(songId),request.body);
  }
  @Post('multipart/part-url') @channelDoc('melomingMrVideoPartUrl','원본 MR 영상 파트 URL','write')
  partUrl(@Param('identifier') identifier:string,@Param('songId') songId:string,@Req() request:Request){
    channel(identifier);return this.service.signPart(readCommandCredentials(request,this.config),id(songId),request.body);
  }
  @Post('multipart/complete') @channelDoc('melomingMrVideoComplete','원본 MR 영상 완료','write')
  complete(@Param('identifier') identifier:string,@Param('songId') songId:string,@Req() request:Request){
    channel(identifier);return this.service.complete(readCommandCredentials(request,this.config),id(songId),request.body);
  }
  @Post('multipart/abort') @channelDoc('melomingMrVideoAbort','원본 MR 영상 중단','write')
  abort(@Param('identifier') identifier:string,@Param('songId') songId:string,@Req() request:Request){
    channel(identifier);return this.service.abort(readCommandCredentials(request,this.config),id(songId),request.body);
  }
  @Delete() @channelDoc('melomingMrVideoDelete','원본 MR 영상 삭제','write')
  remove(@Param('identifier') identifier:string,@Param('songId') songId:string,@Req() request:Request){
    channel(identifier);return this.service.remove(readCommandCredentials(request,this.config),id(songId));
  }
}

@ApiTags('Upload/MR Video')
@Controller('v1/upload/mr-video')
export class MelomingMrVideoReadController {
  constructor(@Inject(MelomingMrVideoService) private readonly service:MelomingMrVideoService) {}
  @Get(':songId/:uploadId') @channelDoc('melomingMrVideoRead','MR 영상 공개 범위 조회')
  async read(@Param('songId') songId:string,@Param('uploadId') uploadId:string,@Headers('range') range:string|undefined,
    @Res({passthrough:true}) response:Response) {
    const result=await this.service.stream(id(songId),uploadId,range);
    response.status(result.contentRange?206:200);
    response.setHeader('Accept-Ranges','bytes');
    if(result.contentRange)response.setHeader('Content-Range',result.contentRange);
    response.setHeader('Content-Length',String(result.bytes));
    response.setHeader('Cache-Control','public, max-age=300');
    return new StreamableFile(result.stream,{type:result.contentType,length:result.bytes,disposition:'inline'});
  }
}
