import { Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { ApiError, object, opaque, secret } from './auth-primitives.js';
import { cookie, cookieName, nativeClientId, oauthCookieName, readSessionCredentials, singleHeader } from './auth-context.js';
import type { NativeCredentials } from './auth-context.js';
import { AUTH_CONFIG } from './auth.tokens.js';
import { AuthService } from './auth.service.js';
import { NativeAuthService } from './native-auth.service.js';

// Explicit native endpoint admission: no browser cookies, CSRF, inferred web
// Origin, duplicate headers or mismatch between header and body client binding.
export function nativeAdmission(request: Request, config: AuthConfig, clientId: 'ios' | 'android'): NativeCredentials | undefined {
  if (!request.is('application/json') || singleHeader(request, 'x-rogi-client') !== clientId ||
      singleHeader(request, 'x-csrf-token') !== undefined ||
      cookie(request, 'rogi_session') !== undefined || cookie(request, '__Host-rogi_session') !== undefined) throw new ApiError('INVALID_REQUEST', 400);
  const origin = singleHeader(request, 'origin');
  if (origin !== undefined) throw new ApiError('FORBIDDEN', 403);
  if (singleHeader(request, 'authorization') === undefined) return;
  const credentials = readSessionCredentials(request, config);
  if (credentials.transport !== 'NATIVE') throw new ApiError('INVALID_REQUEST', 400);
  return credentials;
}

@Controller('v1/auth/native')
export class NativeAuthController {
  constructor(@Inject(NativeAuthService) private readonly native: NativeAuthService, @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  @Post('soop/transactions')
  async start(@Req() request: Request, @Res() response: Response) {
    const body = object(request.body, ['clientId', 'intent', 'codeChallenge', 'codeChallengeMethod', 'returnState', 'termsVersion']);
    const clientId = nativeClientId(body.clientId);
    if ((body.intent !== 'login' && body.intent !== 'link') || body.codeChallengeMethod !== 'S256' ||
        (body.intent === 'login' ? body.termsVersion !== '2026-09-20' : body.termsVersion !== undefined)) throw new ApiError('INVALID_REQUEST', 400);
    const codeChallenge = opaque(body.codeChallenge); const returnState = opaque(body.returnState);
    const credentials = nativeAdmission(request, this.config, clientId);
    await this.auth.charge('start', request.ip);
    response.status(200).json(await this.native.start({ clientId, intent: body.intent, codeChallenge, returnState }, credentials));
  }

  @Get('soop/launch')
  async launch(@Req() request: Request, @Res() response: Response) {
    const query = object(request.query, ['request']); const ticket = opaque(query.request);
    const raw = request.headers.cookie ?? '';
    if (raw.length > 8192) throw new ApiError('INVALID_REQUEST', 400);
    if (raw.split(';').map(value => value.trim()).filter(value => value.startsWith(`${cookieName(this.config, 'oauth')}_`)).length >= 10) throw new ApiError('RATE_LIMITED', 429);
    await this.auth.charge('callback', request.ip);
    const browser = secret(); const result = await this.native.launch(ticket, browser);
    response.cookie(oauthCookieName(this.config, result.state), browser, { httpOnly: true, secure: this.config.secure, sameSite: 'lax', path: '/', maxAge: 600000 });
    response.redirect(303, result.url);
  }

  @Post('completions/exchange')
  async exchange(@Req() request: Request, @Res() response: Response) {
    const body = object(request.body, ['clientId', 'transactionId', 'code', 'codeVerifier']);
    const clientId = nativeClientId(body.clientId);
    if (typeof body.transactionId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(body.transactionId) ||
        typeof body.codeVerifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(body.codeVerifier)) throw new ApiError('INVALID_REQUEST', 400);
    const code = opaque(body.code); const credentials = nativeAdmission(request, this.config, clientId);
    await this.auth.charge('callback', request.ip);
    response.status(200).json(await this.native.exchange({ clientId, transactionId: body.transactionId, code, codeVerifier: body.codeVerifier }, credentials));
  }
}
