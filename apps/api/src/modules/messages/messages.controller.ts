import { Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../auth-config.js';
import { object } from '../auth/auth-primitives.js';
import { identifier } from '../../common/validation/identifier.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { sendInput } from './dto/send-message.dto.js';
import { MessagesService } from './messages.service.js';

@Controller('v1/rooms/:roomId/messages')
export class MessagesController {
  constructor(@Inject(MessagesService) private readonly messages: MessagesService, @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}
  @Post() @HttpCode(200)
  send(@Req() request: Request, @Param('roomId') roomId: string) {
    identifier(roomId);
    const input = sendInput(request.body);
    return this.messages.send(readCommandCredentials(request, this.config), roomId, input);
  }
  @Get(':messageId')
  get(@Req() request: Request, @Param('roomId') roomId: string, @Param('messageId') messageId: string) {
    return this.messages.get(readSessionCredentials(request, this.config), roomId, messageId);
  }
  @Post(':messageId/delete') @HttpCode(200)
  remove(@Req() request: Request, @Param('roomId') roomId: string, @Param('messageId') messageId: string) {
    object(request.body, []);
    return this.messages.remove(readCommandCredentials(request, this.config), roomId, messageId);
  }
}
