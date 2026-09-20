import { ApiTags } from '@nestjs/swagger';
import { authDocs } from './dto/auth.openapi.js';
import { Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response, CookieOptions } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { ApiError, object, opaque, secret } from '../../modules/auth/auth-primitives.js';
import { AuthService } from './auth.service.js';
import { AUTH_CONFIG } from './auth.tokens.js';
import { NativeAuthService } from './native-auth.service.js';
import { cookie, cookieName, oauthCookieName, sessionToken, csrf, readSessionCredentials, readCommandCredentials } from './auth-context.js';

const options = (config: AuthConfig): CookieOptions => ({ httpOnly: true, secure: config.secure, sameSite: 'lax', path: '/' });

@ApiTags('Authentication')
@Controller('v1/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(NativeAuthService) private readonly native: NativeAuthService) {}

  @Get('session')
  @authDocs.session()
  session(@Req() request: Request) { return this.auth.session(readSessionCredentials(request, this.config)); }

  @Post('logout')
  @authDocs.logout()
  async logout(@Req() request: Request, @Res() response: Response): Promise<void> {
    object(request.body, []);
    const credentials = readCommandCredentials(request, this.config);
    await this.auth.logout(credentials);
    if (credentials.transport !== 'NATIVE') response.clearCookie(cookieName(this.config, 'session'), options(this.config));
    response.status(204).end();
  }

  @Post('soop/start')
  @authDocs.start()
  async start(@Req() request: Request, @Res() response: Response): Promise<void> {
    if (request.headers.origin !== this.config.origin || !request.is('application/json')) throw new ApiError('FORBIDDEN', 403);
    const body = object(request.body, ['intent', 'termsVersion']);
    if (body.intent !== 'login' && body.intent !== 'link') throw new ApiError('INVALID_REQUEST', 400);
    if (body.intent === 'login' && body.termsVersion !== '2026-09-20') throw new ApiError('INVALID_REQUEST', 400);
    const rawCookies = request.headers.cookie ?? '';
    if (rawCookies.length > 8192) throw new ApiError('INVALID_REQUEST', 400);
    const pending = rawCookies.split(';').map(p => p.trim()).filter(p => p.startsWith(`${cookieName(this.config, 'oauth')}_`));
    if (pending.length >= 10) throw new ApiError('RATE_LIMITED', 429);
    await this.auth.charge('start', request.ip);
    const browser = secret();
    const result = await this.auth.start(body.intent, browser, sessionToken(request, this.config), body.intent === 'link' ? csrf(request, this.config) : undefined);
    response.cookie(oauthCookieName(this.config, result.state), browser, { ...options(this.config), maxAge: 600000 });
    response.status(200).json({ authorizeUrl: result.url });
  }

  @Get('soop/callback')
  @authDocs.callback()
  async callback(@Req() request: Request, @Res() response: Response): Promise<void> {
    const query = object(request.query, ['state', 'code', 'error']);
    await this.auth.charge('callback', request.ip);
    const state = opaque(query.state);
    const name = oauthCookieName(this.config, state);
    const browser = opaque(cookie(request, name));
    if (await this.native.handles(state)) {
      if (query.error !== undefined && (query.code !== undefined || typeof query.error !== 'string' || !['PROVIDER_DENIED', 'PROVIDER_AUTH_FAILED'].includes(query.error))) throw new ApiError('INVALID_REQUEST', 400);
      const location = await this.native.callback(state, browser, query.error === undefined ? opaque(query.code) : undefined);
      response.clearCookie(name, options(this.config));
      response.redirect(303, location); return;
    }
    // Clear only this transaction's binding; another tab has its own cookie.
    response.clearCookie(name, options(this.config));
    if (query.error !== undefined) {
      if (query.code !== undefined || typeof query.error !== 'string' || !['PROVIDER_DENIED', 'PROVIDER_AUTH_FAILED'].includes(query.error)) throw new ApiError('INVALID_REQUEST', 400);
      await this.auth.deny(state, browser);
      response.redirect(303, `${this.config.origin}/auth/login?error=AUTH_FAILED`); return;
    }
    const session = await this.auth.callback(state, opaque(query.code), browser, sessionToken(request, this.config));
    response.cookie(cookieName(this.config, 'session'), session.token, { ...options(this.config), maxAge: 7 * 86400000 });
    response.redirect(303, `${this.config.origin}/`);
  }
}
