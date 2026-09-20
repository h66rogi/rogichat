import { isAbsolute, resolve } from 'node:path';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { ConfigurationError } from './config.js';
import type { AuthConfig } from './auth-config.js';

// Independent restore authorization/cache generation. The stable credential
// sealing key is never changed, so retained provider revocation tokens survive.
export function readAuthorizationEpoch(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.AUTHORIZATION_EPOCH_FILE === undefined) return undefined;
  let fd: number | undefined;
  try {
    const path = env.AUTHORIZATION_EPOCH_FILE;
    if (!path || !isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path) throw new Error();
    const before = lstatSync(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink()) throw new Error();
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const file = fstatSync(fd, { bigint: true });
    if (!file.isFile() || file.nlink !== 1n || file.size < 1n || file.size > 256n || ![0o400n, 0o600n].includes(file.mode & 0o7777n) ||
        ![0n, BigInt(process.geteuid?.() ?? -1)].includes(file.uid) || before.dev !== file.dev || before.ino !== file.ino) throw new Error();
    const bytes = Buffer.alloc(257); let length = 0, count: number;
    do { count = readSync(fd, bytes, length, bytes.length - length, null); length += count; } while (count > 0 && length < bytes.length);
    const after = fstatSync(fd, { bigint: true }), current = lstatSync(path, { bigint: true });
    const stable = ['dev', 'ino', 'size', 'mode', 'uid', 'nlink', 'mtimeNs', 'ctimeNs'] as const;
    if (stable.some(field => before[field] !== file[field] || after[field] !== file[field] || current[field] !== file[field])) throw new Error();
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length));
    const match = /^[ \t\r\n]*\{[ \t\r\n]*"authorizationEpoch"[ \t\r\n]*:[ \t\r\n]*"([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})"[ \t\r\n]*\}[ \t\r\n]*$/.exec(text);
    if (BigInt(length) !== file.size || !match) throw new Error();
    return match[1]!;
  } catch { throw new ConfigurationError('AUTHORIZATION_EPOCH_FILE'); }
  finally { if (fd !== undefined) closeSync(fd); }
}
export function authorizationKey(config: Pick<AuthConfig, 'key' | 'audience' | 'authorizationEpoch'>): Buffer {
  if (config.authorizationEpoch === undefined) return config.key;
  if (typeof config.authorizationEpoch !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(config.authorizationEpoch)) throw new ConfigurationError('AUTHORIZATION_EPOCH_FILE');
  return createHmac('sha256', config.key).update('rogichat:authorization-epoch:v1:')
    .update(config.audience).update(':').update(config.authorizationEpoch).digest();
}

export function authorizationKeyFingerprint(config: Pick<AuthConfig, 'key' | 'audience' | 'authorizationEpoch'>): string {
  return createHash('sha256').update(authorizationKey(config)).digest('hex');
}
