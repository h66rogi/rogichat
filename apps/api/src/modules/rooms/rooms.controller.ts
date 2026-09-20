import { ApiTags } from '@nestjs/swagger';
import { roomDocs } from './dto/room.openapi.js';
import { Controller, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { object } from '../auth/auth-primitives.js';
import { identifier } from '../../common/validation/identifier.js';
import { RoomsService } from './rooms.service.js';

@ApiTags('Rooms')
@Controller('v1')
export class RoomsController {
  constructor(@Inject(RoomsService) private readonly rooms: RoomsService, @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}
  @Get('rooms')
  @roomDocs.list()
  list(@Req() request: Request) {
    const query = object(request.query, ['after']);
    return this.rooms.list(readSessionCredentials(request, this.config), query.after === undefined ? undefined : identifier(query.after));
  }
  @Post('admin/rooms') @HttpCode(201)
  @roomDocs.provision()
  provision(@Req() request: Request) { return this.rooms.provision(readCommandCredentials(request, this.config), request.body); }
  @Get('rooms/:roomId/private-recipients')
  @roomDocs.privateRecipients()
  privateRecipients(@Req() request: Request, @Param('roomId') roomId: string) {
    const query = object(request.query, ['after']);
    return this.rooms.privateRecipients(readSessionCredentials(request, this.config), identifier(roomId), query.after === undefined ? undefined : identifier(query.after));
  }
  @Post('rooms/:roomId/join') @HttpCode(200)
  @roomDocs.join()
  join(@Req() request: Request, @Param('roomId') roomId: string) {
    object(request.body, []);
    return this.rooms.join(readCommandCredentials(request, this.config), identifier(roomId));
  }
  @Post('rooms/:roomId/leave') @HttpCode(204)
  @roomDocs.leave()
  leave(@Req() request: Request, @Param('roomId') roomId: string) {
    object(request.body, []);
    return this.rooms.leave(readCommandCredentials(request, this.config), identifier(roomId));
  }
  @Patch('rooms/:roomId/history-policy')
  @roomDocs.policy()
  policy(@Req() request: Request, @Param('roomId') roomId: string) {
    return this.rooms.historyPolicy(readCommandCredentials(request, this.config), identifier(roomId), request.body);
  }
  @Get('rooms/:roomId/media-policy')
  @roomDocs.mediaPolicy()
  mediaPolicy(@Req() request: Request, @Param('roomId') roomId: string) {
    object(request.query, []);
    return this.rooms.readMediaPolicy(readSessionCredentials(request, this.config), identifier(roomId));
  }
  @Patch('rooms/:roomId/media-policy')
  @roomDocs.updateMediaPolicy()
  updateMediaPolicy(@Req() request: Request, @Param('roomId') roomId: string) {
    object(request.query, []);
    return this.rooms.updateMediaPolicy(readCommandCredentials(request, this.config), identifier(roomId), request.body);
  }
}
