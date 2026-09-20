import { Controller, Get, HttpCode, Inject, Param, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { parseReadState } from './dto/read-state.dto.js';
import { ReadStateService } from './read-state.service.js';

@Controller('v1/rooms/:roomId/read-state')
export class ReadStateController {
  constructor(@Inject(ReadStateService) private readonly state: ReadStateService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  @Get()
  get(@Req() request: Request, @Param('roomId') roomId: string) {
    return this.state.get(readSessionCredentials(request, this.config), roomId);
  }

  @Put() @HttpCode(200)
  put(@Req() request: Request, @Param('roomId') roomId: string) {
    return this.state.put(readCommandCredentials(request, this.config), roomId, parseReadState(request.body));
  }
}
