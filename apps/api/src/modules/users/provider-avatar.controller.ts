import { Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { readCommandCredentials } from '../auth/auth-context.js';
import { identifier } from '../../common/validation/identifier.js';
import { contract, integer, object, text } from '../../common/openapi/schema.js';
import { ProviderAvatarService } from './provider-avatar.service.js';
import { object as inputObject } from '../auth/auth-primitives.js';
const accessResult = object({ url: text, expiresIn: { ...integer, enum: [60] } });
@ApiTags('Profiles')
@Controller('v1')
export class ProviderAvatarController {
  constructor(@Inject(ProviderAvatarService) private readonly avatars: ProviderAvatarService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}
  @Post('me/provider-avatar/access') @HttpCode(200)
  @contract({ id: 'accessSelfProviderAvatar', summary: 'SOOP 기본 프로필 사진 조회권 발급', auth: 'write', response: accessResult })
  self(@Req() request: Request) { inputObject(request.body ?? {}, []); return this.avatars.access(readCommandCredentials(request, this.config)); }
  @Post('rooms/:roomId/actors/:actorId/provider-avatar/access') @HttpCode(200)
  @contract({ id: 'accessActorProviderAvatar', summary: '현재 보이는 참여자 기본 사진 조회권 발급', auth: 'write', params: ['roomId', 'actorId'], response: accessResult })
  actor(@Req() request: Request, @Param('roomId') roomId: string, @Param('actorId') actorId: string) {
    inputObject(request.body ?? {}, []);
    return this.avatars.access(readCommandCredentials(request, this.config), identifier(roomId), identifier(actorId));
  }
  @Get('profile-images')
  @contract({ id: 'readProviderAvatar', summary: '60초 조회권으로 기본 프로필 사진 읽기', auth: 'none', query: [{ name: 'ticket', required: true, schema: text }], response: { type: 'string', format: 'binary' } })
  async image(@Query('ticket') ticket: unknown, @Res() response: Response) {
    const result = await this.avatars.image(ticket);
    response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    response.type(result.contentType).send(result.bytes);
  }
}
