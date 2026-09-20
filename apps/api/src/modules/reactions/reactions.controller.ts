import { ApiTags } from '@nestjs/swagger';
import { reactionDocs } from './dto/reaction.openapi.js';
import { Controller, Delete, Get, HttpCode, Inject, Param, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { object } from '../auth/auth-primitives.js';
import { reactionEmoji } from './dto/reaction.dto.js';
import { ReactionsService } from './reactions.service.js';

@ApiTags('Reactions')
@Controller('v1/rooms/:roomId/messages/:messageId/reactions')
export class ReactionsController {
  constructor(@Inject(ReactionsService) private readonly reactions: ReactionsService, @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}
  @Get()
  @reactionDocs.get()
  get(@Req() request: Request, @Param('roomId') roomId: string, @Param('messageId') messageId: string) {
    return this.reactions.get(readSessionCredentials(request, this.config), roomId, messageId);
  }
  @Put('me')
  @reactionDocs.set()
  set(@Req() request: Request, @Param('roomId') roomId: string, @Param('messageId') messageId: string) {
    const input = object(request.body, ['emoji']);
    return this.reactions.set(readCommandCredentials(request, this.config), roomId, messageId, reactionEmoji(input.emoji));
  }
  @Delete('me') @HttpCode(200)
  @reactionDocs.remove()
  remove(@Req() request: Request, @Param('roomId') roomId: string, @Param('messageId') messageId: string) {
    object(request.body ?? {}, []);
    return this.reactions.set(readCommandCredentials(request, this.config), roomId, messageId, null);
  }
}
