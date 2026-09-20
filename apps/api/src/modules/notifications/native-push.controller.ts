import { Controller, Delete, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { ApiError, object } from '../auth/auth-primitives.js';
import { readSessionCredentials, singleHeader } from '../auth/auth-context.js';
import { NativePushService } from './native-push.service.js';
import { nativePushDocs } from './dto/native-push.openapi.js';

@ApiTags('Notifications')
@Controller('v1/me')
export class NativePushController {
  constructor(@Inject(NativePushService) private readonly native: NativePushService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}
  private credentials(request: Request) {
    object(request.query, []);
    if (singleHeader(request, 'origin') !== undefined || singleHeader(request, 'cookie') !== undefined ||
      singleHeader(request, 'x-csrf-token') !== undefined) throw new ApiError('INVALID_REQUEST', 400);
    if (request.method !== 'GET' && !request.is('application/json')) throw new ApiError('INVALID_REQUEST', 400);
    return readSessionCredentials(request, this.config);
  }
  @Get('native-push-capabilities') @nativePushDocs.capabilities()
  capabilities(@Req() request: Request) { return this.native.capabilities(this.credentials(request)); }
  @Post('native-push-subscriptions') @HttpCode(201) @nativePushDocs.register()
  register(@Req() request: Request) { return this.native.register(this.credentials(request), request.body); }
  @Post('native-push-subscriptions/resolve') @HttpCode(200) @nativePushDocs.resolve()
  resolve(@Req() request: Request) { return this.native.resolve(this.credentials(request), request.body); }
  @Delete('native-push-subscriptions/:id') @HttpCode(204) @nativePushDocs.remove()
  remove(@Req() request: Request, @Param('id') id: string) { return this.native.remove(this.credentials(request), id, request.body); }
}
