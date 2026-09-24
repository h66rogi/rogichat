import type { Request } from 'express';
import { ApiError } from '../auth/auth-primitives.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import type { CommandCredentials, SessionCredentials } from '../auth/auth-context.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import type { ConsoleCredentials } from './meloming-live-session.service.js';

export function consoleCredentials(request: Request): ConsoleCredentials {
  const token = request.query.token;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new ApiError('UNAUTHENTICATED', 401);
  return { consoleToken: token };
}

export function consoleOrSession(request: Request, config: AuthConfig): ConsoleCredentials | SessionCredentials {
  return request.query.token === undefined ? readSessionCredentials(request, config) : consoleCredentials(request);
}

export function consoleOrCommand(request: Request, config: AuthConfig): ConsoleCredentials | CommandCredentials {
  return request.query.token === undefined ? readCommandCredentials(request, config) : consoleCredentials(request);
}
