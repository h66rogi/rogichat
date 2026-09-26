import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Inject, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readSessionCredentials } from '../auth/auth-context.js';
import { object } from '../auth/auth-primitives.js';
import { MessageSearchService } from './message-search.service.js';
import { messageDocs } from './dto/message.openapi.js';

@ApiTags('Messages')
@Controller('v1/me/messages')
export class MessageSearchController {
  constructor(@Inject(MessageSearchService) private readonly search: MessageSearchService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}
  @Get('search')
  @messageDocs.search()
  results(@Req() request: Request) {
    const query = object(request.query, ['q', 'cursor']);
    return this.search.search(readSessionCredentials(request, this.config), query.q, query.cursor);
  }
}
