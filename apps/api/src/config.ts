import { isIP } from 'node:net';
import { url as inspectorUrl } from 'node:inspector';
import { readFileSync, statSync } from 'node:fs';

export type Role = 'api' | 'worker';
export interface Config {
  readonly role: Role;
  readonly environment: 'local' | 'test' | 'qa' | 'production';
  readonly host: string;
  readonly port: number;
  readonly database: {
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly password: string;
    readonly name: string;
    readonly tls: boolean;
    readonly caFile: string | undefined;
    readonly poolSize: number;
  };
}

export class ConfigurationError extends Error {
  constructor(readonly field: string) {
    // Never include the supplied value or a URL parser's error/cause.
    super(`Invalid configuration: ${field}`);
  }
}

function integer(value: string | undefined, fallback: number, field: string, max = 65535): number {
  if (value === undefined) return fallback;
  if (!/^[0-9]+$/.test(value)) throw new ConfigurationError(field);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1 || result > max) throw new ConfigurationError(field);
  return result;
}

function databaseLocation(env: NodeJS.ProcessEnv, hosted: boolean): URL {
  if (env.DATABASE_URL && env.DATABASE_SECRET_FILE) throw new ConfigurationError('DATABASE_SOURCE');
  if (hosted && !env.DATABASE_SECRET_FILE) throw new ConfigurationError('DATABASE_SECRET_FILE');
  const field = env.DATABASE_SECRET_FILE ? 'DATABASE_SECRET_FILE' : 'DATABASE_URL';
  try {
    let input = env.DATABASE_URL ?? '';
    if (env.DATABASE_SECRET_FILE) {
      const file = statSync(env.DATABASE_SECRET_FILE);
      if (!file.isFile() || file.size > 16384) throw new Error();
      const data: unknown = JSON.parse(readFileSync(env.DATABASE_SECRET_FILE, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
      const record = data as Record<string, unknown>;
      if (Object.keys(record).sort().join(',') !== 'database,host,password,port,username' ||
          typeof record.host !== 'string' || !/^[a-zA-Z0-9.-]+$/.test(record.host) ||
          typeof record.database !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(record.database) ||
          typeof record.username !== 'string' || !record.username ||
          typeof record.password !== 'string' || !record.password ||
          typeof record.port !== 'number' || !Number.isInteger(record.port) || record.port < 1 || record.port > 65535) throw new Error();
      input = `mysql://${encodeURIComponent(record.username)}:${encodeURIComponent(record.password)}@${record.host}:${record.port}/${record.database}`;
    }
    const url = new URL(input);
    if (url.protocol !== 'mysql:' || !url.hostname || !url.username || !url.password || url.search || url.hash ||
        !/^\/[a-z][a-z0-9_]{0,63}$/.test(url.pathname)) throw new Error();
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
    return url;
  } catch { throw new ConfigurationError(field); }
}

export function readConfig(role: Role, env: NodeJS.ProcessEnv = process.env, args = process.execArgv): Config {
  const environment = env.APP_ENV;
  if (!['local', 'test', 'qa', 'production'].includes(environment ?? '')) throw new ConfigurationError('APP_ENV');
  const hosted = environment === 'qa' || environment === 'production';
  if (!['development', 'test', 'production'].includes(env.NODE_ENV ?? '') ||
      (hosted && env.NODE_ENV !== 'production') || (environment === 'test' && env.NODE_ENV !== 'test')) {
    throw new ConfigurationError('NODE_ENV');
  }
  // --inspect-port/--inspect-publish-uid configure an inspector but do not enable it.
  // Node's test runner forwards those defaults even when no inspector is running.
  if (inspectorUrl() || /(?:^|[\s"'])--(?:inspect(?:-brk|-wait)?|debug(?:-brk)?|insecure-http-parser)(?:=|[\s"']|$)/.test(`${args.join(' ')} ${env.NODE_OPTIONS ?? ''}`)) {
    throw new ConfigurationError('NODE_OPTIONS');
  }
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new ConfigurationError('NODE_TLS_REJECT_UNAUTHORIZED');
  const url = databaseLocation(env, hosted);
  const tlsMode = env.DB_TLS_MODE ?? 'required';
  if (!['required', 'disabled'].includes(tlsMode) || (hosted && tlsMode !== 'required')) {
    throw new ConfigurationError('DB_TLS_MODE');
  }
  if (tlsMode === 'disabled' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new ConfigurationError('DB_TLS_MODE');
  }
  if (hosted && !env.DB_CA_FILE) throw new ConfigurationError('DB_CA_FILE');
  const host = env.HOST ?? '127.0.0.1';
  if (!isIP(host)) throw new ConfigurationError('HOST');
  return Object.freeze({
    role,
    environment: environment as Config['environment'],
    host,
    port: integer(env.PORT, 3000, 'PORT'),
    database: Object.freeze({
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: integer(url.port || undefined, 3306, 'DATABASE_URL'),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      name: url.pathname.slice(1),
      tls: tlsMode === 'required',
      caFile: env.DB_CA_FILE || undefined,
      poolSize: integer(env.DB_POOL_SIZE, role === 'api' ? 5 : 2, 'DB_POOL_SIZE', 10),
    }),
  });
}
