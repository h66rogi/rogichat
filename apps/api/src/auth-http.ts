import { createHmac } from 'node:crypto';
import { Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response, CookieOptions, Express, NextFunction } from 'express';
import type { AuthConfig } from './auth-config.js';
import { ApiError, digest, object, opaque, secret } from './auth-core.js';
import type { Sessions } from './auth-core.js';
import type { AuthFlow } from './auth-flow.js';
import { consumeRate } from './repositories.js';

export const AUTH = Symbol('AUTH');
export interface AuthRuntime { sessions: Sessions; flow: AuthFlow; config: AuthConfig }
export function cookie(request: Request, name: string): string | undefined {
  const raw = request.headers.cookie ?? '';
  if (raw.length > 8192) throw new ApiError('INVALID_REQUEST', 400);
  const matches = raw.split(';').map(p => p.trim()).filter(p => p.startsWith(`${name}=`));
  if (matches.length > 1) throw new ApiError('INVALID_REQUEST', 400);
  return matches[0]?.slice(name.length + 1);
}
export const cookieName = (config: AuthConfig, kind: 'session' | 'oauth'): string => `${config.secure ? '__Host-' : ''}rogi_${kind}`;
export const oauthCookieName = (config: AuthConfig, state: string): string => `${cookieName(config, 'oauth')}_${digest(state).toString('hex')}`;
export const sessionToken = (request: Request, config: AuthConfig): string | undefined => cookie(request, cookieName(config, 'session'));
export function csrf(request: Request, config: AuthConfig): string {
  if (request.headers.origin !== config.origin) throw new ApiError('FORBIDDEN', 403);
  return opaque(request.headers['x-csrf-token']);
}
const options = (config: AuthConfig): CookieOptions => ({ httpOnly: true, secure: config.secure, sameSite: 'lax', path: '/' });

export function authCors(server: Express, config: AuthConfig): void {
  server.use((request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (!request.path.startsWith('/v1/')) { next(); return; }
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== config.origin) { response.status(403).json({ error: { code: 'FORBIDDEN' } }); return; }
    if (origin === config.origin) {
      response.setHeader('Access-Control-Allow-Origin', config.origin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS') {
      if (!origin || !['GET', 'POST', 'PATCH', 'DELETE'].includes(String(request.headers['access-control-request-method']))) { response.sendStatus(403); return; }
      const headers = String(request.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
      if (headers.some(h => !['content-type', 'x-csrf-token'].includes(h))) { response.sendStatus(403); return; }
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
      response.status(204).end(); return;
    }
    next();
  });
}

@Controller('v1/auth')
export class AuthController {
  constructor(@Inject(AUTH) private readonly auth: AuthRuntime) {}
  private async charge(request: Request, kind: 'start' | 'callback'): Promise<void> {
    // Hosted ingress is exactly one header-overwriting Caddy hop; direct local/test ingress trusts none.
    const key = createHmac('sha256', this.auth.config.key).update(`${kind}:${request.ip ?? 'unknown'}`).digest();
    const allowed = await this.auth.sessions.transactions.write(tx => consumeRate(tx, key, kind === 'start' ? 10 : 30, 60));
    if (!allowed) throw new ApiError('RATE_LIMITED', 429);
  }
  @Get('session')
  async session(@Req() request: Request) {
    const token = sessionToken(request, this.auth.config);
    return this.auth.sessions.transactions.read(async tx => {
      const principal = await this.auth.sessions.require(tx, token);
      return { authenticated: true, soopLinkStatus: principal.soopLinked ? 'VERIFIED' : 'REQUIRED', csrfToken: this.auth.sessions.csrf(token!) };
    });
  }
  @Post('logout')
  async logout(@Req() request: Request, @Res() response: Response): Promise<void> {
    object(request.body, []);
    await this.auth.sessions.logout(sessionToken(request, this.auth.config), csrf(request, this.auth.config));
    response.clearCookie(cookieName(this.auth.config, 'session'), options(this.auth.config));
    response.status(204).end();
  }
  @Post('soop/start')
  async start(@Req() request: Request, @Res() response: Response): Promise<void> {
    if (request.headers.origin !== this.auth.config.origin || !request.is('application/json')) throw new ApiError('FORBIDDEN', 403);
    const body = object(request.body, ['intent', 'termsVersion']);
    if (body.intent !== 'login' && body.intent !== 'link') throw new ApiError('INVALID_REQUEST', 400);
    if (body.intent === 'login' && body.termsVersion !== '2026-09-20') throw new ApiError('INVALID_REQUEST', 400);
    const rawCookies = request.headers.cookie ?? '';
    if (rawCookies.length > 8192) throw new ApiError('INVALID_REQUEST', 400);
    const pending = rawCookies.split(';').map(p => p.trim()).filter(p => p.startsWith(`${cookieName(this.auth.config, 'oauth')}_`));
    if (pending.length >= 10) throw new ApiError('RATE_LIMITED', 429);
    await this.charge(request, 'start');
    const browser = secret();
    const result = await this.auth.flow.start(body.intent, browser, sessionToken(request, this.auth.config), body.intent === 'link' ? csrf(request, this.auth.config) : undefined);
    response.cookie(oauthCookieName(this.auth.config, result.state), browser, { ...options(this.auth.config), maxAge: 600000 });
    response.status(200).json({ authorizeUrl: result.url });
  }
  @Get('soop/callback')
  async callback(@Req() request: Request, @Res() response: Response): Promise<void> {
    const query = object(request.query, ['state', 'code', 'error']);
    await this.charge(request, 'callback');
    const state = opaque(query.state);
    const name = oauthCookieName(this.auth.config, state);
    const browser = opaque(cookie(request, name));
    // Clear only this transaction's binding; another tab has its own cookie.
    response.clearCookie(name, options(this.auth.config));
    if (query.error !== undefined) {
      if (query.code !== undefined || typeof query.error !== 'string' || !['PROVIDER_DENIED', 'PROVIDER_AUTH_FAILED'].includes(query.error)) throw new ApiError('INVALID_REQUEST', 400);
      await this.auth.flow.deny(state, browser);
      response.redirect(303, `${this.auth.config.origin}/auth/login?error=AUTH_FAILED`); return;
    }
    const session = await this.auth.flow.callback(state, opaque(query.code), browser, sessionToken(request, this.auth.config));
    response.cookie(cookieName(this.auth.config, 'session'), session.token, { ...options(this.auth.config), maxAge: 7 * 86400000 });
    response.redirect(303, `${this.auth.config.origin}/`);
  }
}
