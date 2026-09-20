import { Controller, Get, Post, HttpCode, Inject, Param, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { AdminService } from './admin.service.js';
import { adminDocs } from './admin.openapi.js';
@ApiTags('Administration')
@Controller('v1')
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService, @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}
  @Get('me/capabilities')
  @adminDocs.me()
  capabilities(@Req() request: Request) { return this.admin.capabilities(readSessionCredentials(request, this.config)); }
  @Get('rooms/:roomId/capabilities')
  @adminDocs.room()
  room(@Req() request: Request, @Param('roomId') roomId: string) { return this.admin.roomCapabilities(readSessionCredentials(request, this.config), roomId); }
  @Post('admin/rooms/:roomId/test-grants')
  @adminDocs.issue()
  issue(@Req() request: Request, @Param('roomId') roomId: string) { return this.admin.issue(readCommandCredentials(request, this.config), roomId, request.body); }
  @Get('admin/rooms/:roomId/test-grants')
  @adminDocs.list()
  list(@Req() request: Request, @Param('roomId') roomId: string, @Query('after') after?: string) { return this.admin.list(readSessionCredentials(request, this.config), roomId, after); }
  @Post('admin/rooms/:roomId/test-grants/:grantId/revoke')
  @HttpCode(204)
  @adminDocs.revoke()
  revoke(@Req() request: Request, @Param('roomId') roomId: string, @Param('grantId') grantId: string) { return this.admin.revoke(readCommandCredentials(request, this.config), roomId, grantId, request.body); }
}
