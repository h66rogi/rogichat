import { Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { object } from '../auth/auth-primitives.js';
import { PublicationsService } from './publications.service.js';

@Controller('v1/rooms/:roomId')
export class PublicationsController {
  constructor(@Inject(PublicationsService) private readonly publications: PublicationsService, @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}
  @Post('messages/:messageId/publications') @HttpCode(202)
  publish(@Req() request: Request, @Param('roomId') roomId: string, @Param('messageId') messageId: string) {
    object(request.body, []);
    return this.publications.request(readCommandCredentials(request, this.config), roomId, messageId);
  }
  @Get('publications/:publicationId')
  get(@Req() request: Request, @Param('roomId') roomId: string, @Param('publicationId') publicationId: string) {
    return this.publications.get(readSessionCredentials(request, this.config), roomId, publicationId);
  }
}
