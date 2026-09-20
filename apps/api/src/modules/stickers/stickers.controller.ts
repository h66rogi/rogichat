import { ApiTags } from '@nestjs/swagger';
import { stickerDocs } from './dto/sticker.openapi.js';
import { Controller, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { identifier } from '../../common/validation/identifier.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { object } from '../auth/auth-primitives.js';
import { StickersService } from './stickers.service.js';

@ApiTags('Stickers')
@Controller('v1')
export class StickersController {
  constructor(@Inject(StickersService) private readonly stickers: StickersService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  @Get('rooms/:roomId/stickers')
  @stickerDocs.list()
  list(@Req() request: Request, @Param('roomId') roomId: string) {
    const query = object(request.query, ['after']);
    return this.stickers.list(readSessionCredentials(request, this.config), identifier(roomId), query.after === undefined ? undefined : identifier(query.after));
  }
  @Post('admin/stickers') @HttpCode(201)
  @stickerDocs.register()
  register(@Req() request: Request) {
    object(request.query, []);
    return this.stickers.register(readCommandCredentials(request, this.config), object(request.body, ['assetId', 'label']));
  }
  @Patch('admin/stickers/:stickerId')
  @stickerDocs.changeState()
  changeState(@Req() request: Request, @Param('stickerId') stickerId: string) {
    object(request.query, []);
    return this.stickers.changeState(readCommandCredentials(request, this.config), identifier(stickerId), object(request.body, ['status']));
  }
}
