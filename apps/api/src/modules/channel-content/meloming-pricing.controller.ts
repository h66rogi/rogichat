import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, HttpCode, Inject, Param, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { MelomingPricingService } from './meloming-pricing.service.js';

function channel(value:string) {if(value!=='1')throw new ApiError('NOT_FOUND',404);}
function id(value:string) {if(!/^[1-9]\d{0,9}$/.test(value)||!Number.isSafeInteger(Number(value)))throw new ApiError('INVALID_REQUEST',400);return Number(value);}

@ApiTags('Song pricing/Meloming compatibility')
@Controller('v1/channels/:channelId')
export class MelomingPricingController {
  constructor(@Inject(MelomingPricingService) private readonly pricing:MelomingPricingService,
    @Inject(AUTH_CONFIG) private readonly config:AuthConfig) {}

  @Get('pricing-settings') @channelDoc('melomingPricingSettings','원본 신청곡 가격 설정')
  get(@Param('channelId') channelId:string) {channel(channelId);return this.pricing.get();}

  @Put('pricing-settings') @channelDoc('melomingPricingSettingsUpdate','원본 신청곡 가격 설정 변경','write')
  update(@Param('channelId') channelId:string,@Req() request:Request) {
    channel(channelId);return this.pricing.update(readCommandCredentials(request,this.config),request.body);
  }

  @Patch('songs/:songId/price') @channelDoc('melomingSongPriceUpdate','원본 곡 가격 변경','write')
  updateSong(@Param('channelId') channelId:string,@Param('songId') songId:string,@Req() request:Request) {
    channel(channelId);return this.pricing.updateItem(readCommandCredentials(request,this.config),id(songId),'song',request.body);
  }

  @Patch('categories/:categoryId/price') @channelDoc('melomingCategoryPriceUpdate','원본 분류 가격 변경','write')
  updateCategory(@Param('channelId') channelId:string,@Param('categoryId') categoryId:string,@Req() request:Request) {
    channel(channelId);return this.pricing.updateItem(readCommandCredentials(request,this.config),id(categoryId),'category',request.body);
  }

  @Get('songs/:songId/price') @channelDoc('melomingSongPriceGet','원본 곡 계산 가격')
  songPrice(@Param('channelId') channelId:string,@Param('songId') songId:string) {
    channel(channelId);return this.pricing.songPrice(id(songId));
  }

  @Post('songs/calculate-prices') @HttpCode(200) @channelDoc('melomingPricesCalculate','원본 곡 일괄 가격 계산')
  calculate(@Param('channelId') channelId:string,@Req() request:Request) {
    channel(channelId);return this.pricing.calculate(request.body);
  }
}
