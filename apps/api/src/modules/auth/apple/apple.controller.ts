import { nativeAdmission } from '../native-auth.controller.js';
import { Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthConfig } from '../../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth.tokens.js';
import { AuthService } from '../auth.service.js';
import { AppleService } from './apple.service.js';
import { AppleLifecycleService } from './apple-lifecycle.service.js';
import { appleStart, appleNativeComplete, appleExchange } from './apple.dto.js';
import type { AppleClient } from './apple-config.js';
import { ApiError, object, opaque } from '../auth-primitives.js';
import { cookieName, readCommandCredentials, readSessionCredentials } from '../auth-context.js';
import { ApiTags } from '@nestjs/swagger';
import { appleDocs } from './apple.openapi.js';

@ApiTags('Authentication')
@Controller('v1/auth/apple')
export class AppleController {
  constructor(@Inject(AppleService) private readonly apple: AppleService,
    @Inject(AppleLifecycleService) private readonly lifecycle: AppleLifecycleService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}
  private credentials(request: Request, client: AppleClient) {
    if (client !== 'web') return nativeAdmission(request, this.config, client);
    if (!request.is('application/json')) throw new ApiError('INVALID_REQUEST', 400);
    if (client === 'web' && request.headers.origin !== this.config.origin) throw new ApiError('FORBIDDEN', 403);
    const credentials = readSessionCredentials(request, this.config);
    if (!credentials.token) return undefined;
    return readCommandCredentials(request, this.config);
  }
  @Post('start')
  @HttpCode(200)
  @appleDocs.start()
  async start(@Req() request: Request) {
    const input = appleStart(request.body); const credentials = this.credentials(request, input.clientId);
    await this.auth.charge('start', request.ip);
    return this.apple.start(input, credentials);
  }
  @Post('native/complete')
  @HttpCode(200)
  @appleDocs.nativeComplete()
  async complete(@Req() request: Request) {
    const input = appleNativeComplete(request.body); const credentials = this.credentials(request, 'ios');
    await this.auth.charge('callback', request.ip);
    return this.apple.nativeComplete(input, credentials);
  }
  @Post('callback')
  @appleDocs.callback()
  async callback(@Req() request: Request, @Res() response: Response) {
    if (!request.is('application/x-www-form-urlencoded')) throw new ApiError('INVALID_REQUEST', 400);
    const body = object(request.body, ['state', 'code', 'error', 'user']);
    if (body.error !== undefined && (body.code !== undefined || body.error !== 'user_cancelled_authorize')) throw new ApiError('AUTH_FAILED', 400);
    if (body.error === undefined && (typeof body.code !== 'string' || !body.code.length || body.code.length > 4096)) throw new ApiError('AUTH_FAILED', 400);
    await this.auth.charge('callback', request.ip);
    response.redirect(303, await this.apple.callback(opaque(body.state), body.error === undefined ? body.code as string : undefined));
  }
  @Post('exchange')
  @appleDocs.exchange()
  async exchange(@Req() request: Request, @Res() response: Response) {
    const input = appleExchange(request.body); const credentials = this.credentials(request, input.clientId);
    await this.auth.charge('callback', request.ip);
    const result = await this.apple.exchange(input, credentials);
    if (result.transport === 'NATIVE') {
      response.status(200).json({ tokenType: result.tokenType, accessToken: result.accessToken, expiresAt: result.expiresAt, session: result.session });
    } else {
      response.cookie(cookieName(this.config, 'session'), result.token, { httpOnly: true, secure: this.config.secure, sameSite: 'lax', path: '/', maxAge: 7 * 86400000 });
      response.status(200).json(await this.auth.session({ token: result.token }));
    }
  }
  @Post('notifications')
  @appleDocs.notifications()
  async notifications(@Req() request: Request, @Res() response: Response) {
    const body = object(request.body, ['payload']);
    if (!request.is('application/json') || typeof body.payload !== 'string' || body.payload.length > 16384) throw new ApiError('INVALID_REQUEST', 400);
    await this.auth.charge('callback', request.ip);
    await this.lifecycle.notification(body.payload);
    response.status(204).end();
  }
}
