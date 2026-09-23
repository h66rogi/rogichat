import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Inject, Param, Patch, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { MelomingSetlistService } from './meloming-setlist.service.js';

function id(value: string): number {
  if (!/^[1-9]\d{0,9}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ApiError('INVALID_REQUEST', 400);
  return Number(value);
}

@ApiTags('Song live setlists/Meloming compatibility')
@Controller('v1/song-live')
export class MelomingSetlistController {
  constructor(@Inject(MelomingSetlistService) private readonly setlists: MelomingSetlistService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  @Get('public/setlists') @channelDoc('melomingPublicSetlists', '원본 공개 셋리스트 목록')
  publicList(@Req() request: Request) { return this.setlists.publicList(request.query as Record<string, unknown>); }

  @Get('public/setlists/availability') @channelDoc('melomingSetlistAvailability', '원본 공개 셋리스트 가용성')
  availability(@Req() request: Request) { return this.setlists.availability(request.query as Record<string, unknown>); }

  @Get('public/setlists/:sessionId') @channelDoc('melomingPublicSetlistDetail', '원본 공개 셋리스트 상세')
  detail(@Param('sessionId') sessionId: string, @Req() request: Request) {
    return this.setlists.detail(id(sessionId), request.query as Record<string, unknown>);
  }

  @Get('manage/setlists') @channelDoc('melomingManageSetlists', '원본 셋리스트 관리 목록', 'read')
  manage(@Req() request: Request) {
    return this.setlists.manage(readSessionCredentials(request, this.config), request.query as Record<string, unknown>);
  }

  @Patch('manage/setlists/:sessionId/visibility') @channelDoc('melomingSetlistVisibility', '원본 셋리스트 공개 설정', 'write')
  visibility(@Param('sessionId') sessionId: string, @Req() request: Request) {
    return this.setlists.visibility(readCommandCredentials(request, this.config), id(sessionId),
      request.query as Record<string, unknown>, request.body);
  }
}
