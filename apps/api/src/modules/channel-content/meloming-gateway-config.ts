import { readFileSync, statSync } from 'node:fs';
import { ConfigurationError } from '../../infrastructure/config/config.js';

export interface MelomingGatewayConfig {
  readonly baseUrl: string;
  readonly signSecret: string;
  readonly callbackSecret: string;
  readonly ttlSeconds: number;
}

export function readMelomingGatewayConfig(): MelomingGatewayConfig | null {
  const path = process.env.MEDIA_GATEWAY_CONFIG_FILE;
  if (!path) return null;
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > 4096) throw new Error();
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const record = value as Record<string, unknown>;
    if (Object.keys(record).sort().join(',') !== 'baseUrl,callbackSecret,signSecret,ttlSeconds' ||
        record.baseUrl !== 'https://api.qa.rogi.chat' ||
        typeof record.signSecret !== 'string' || !/^[a-f0-9]{64}$/.test(record.signSecret) ||
        typeof record.callbackSecret !== 'string' || !/^[a-f0-9]{64}$/.test(record.callbackSecret) ||
        typeof record.ttlSeconds !== 'number' || !Number.isInteger(record.ttlSeconds) ||
        record.ttlSeconds < 60 || record.ttlSeconds > 3600) throw new Error();
    return record as unknown as MelomingGatewayConfig;
  } catch { throw new ConfigurationError('MEDIA_GATEWAY_CONFIG_FILE'); }
}
