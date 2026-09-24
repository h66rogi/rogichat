import { Controller, Headers, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { MelomingVideoCacheService } from './meloming-video-cache.service.js';
import { channelDoc } from './channel-content.openapi.js';

@ApiTags('Video Cache (Internal)')
@Controller('v1/internal/video-cache')
export class MelomingVideoCacheController {
  constructor(@Inject(MelomingVideoCacheService) private readonly service: MelomingVideoCacheService) {}

  @Post('upsert')
  @HttpCode(204)
  @channelDoc('melomingVideoCacheUpsert', '원본 게이트웨이 영상 캐시 등록', 'none', 204)
  upsert(@Headers('x-callback-timestamp') timestamp: string | undefined,
    @Headers('x-callback-signature') signature: string | undefined,
    @Req() request: Request) {
    return this.service.upsert(timestamp, signature, request.body);
  }
}
