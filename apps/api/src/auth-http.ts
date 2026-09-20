import type { Request, Response, Express, NextFunction } from 'express';
import type { AuthConfig } from './auth-config.js';
import type { Sessions } from './auth-core.js';
import type { AuthFlow } from './auth-flow.js';

// Temporary R1 compatibility for domain controllers. AuthController itself is module-owned.
export const AUTH = Symbol('AUTH');
export interface AuthRuntime { sessions: Sessions; flow: AuthFlow; config: AuthConfig }
export { cookie, cookieName, oauthCookieName, sessionToken, csrf } from './modules/auth/auth-context.js';
export { AuthController } from './modules/auth/auth.controller.js';

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
      if (!origin || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(request.headers['access-control-request-method']))) { response.sendStatus(403); return; }
      const headers = String(request.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
      if (headers.some(h => !['content-type', 'x-csrf-token'].includes(h))) { response.sendStatus(403); return; }
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
      response.status(204).end(); return;
    }
    next();
  });
}
