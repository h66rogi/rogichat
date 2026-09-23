import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { MelomingOmakaseService } from './meloming-omakase.service.js';
import { MelomingSongLiveGateway } from './meloming-song-live.gateway.js';

@ApiTags('Omakase/Meloming compatibility')
@Controller('v1/channel/:channelId/omakase-settings')
export class MelomingOmakaseSettingsController {
  constructor(@Inject(MelomingOmakaseService) private readonly omakase:MelomingOmakaseService,
    @Inject(AUTH_CONFIG) private readonly config:AuthConfig,
    @Inject(MelomingSongLiveGateway) private readonly gateway:MelomingSongLiveGateway) {}
  @Get() @channelDoc('melomingOmakaseSettingsGet','원본 오마카세 설정','read')
  get(@Param('channelId') channelId:string,@Req() request:Request) {
    if(channelId!=='1')throw new ApiError('NOT_FOUND',404);
    return this.omakase.get(readSessionCredentials(request,this.config));
  }
  @Patch() @channelDoc('melomingOmakaseSettingsUpdate','원본 오마카세 설정 변경','write')
  async update(@Param('channelId') channelId:string,@Req() request:Request) {
    if(channelId!=='1')throw new ApiError('NOT_FOUND',404);
    const result=await this.omakase.update(readCommandCredentials(request,this.config),request.body);
    this.gateway.broadcast('settings.updated',{});
    return result;
  }
}

@ApiTags('Omakase/Meloming compatibility')
@Controller('v1/console-api/omakase')
export class MelomingOmakaseConsoleController {
  constructor(@Inject(MelomingOmakaseService) private readonly omakase:MelomingOmakaseService,
    @Inject(AUTH_CONFIG) private readonly config:AuthConfig,
    @Inject(MelomingSongLiveGateway) private readonly gateway:MelomingSongLiveGateway) {}
  @Get('status') @channelDoc('melomingOmakaseStatus','원본 콘솔 오마카세 상태','read')
  status(@Req() request:Request) {return this.omakase.get(readSessionCredentials(request,this.config));}
  @Get('history') @channelDoc('melomingOmakaseHistory','원본 오마카세 장부','read')
  history(@Req() request:Request) {return this.omakase.history(readSessionCredentials(request,this.config),request.query.limit);}
  @Post('adjust') @HttpCode(200) @channelDoc('melomingOmakaseAdjust','원본 오마카세 수량 증감','write')
  async adjust(@Req() request:Request) {
    const result=await this.omakase.adjust(readCommandCredentials(request,this.config),request.body);
    this.gateway.broadcast('settings.updated',{});return result;
  }
  @Post('set-count') @HttpCode(200) @channelDoc('melomingOmakaseSetCount','원본 오마카세 수량 설정','write')
  async setCount(@Req() request:Request) {
    const result=await this.omakase.setCount(readCommandCredentials(request,this.config),request.body);
    this.gateway.broadcast('settings.updated',{});return result;
  }
  @Post('consume') @HttpCode(200) @channelDoc('melomingOmakaseConsume','원본 오마카세 선곡','write')
  async consume(@Req() request:Request) {
    const result=await this.omakase.consume(readCommandCredentials(request,this.config),request.body);
    this.gateway.broadcast('request.added',{});return result;
  }
}
