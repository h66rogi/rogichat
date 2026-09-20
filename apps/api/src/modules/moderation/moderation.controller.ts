import { Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { object } from '../auth/auth-primitives.js';
import { identifier } from '../../common/validation/identifier.js';
import { ModerationService } from './moderation.service.js';
import { moderationDocs } from './moderation.openapi.js';
function after(request: Request) { const query = object(request.query, ['after']); return query.after === undefined ? '' : identifier(query.after); }
@ApiTags('Moderation')
@Controller('v1')
export class ModerationController {
  constructor(@Inject(ModerationService) private readonly service: ModerationService, @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}
  @Post('rooms/:roomId/messages/:messageId/reports') @HttpCode(200) @moderationDocs.report()
  report(@Req() req: Request, @Param('roomId') roomId: string, @Param('messageId') messageId: string) {
    return this.service.report(readCommandCredentials(req, this.config), identifier(roomId), identifier(messageId), req.body);
  }
  @Get('reports/:reportId') @moderationDocs.receipt()
  receipt(@Req() req: Request, @Param('reportId') id: string) { return this.service.receipt(readSessionCredentials(req, this.config), identifier(id)); }
  @Get('report-receipts/:idempotencyKey') @moderationDocs.receipt(true)
  receiptByKey(@Req() req: Request, @Param('idempotencyKey') id: string) { return this.service.receipt(readSessionCredentials(req, this.config), identifier(id), true); }
  @Get('blocked-rooms') @moderationDocs.blockRooms()
  blockRooms(@Req() req: Request) {
    const query = object(req.query, ['cursor']);
    return this.service.blockRooms(readSessionCredentials(req, this.config), query.cursor);
  }
  @Get('rooms/:roomId/blocks') @moderationDocs.blocks()
  blocks(@Req() req: Request, @Param('roomId') roomId: string) { return this.service.blocks(readSessionCredentials(req, this.config), identifier(roomId), after(req)); }
  @Put('rooms/:roomId/blocks/:actorId') @moderationDocs.block(true)
  block(@Req() req: Request, @Param('roomId') roomId: string, @Param('actorId') actorId: string) {
    object(req.body, []); return this.service.block(readCommandCredentials(req, this.config), identifier(roomId), identifier(actorId), true);
  }
  @Delete('rooms/:roomId/blocks/:actorId') @moderationDocs.block(false)
  unblock(@Req() req: Request, @Param('roomId') roomId: string, @Param('actorId') actorId: string) {
    object(req.body ?? {}, []); return this.service.block(readCommandCredentials(req, this.config), identifier(roomId), identifier(actorId), false);
  }
  @Get('rooms/:roomId/bans') @moderationDocs.bans()
  bans(@Req() req: Request, @Param('roomId') roomId: string) { return this.service.bans(readSessionCredentials(req, this.config), identifier(roomId), after(req)); }
  @Post('rooms/:roomId/bans/:actorId') @HttpCode(200) @moderationDocs.ban(true)
  ban(@Req() req: Request, @Param('roomId') roomId: string, @Param('actorId') actorId: string) {
    object(req.body, []); return this.service.ban(readCommandCredentials(req, this.config), identifier(roomId), identifier(actorId), true);
  }
  @Delete('rooms/:roomId/bans/:actorId') @moderationDocs.ban(false)
  unban(@Req() req: Request, @Param('roomId') roomId: string, @Param('actorId') actorId: string) {
    object(req.body ?? {}, []); return this.service.ban(readCommandCredentials(req, this.config), identifier(roomId), identifier(actorId), false);
  }
  @Get('admin/reports') @moderationDocs.review()
  review(@Req() req: Request) { return this.service.review(readSessionCredentials(req, this.config), after(req)); }
  @Post('admin/reports/:reportId/resolve') @HttpCode(200) @moderationDocs.resolve()
  resolve(@Req() req: Request, @Param('reportId') reportId: string) { return this.service.resolve(readCommandCredentials(req, this.config), identifier(reportId), req.body); }
}
