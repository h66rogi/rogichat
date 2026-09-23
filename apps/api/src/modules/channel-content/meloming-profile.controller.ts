import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Inject, Param, Patch, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { MelomingProfileService } from './meloming-profile.service.js';

function channel(value: string): void {
  if (value !== '1') throw new ApiError('NOT_FOUND', 404);
}

@ApiTags('Channel/Profile')
@Controller('v1/channel/:channelId/profile')
export class MelomingProfileController {
  constructor(
    @Inject(MelomingProfileService) private readonly service: MelomingProfileService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Get() @channelDoc('melomingChannelProfilePublic', '원본 채널 프로필 조회')
  public(@Param('channelId') value: string) {
    channel(value);
    return this.service.public();
  }

  @Put() @channelDoc('melomingChannelProfilePut', '원본 채널 프로필 저장', 'write')
  put(@Param('channelId') value: string, @Req() request: Request) {
    channel(value);
    return this.service.save(readCommandCredentials(request, this.config), request.body);
  }

  @Patch() @channelDoc('melomingChannelProfilePatch', '원본 채널 프로필 부분 수정', 'write')
  patch(@Param('channelId') value: string, @Req() request: Request) {
    channel(value);
    return this.service.save(readCommandCredentials(request, this.config), request.body);
  }
}
