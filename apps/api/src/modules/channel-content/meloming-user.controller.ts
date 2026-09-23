import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Inject, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readSessionCredentials } from '../auth/auth-context.js';
import { channelDoc } from './channel-content.openapi.js';
import { MelomingUserService } from './meloming-user.service.js';

@ApiTags('User/Meloming compatibility')
@Controller('v1/user')
export class MelomingUserController {
  constructor(
    @Inject(MelomingUserService) private readonly users: MelomingUserService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Get('me') @channelDoc('melomingUserMe', '원본 관리자 로그인 사용자 정보', 'read')
  me(@Req() request: Request) {
    return this.users.me(readSessionCredentials(request, this.config));
  }
}
