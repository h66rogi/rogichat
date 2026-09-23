import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { channelDoc } from './channel-content.openapi.js';
import { MelomingClipService } from './meloming-clip.service.js';

function id(value: string): number {
  if (!/^[1-9]\d{0,9}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ApiError('INVALID_REQUEST', 400);
  return Number(value);
}

@ApiTags('Song clips/Meloming compatibility')
@Controller('v1/clips')
export class MelomingClipController {
  constructor(@Inject(MelomingClipService) private readonly clips: MelomingClipService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  @Post('url/resolve') @channelDoc('melomingClipResolve', '원본 영상 URL 메타데이터 조회', 'read')
  resolve(@Req() request: Request) { return this.clips.resolve(request.body); }

  @Get('channels/:channelId/permission') @channelDoc('melomingClipPermission', '원본 클립 등록 권한', 'read')
  permission(@Param('channelId') channelId: string, @Req() request: Request) {
    if (channelId !== '1') throw new ApiError('NOT_FOUND', 404);
    return this.clips.permission(readSessionCredentials(request, this.config));
  }

  @Post('requests') @channelDoc('melomingClipRequestCreate', '원본 클립 등록 신청', 'write', 201)
  createRequest(@Req() request: Request) {
    return this.clips.createRequest(readCommandCredentials(request, this.config), request.body);
  }

  @Get('requests/channel/:channelId') @channelDoc('melomingClipRequestsChannel', '원본 클립 등록 신청 목록', 'read')
  requests(@Param('channelId') channelId: string, @Req() request: Request) {
    if (channelId !== '1') throw new ApiError('NOT_FOUND', 404);
    return this.clips.requests(readSessionCredentials(request, this.config), request.query as Record<string, unknown>);
  }

  @Patch('requests/:id/approve') @channelDoc('melomingClipRequestApprove', '원본 클립 등록 신청 승인', 'write')
  approve(@Param('id') requestId: string, @Req() request: Request) {
    return this.clips.processRequest(readCommandCredentials(request, this.config), id(requestId), 'approve');
  }

  @Patch('requests/:id/reject') @channelDoc('melomingClipRequestReject', '원본 클립 등록 신청 거절', 'write')
  reject(@Param('id') requestId: string, @Req() request: Request) {
    return this.clips.processRequest(readCommandCredentials(request, this.config), id(requestId), 'reject', request.body);
  }

  @Get('channel/:identifier') @channelDoc('melomingClipsChannel', '원본 채널 클립 목록')
  list(@Param('identifier') identifier: string, @Req() request: Request) {
    return this.clips.list(identifier, request.query as Record<string, unknown>);
  }

  @Post() @channelDoc('melomingClipCreate', '원본 클립 등록', 'write', 201)
  create(@Req() request: Request) {
    return this.clips.create(readCommandCredentials(request, this.config), request.body);
  }

  @Get(':clipId') @channelDoc('melomingClipDetail', '원본 클립 상세')
  detail(@Param('clipId') clipId: string) { return this.clips.detail(id(clipId)); }
}
