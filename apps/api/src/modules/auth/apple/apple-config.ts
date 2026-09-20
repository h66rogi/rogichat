import { readFileSync, statSync } from 'node:fs';
import { createPrivateKey } from 'node:crypto';
import { ConfigurationError } from '../../../infrastructure/config/config.js';

export type AppleClient = 'ios' | 'android' | 'web';
export interface AppleConfig {
  teamId: string; keyId: string; privateKey: string;
  // Explicit developer-portal grouping, never inferred from email or client ID.
  clients: Record<AppleClient, { audience: string; scope: string }>;
  callback: string;
}
export function readAppleConfig(environment: string, env: NodeJS.ProcessEnv = process.env): AppleConfig | undefined {
  if (!env.APPLE_AUTH_SECRET_FILE) return undefined;
  try {
    const path = env.APPLE_AUTH_SECRET_FILE;
    if (!statSync(path).isFile() || statSync(path).size > 16384) throw new Error();
    const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (!value || Object.keys(value).sort().join(',') !== 'clients,keyId,privateKey,teamId') throw new Error();
    if (typeof value.teamId !== 'string' || !/^[A-Z0-9]{10}$/.test(value.teamId) || typeof value.keyId !== 'string' || !/^[A-Z0-9]{10}$/.test(value.keyId) || typeof value.privateKey !== 'string') throw new Error();
    const key = createPrivateKey(value.privateKey);
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error();
    const clients = value.clients as AppleConfig['clients'];
    if (!clients || Object.keys(clients).sort().join(',') !== 'android,ios,web') throw new Error();
    for (const client of Object.values(clients)) {
      if (!client || Object.keys(client).sort().join(',') !== 'audience,scope' || typeof client.audience !== 'string' || !/^[A-Za-z0-9.-]{3,191}$/.test(client.audience) || typeof client.scope !== 'string' || !/^[a-z0-9.-]{3,64}$/.test(client.scope)) throw new Error();
    }
    if (clients.android.audience !== clients.web.audience || clients.android.scope !== clients.web.scope) throw new Error();
    // Different client audiences may share subjects ONLY through this explicit registration.
    const api = environment === 'production' ? 'https://api.rogi.chat' : environment === 'qa' ? 'https://api.qa.rogi.chat' : null;
    if (!api) throw new Error();
    return { teamId: value.teamId, keyId: value.keyId, privateKey: value.privateKey, clients, callback: `${api}/v1/auth/apple/callback` };
  } catch { throw new ConfigurationError('APPLE_AUTH_SECRET_FILE'); }
}
