import { createPrivateKey } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export interface NativePushConfig {
  audience: string;
  encryptionKey: Buffer;
  apns?: { teamId: string; keyId: string; key: KeyObject; topic: string; sandbox: boolean };
  fcm?: { projectId: string; email: string; key: KeyObject; applicationId: string };
}
const fields = new Set(['environment', 'encryptionKey', 'apnsTeamId', 'apnsKeyId', 'apnsPrivateKey', 'apnsTopic', 'apnsEnvironment',
  'fcmProjectId', 'fcmClientEmail', 'fcmPrivateKey', 'fcmApplicationId']);

// Flat string-only JSON rejects duplicate/escaped keys instead of silently
// choosing one credential. The API and worker read the same protected file.
export function parseNativePushConfig(bytes: Buffer, environment: string): NativePushConfig {
  try {
    if (!['local', 'test', 'qa', 'production'].includes(environment) || bytes.length > 16384) throw new Error();
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const data: Record<string, string> = Object.create(null) as Record<string, string>;
    const member = /\s*"([A-Za-z]+)"\s*:\s*("(?:[^"\\]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*")\s*/y;
    let offset = 0;
    const space = () => { while (/[\x20\t\r\n]/.test(text[offset] ?? '') && offset < text.length) offset++; };
    space(); if (text[offset++] !== '{') throw new Error();
    for (;;) {
      member.lastIndex = offset; const match = member.exec(text);
      if (!match || !fields.has(match[1]!) || Object.hasOwn(data, match[1]!)) throw new Error();
      data[match[1]!] = JSON.parse(match[2]!) as string; offset = member.lastIndex;
      if (text[offset] === '}') { offset++; break; }
      if (text[offset++] !== ',') throw new Error();
    }
    space(); if (offset !== text.length) throw new Error(); JSON.parse(text);
    if (data.environment !== environment || !/^[a-f0-9]{64}$/.test(data.encryptionKey ?? '')) throw new Error();
    const config: NativePushConfig = { audience: `rogi-${environment}`, encryptionKey: Buffer.from(data.encryptionKey!, 'hex') };
    if (Object.keys(data).some(key => key.startsWith('apns'))) {
      if (!/^[A-Z0-9]{10}$/.test(data.apnsTeamId ?? '') || !/^[A-Z0-9]{10}$/.test(data.apnsKeyId ?? '') ||
        !/^[A-Za-z0-9][A-Za-z0-9.-]{2,254}$/.test(data.apnsTopic ?? '') || !['sandbox', 'production'].includes(data.apnsEnvironment ?? '')) throw new Error();
      const key = createPrivateKey(data.apnsPrivateKey ?? '');
      if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error();
      config.apns = { teamId: data.apnsTeamId!, keyId: data.apnsKeyId!, topic: data.apnsTopic!, sandbox: data.apnsEnvironment === 'sandbox', key };
    }
    if (Object.keys(data).some(key => key.startsWith('fcm'))) {
      if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(data.fcmProjectId ?? '') ||
        !/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.iam\.gserviceaccount\.com$/.test(data.fcmClientEmail ?? '') ||
        !data.fcmClientEmail?.endsWith(`@${data.fcmProjectId}.iam.gserviceaccount.com`) ||
        !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*){1,15}$/.test(data.fcmApplicationId ?? '')) throw new Error();
      const key = createPrivateKey(data.fcmPrivateKey ?? '');
      if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error();
      config.fcm = { projectId: data.fcmProjectId!, email: data.fcmClientEmail!, applicationId: data.fcmApplicationId!, key };
    }
    if (!config.apns && !config.fcm) throw new Error();
    return config;
  } catch { throw new Error('invalid_native_push_config'); }
}

export function readNativePushConfig(env: NodeJS.ProcessEnv = process.env): NativePushConfig | undefined {
  const path = env.PUSH_NATIVE_SECRET_FILE;
  if (path === undefined) return undefined;
  try {
    if (!isAbsolute(path) || realpathSync(path) !== resolve(path)) throw new Error();
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = fstatSync(fd);
      if (!before.isFile() || before.nlink !== 1 || ![0, process.geteuid?.()].includes(before.uid) ||
        ![0o400, 0o600].includes(before.mode & 0o7777) || before.size < 1 || before.size > 16384) throw new Error();
      const bytes = Buffer.alloc(16385); let length = 0;
      while (length < bytes.length) { const n = readSync(fd, bytes, length, bytes.length - length, null); if (!n) break; length += n; }
      const after = fstatSync(fd);
      if (length !== before.size || after.size !== before.size || after.mode !== before.mode || after.uid !== before.uid ||
        after.nlink !== 1 || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error();
      return parseNativePushConfig(bytes.subarray(0, length), env.APP_ENV ?? '');
    } finally { closeSync(fd); }
  } catch { throw new Error('invalid_native_push_config'); }
}
