import type { IncomingMessage } from 'node:http';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { ApiError, digest, opaque } from '../../modules/auth/auth-primitives.js';

// Request-scoped values are passed explicitly, never retained on singleton services or logged.
// Guard admission is not authorization for a later command: revalidate inside its transaction.
export type NativeClientId = 'ios' | 'android';
export interface NativeCredentials { readonly transport: 'NATIVE'; readonly token: string; readonly clientId: NativeClientId; readonly csrf?: never }
export interface WebCredentials { readonly transport?: 'WEB'; readonly token?: string | undefined; readonly csrf?: string; readonly clientId?: never }
export type SessionCredentials = WebCredentials | NativeCredentials;
export type CommandCredentials = (WebCredentials & { readonly csrf: string }) | NativeCredentials;
type HeaderRequest = Pick<IncomingMessage, 'headers'> & Partial<Pick<IncomingMessage, 'rawHeaders'>>;

export function nativeClientId(value: unknown): NativeClientId {
  if (value !== 'ios' && value !== 'android') throw new ApiError('INVALID_REQUEST', 400);
  return value;
}

// Node may discard duplicate Authorization values. Inspect the raw occurrences as
// well as the normalized value; never let the HTTP parser choose a credential.
export function singleHeader(request: HeaderRequest, name: string): string | undefined {
  const values = request.rawHeaders ?? [];
  let count = 0;
  for (let index = 0; index < values.length; index += 2) if (values[index]?.toLowerCase() === name) count++;
  const value = request.headers[name];
  if (count > 1 || (value !== undefined && typeof value !== 'string')) throw new ApiError('INVALID_REQUEST', 400);
  return value;
}

export function requireCommandProof(credentials: SessionCredentials): asserts credentials is CommandCredentials {
  if (credentials.transport === 'NATIVE') {
    opaque(credentials.token); nativeClientId(credentials.clientId);
    if (credentials.csrf !== undefined) throw new ApiError('INVALID_REQUEST', 400);
  } else opaque(credentials.csrf);
}

export function cookie(request: HeaderRequest, name: string): string | undefined {
  const raw = request.headers.cookie ?? '';
  if (typeof raw !== 'string' || raw.length > 8192) throw new ApiError('INVALID_REQUEST', 400);
  const matches = raw.split(';').map(p => p.trim()).filter(p => p.startsWith(`${name}=`));
  if (matches.length > 1) throw new ApiError('INVALID_REQUEST', 400);
  return matches[0]?.slice(name.length + 1);
}
export const cookieName = (config: AuthConfig, kind: 'session' | 'oauth'): string => `${config.secure ? '__Host-' : ''}rogi_${kind}`;
export const oauthCookieName = (config: AuthConfig, state: string): string => `${cookieName(config, 'oauth')}_${digest(state).toString('hex')}`;
export const sessionToken = (request: HeaderRequest, config: AuthConfig): string | undefined => cookie(request, cookieName(config, 'session'));
export function csrf(request: HeaderRequest, config: AuthConfig): string {
  if (request.headers.origin !== config.origin) throw new ApiError('FORBIDDEN', 403);
  return opaque(singleHeader(request, 'x-csrf-token'));
}
export function readSessionCredentials(request: HeaderRequest, config: AuthConfig): Readonly<SessionCredentials> {
  const authorization = singleHeader(request, 'authorization');
  const client = singleHeader(request, 'x-rogi-client');
  const proof = singleHeader(request, 'x-csrf-token');
  if (authorization !== undefined || client !== undefined) {
    if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization) || proof !== undefined ||
        cookie(request, 'rogi_session') !== undefined || cookie(request, '__Host-rogi_session') !== undefined) throw new ApiError('INVALID_REQUEST', 400);
    return Object.freeze({ transport: 'NATIVE', token: authorization.slice(7), clientId: nativeClientId(client) });
  }
  const token = sessionToken(request, config);
  return Object.freeze(token === undefined ? {} : { token });
}
export function readCommandCredentials(request: HeaderRequest, config: AuthConfig): Readonly<CommandCredentials> {
  const credentials = readSessionCredentials(request, config);
  return credentials.transport === 'NATIVE' ? credentials : Object.freeze({ ...credentials, csrf: csrf(request, config) });
}
