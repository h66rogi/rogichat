import { Controller, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuthConfig } from '../../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth.tokens.js';
import { AuthService } from '../auth.service.js';
import { ApiError } from '../auth-primitives.js';
import { nativeAdmission } from '../native-auth.controller.js';
import { cookieName, readCommandCredentials, readSessionCredentials, sessionCookieOptions } from '../auth-context.js';
import { PasswordService } from './password.service.js';
import { passwordLogin, passwordChange } from './password.dto.js';
import { passwordDocs } from './password.openapi.js';

@ApiTags('Authentication')
@Controller('v1/auth/password')
export class PasswordController {
  constructor(@Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AuthService) private readonly auth: AuthService, @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}
  private async admission(request: Request, client: 'web' | 'ios' | 'android', login = false) {
    if (client !== 'web') return nativeAdmission(request, this.config, client);
    if (!request.is('application/json')) throw new ApiError('INVALID_REQUEST', 400);
    if (request.headers.origin !== this.config.origin) throw new ApiError('FORBIDDEN', 403);
    const credentials = readSessionCredentials(request, this.config);
    if (credentials.transport === 'NATIVE') throw new ApiError('INVALID_REQUEST', 400);
    if (login && credentials.token) {
      // An expired HttpOnly cookie cannot be removed by the web application.
      // Only a confirmed invalid session is ignored; DB failures fail closed.
      try { await this.auth.session(credentials); }
      catch (error) { if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') return undefined; throw error; }
    }
    return credentials.token ? readCommandCredentials(request, this.config) : undefined;
  }
  private async respond(response: Response, result: Awaited<ReturnType<PasswordService['login']>>) {
    if (result.transport === 'NATIVE') response.status(200).json({ tokenType: result.tokenType, accessToken: result.accessToken, expiresAt: result.expiresAt, session: result.session });
    else {
      if (this.config.sessionCookieDomain) response.clearCookie('__Host-rogi_session', { httpOnly: true, secure: this.config.secure, sameSite: 'lax', path: '/' });
      response.cookie(cookieName(this.config, 'session'), result.token, { ...sessionCookieOptions(this.config), maxAge: 7 * 86400000 });
      response.status(200).json(await this.auth.session({ token: result.token }));
    }
  }
  @Post('login')
  @passwordDocs.login()
  async login(@Req() request: Request, @Res() response: Response) {
    const input = passwordLogin(request.body); const credentials = await this.admission(request, input.clientId, true);
    await this.auth.charge('start', request.ip);
    await this.respond(response, await this.passwords.login(input, credentials));
  }
  @Post('change')
  @passwordDocs.change()
  async change(@Req() request: Request, @Res() response: Response) {
    const input = passwordChange(request.body); const credentials = await this.admission(request, input.clientId);
    if (!credentials) throw new ApiError('UNAUTHENTICATED', 401);
    await this.auth.charge('start', request.ip);
    await this.respond(response, await this.passwords.change(input, credentials));
  }
}
