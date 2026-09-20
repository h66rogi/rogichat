import { Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { ApiError, object } from '../auth/auth-primitives.js';
import { MediaService } from './media.service.js';

@Controller('v1/media')
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService, @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}
  @Post('upload-intents') @HttpCode(201)
  intent(@Req() request: Request) {
    return this.media.intent(readCommandCredentials(request, this.config), object(request.body, ['roomId', 'kind', 'contentType', 'byteLength']));
  }
  @Get('upload-intents/:assetId')
  status(@Req() request: Request, @Param('assetId') assetId: string) {
    return this.media.status(readSessionCredentials(request, this.config), assetId);
  }
  @Post('upload-intents/:assetId/content') @HttpCode(202)
  upload(@Req() request: Request, @Param('assetId') assetId: string) {
    if (request.headers['content-type'] !== 'application/octet-stream' || request.headers['content-encoding'] || Object.keys(request.query).length) throw new ApiError('INVALID_REQUEST', 400);
    return this.media.upload(readCommandCredentials(request, this.config), assetId, request, request.headers['content-length']);
  }
  @Post('assets/:assetId/access') @HttpCode(200)
  access(@Req() request: Request, @Param('assetId') assetId: string) {
    return this.media.access(readCommandCredentials(request, this.config), assetId, object(request.body, ['roomId', 'messageId', 'variant']));
  }
}
