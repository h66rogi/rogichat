import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { readSessionCredentials } from '../auth/auth-context.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { MessageCommandsService } from './message-commands.service.js';

@Controller('v1/rooms/:roomId/message-commands')
export class MessageCommandsController {
  constructor(@Inject(MessageCommandsService) private readonly commands: MessageCommandsService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  @Get(':clientMessageId')
  get(@Req() request: Request, @Param('roomId') roomId: string, @Param('clientMessageId') clientMessageId: string) {
    return this.commands.get(readSessionCredentials(request, this.config), roomId, clientMessageId);
  }
}
