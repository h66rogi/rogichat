import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readSessionCredentials } from '../auth/auth-context.js';
import { syncInput } from './dto/sync.dto.js';
import { SyncService } from './sync.service.js';

@Controller('v1')
export class SyncController {
  constructor(@Inject(SyncService) private readonly sync: SyncService, @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}
  @Get('sync')
  manifest(@Req() request: Request) { return this.sync.manifest(readSessionCredentials(request, this.config), syncInput(request.query)); }
  @Get('rooms/:roomId/snapshot')
  snapshot(@Req() request: Request, @Param('roomId') roomId: string) { return this.sync.snapshot(readSessionCredentials(request, this.config), roomId, syncInput(request.query)); }
  @Get('rooms/:roomId/events')
  events(@Req() request: Request, @Param('roomId') roomId: string) { return this.sync.events(readSessionCredentials(request, this.config), roomId, syncInput(request.query)); }
  @Get('rooms/:roomId/history')
  history(@Req() request: Request, @Param('roomId') roomId: string) { return this.sync.history(readSessionCredentials(request, this.config), roomId, syncInput(request.query)); }
  @Get('rooms/:roomId/profile-sync')
  profiles(@Req() request: Request, @Param('roomId') roomId: string) { return this.sync.profiles(readSessionCredentials(request, this.config), roomId, syncInput(request.query)); }
}
