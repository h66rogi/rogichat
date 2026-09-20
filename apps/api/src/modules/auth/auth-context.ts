import type { Request } from 'express';
import type { AuthConfig } from '../../auth-config.js';
import { ApiError, digest, opaque } from '../../auth-core.js';

// Request-scoped values are passed explicitly, never retained on singleton services or logged.
// Guard admission is not authorization for a later command: revalidate inside its transaction.
export interface SessionCredentials { readonly token?: string; readonly csrf?: string }
export interface CommandCredentials extends SessionCredentials { readonly csrf: string }

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
export function readSessionCredentials(request: Request, config: AuthConfig): Readonly<SessionCredentials> {
  const token = sessionToken(request, config);
  return Object.freeze(token === undefined ? {} : { token });
}
export function readCommandCredentials(request: Request, config: AuthConfig): Readonly<CommandCredentials> {
  return Object.freeze({ ...readSessionCredentials(request, config), csrf: csrf(request, config) });
}
