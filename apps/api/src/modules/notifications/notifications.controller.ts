import { Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationInboxService } from './notification-inbox.service.js';
import { ApiTags } from '@nestjs/swagger';
import { notificationsDocs } from './dto/notifications-docs.openapi.js';

@ApiTags('Notifications')
@Controller('v1/me')
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(NotificationInboxService) private readonly inbox: NotificationInboxService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}
  @Get('notifications')
  @notificationsDocs.inbox()
  inboxPage(@Req() request: Request, @Query('limit') limit: unknown, @Query('cursor') cursor: unknown) {
    return this.inbox.page(readSessionCredentials(request, this.config), limit, cursor);
  }
  @Post('notifications/:id/read') @HttpCode(204)
  @notificationsDocs.markRead()
  markRead(@Req() request: Request, @Param('id') id: string) {
    return this.inbox.markRead(readCommandCredentials(request, this.config), id);
  }
  @Get('push-capabilities')
  @notificationsDocs.capabilities()
  capabilities(@Req() request: Request) { return this.notifications.capabilities(readSessionCredentials(request, this.config)); }
  @Get('notification-preferences')
  @notificationsDocs.preferences()
  preferences(@Req() request: Request) { return this.notifications.preferences(readSessionCredentials(request, this.config)); }
  @Put('notification-preferences')
  @notificationsDocs.setPreferences()
  setPreferences(@Req() request: Request) { return this.notifications.setPreferences(readCommandCredentials(request, this.config), request.body); }
  @Post('push-subscriptions') @HttpCode(201)
  @notificationsDocs.register()
  register(@Req() request: Request) { return this.notifications.register(readCommandCredentials(request, this.config), request.body); }
  @Delete('push-subscriptions/:id') @HttpCode(204)
  @notificationsDocs.remove()
  remove(@Req() request: Request, @Param('id') id: string) { return this.notifications.remove(readCommandCredentials(request, this.config), id, request.body); }
}
