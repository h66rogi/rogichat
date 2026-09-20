import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { ApiError, opaque } from './auth-primitives.js';

/** Browser destination is first-party in hosted environments, independently of server transport. */
export function brokerAuthorizeUrl(config: AuthConfig, value: unknown): string {
  try {
    if (!config.broker || typeof value !== 'string') throw new Error();
    const target = new URL(value);
    const hosted = config.audience === 'rogi-qa' || config.audience === 'rogi-production';
    const origin = hosted ? 'https://auth.rogi.chat' : config.broker.baseUrl;
    if (target.origin !== origin || target.protocol !== 'https:' || target.username || target.password || target.hash ||
        target.pathname !== '/v1/platform/oauth/rogichat/authorize' || [...target.searchParams.keys()].join(',') !== 'request') throw new Error();
    opaque(target.searchParams.get('request'));
    return target.toString();
  } catch { throw new ApiError('AUTH_UNAVAILABLE', 503); }
}
