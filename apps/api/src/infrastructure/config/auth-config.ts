import { readAppleConfig } from '../../modules/auth/apple/apple-config.js';
import type { AppleConfig } from '../../modules/auth/apple/apple-config.js';
import { readFileSync, statSync } from 'node:fs';
import { ConfigurationError } from './config.js';
import type { Config } from './config.js';

export interface AuthConfig {
  readonly apple?: AppleConfig;
  readonly audience: string;
  readonly origin: string;
  readonly callback: string;
  readonly secure: boolean;
  readonly key: Buffer;
  readonly identityGuardKey?: Buffer;
  readonly broker: { baseUrl: string; clientId: string; clientSecret: string } | undefined;
}
export function readAuthConfig(config: Config, env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const hosted = config.environment === 'qa' || config.environment === 'production';
  const origin = config.environment === 'production' ? 'https://rogi.chat' : config.environment === 'qa' ? 'https://qa.rogi.chat' : 'http://localhost:3001';
  const callback = config.environment === 'production' ? 'https://api.rogi.chat/v1/auth/soop/callback' : config.environment === 'qa' ? 'https://api.qa.rogi.chat/v1/auth/soop/callback' : 'http://127.0.0.1:3000/v1/auth/soop/callback';
  try {
    if (!env.AUTH_SECRET_FILE || !statSync(env.AUTH_SECRET_FILE).isFile() || statSync(env.AUTH_SECRET_FILE).size > 8192) throw new Error();
    const data: unknown = JSON.parse(readFileSync(env.AUTH_SECRET_FILE, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    const record = data as Record<string, unknown>;
    if (Object.keys(record).some(k => !['key', 'broker', 'identityGuardKey'].includes(k)) || typeof record.key !== 'string' || !/^[a-f0-9]{64}$/.test(record.key)) throw new Error();
    if (record.identityGuardKey !== undefined && (typeof record.identityGuardKey !== 'string' || !/^[a-f0-9]{64}$/.test(record.identityGuardKey) || record.identityGuardKey === record.key)) throw new Error();
    let broker: AuthConfig['broker'];
    if (record.broker !== undefined) {
      if (!record.broker || typeof record.broker !== 'object' || Array.isArray(record.broker)) throw new Error();
      const b = record.broker as Record<string, unknown>;
      if (Object.keys(b).sort().join(',') !== 'baseUrl,clientId,clientSecret' || typeof b.baseUrl !== 'string' || typeof b.clientId !== 'string' || !/^[a-z0-9_-]{4,64}$/.test(b.clientId) || typeof b.clientSecret !== 'string' || !/^[!-~]{32,256}$/.test(b.clientSecret)) throw new Error();
      const url = new URL(b.baseUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
      broker = { baseUrl: url.origin, clientId: b.clientId, clientSecret: b.clientSecret };
    }
    const apple = readAppleConfig(config.environment, env);
    if (apple && typeof record.identityGuardKey !== 'string') throw new Error();
    return Object.freeze({ ...(apple ? { apple } : {}), audience: `rogi-${config.environment}`, origin, callback, secure: hosted, key: Buffer.from(record.key, 'hex'), ...(typeof record.identityGuardKey === 'string' ? { identityGuardKey: Buffer.from(record.identityGuardKey, 'hex') } : {}), broker });
  } catch { throw new ConfigurationError('AUTH_SECRET_FILE'); }
}
