import { Controller, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { object } from '../auth/auth-primitives.js';
import { identifier } from '../../common/validation/identifier.js';
import { RoomsService } from './rooms.service.js';

@Controller('v1')
export class RoomsController {
  constructor(@Inject(RoomsService) private readonly rooms: RoomsService, @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}
  @Get('rooms')
  list(@Req() request: Request) {
    const query = object(request.query, ['after']);
    return this.rooms.list(readSessionCredentials(request, this.config), query.after === undefined ? undefined : identifier(query.after));
  }
  @Post('admin/rooms') @HttpCode(201)
  provision(@Req() request: Request) { return this.rooms.provision(readCommandCredentials(request, this.config), request.body); }
  @Post('rooms/:roomId/join') @HttpCode(200)
  join(@Req() request: Request, @Param('roomId') roomId: string) {
    object(request.body, []);
    return this.rooms.join(readCommandCredentials(request, this.config), identifier(roomId));
  }
  @Post('rooms/:roomId/leave') @HttpCode(204)
  leave(@Req() request: Request, @Param('roomId') roomId: string) {
    object(request.body, []);
    return this.rooms.leave(readCommandCredentials(request, this.config), identifier(roomId));
  }
  @Patch('rooms/:roomId/history-policy')
  policy(@Req() request: Request, @Param('roomId') roomId: string) {
    return this.rooms.historyPolicy(readCommandCredentials(request, this.config), identifier(roomId), request.body);
  }
  @Get('rooms/:roomId/media-policy')
  mediaPolicy(@Req() request: Request, @Param('roomId') roomId: string) {
    object(request.query, []);
    return this.rooms.readMediaPolicy(readSessionCredentials(request, this.config), identifier(roomId));
  }
  @Patch('rooms/:roomId/media-policy')
  updateMediaPolicy(@Req() request: Request, @Param('roomId') roomId: string) {
    object(request.query, []);
    return this.rooms.updateMediaPolicy(readCommandCredentials(request, this.config), identifier(roomId), request.body);
  }
}
