import { ApiTags } from '@nestjs/swagger';
import { Controller, Delete, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { MelomingSongAddRequestService } from './meloming-song-add-request.service.js';

function id(value: string): number {
  if (!/^[1-9]\d{0,9}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ApiError('INVALID_REQUEST', 400);
  return Number(value);
}

@ApiTags('Song add requests/Meloming compatibility')
@Controller('v1/songs')
export class MelomingSongAddRequestController {
  constructor(@Inject(MelomingSongAddRequestService) private readonly requests: MelomingSongAddRequestService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  @Get('channels/:channelId/permission') @channelDoc('melomingSongRequestPermission', '원본 노래 등록 권한', 'read')
  permission(@Param('channelId') channelId: string, @Req() request: Request) {
    if (channelId !== '1') throw new ApiError('NOT_FOUND', 404);
    return this.requests.permission(readSessionCredentials(request, this.config));
  }

  @Post('requests') @channelDoc('melomingSongRequestCreate', '원본 노래 등록 신청', 'write', 201)
  create(@Req() request: Request) {
    return this.requests.create(readCommandCredentials(request, this.config), request.body);
  }

  @Get('requests/my') @channelDoc('melomingSongRequestsMy', '원본 내 노래 등록 신청 목록', 'read')
  my(@Req() request: Request) {
    return this.requests.my(readSessionCredentials(request, this.config), request.query as Record<string, unknown>);
  }

  @Get('requests/channel/:channelId') @channelDoc('melomingSongRequestsChannel', '원본 채널 노래 등록 신청 목록', 'read')
  channel(@Param('channelId') channelId: string, @Req() request: Request) {
    if (channelId !== '1') throw new ApiError('NOT_FOUND', 404);
    return this.requests.channelRequests(readSessionCredentials(request, this.config), request.query as Record<string, unknown>);
  }

  @Patch('requests/:id/approve') @channelDoc('melomingSongRequestApprove', '원본 노래 등록 신청 승인', 'write')
  approve(@Param('id') requestId: string, @Req() request: Request) {
    return this.requests.approve(readCommandCredentials(request, this.config), id(requestId), request.body);
  }

  @Patch('requests/:id/reject') @channelDoc('melomingSongRequestReject', '원본 노래 등록 신청 거절', 'write')
  reject(@Param('id') requestId: string, @Req() request: Request) {
    return this.requests.reject(readCommandCredentials(request, this.config), id(requestId), request.body);
  }

  @Delete('requests/:id') @channelDoc('melomingSongRequestCancel', '원본 노래 등록 신청 취소', 'write')
  cancel(@Param('id') requestId: string, @Req() request: Request) {
    return this.requests.cancel(readCommandCredentials(request, this.config), id(requestId));
  }
}
