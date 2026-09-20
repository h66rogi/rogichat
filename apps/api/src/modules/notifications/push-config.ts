import { createECDH } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { readNativePushConfig } from './native-push-config.js';
import type { NativePushConfig } from './native-push-config.js';

export interface PushConfig { audience: string; vapid: { subject: string; publicKey: string; privateKey: string } | null; native?: NativePushConfig }
const fields = ['environment', 'subject', 'publicKey', 'privateKey'];
const maximumBytes = 4096;

// This deliberately narrow JSON grammar admits only a flat string-valued object.
// Keys must be literal ASCII names: JSON.parse alone loses duplicate-key evidence.
function parseSecret(bytes: Buffer): Record<string, string> {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const member = /\s*"([A-Za-z]+)"\s*:\s*("(?:[^"\\]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*")\s*/y;
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  let offset = 0;
  const whitespace = () => { while (/[\x20\t\r\n]/.test(text[offset] ?? '') && offset < text.length) offset++; };
  whitespace(); if (text[offset++] !== '{') throw new Error();
  for (;;) {
    member.lastIndex = offset;
    const match = member.exec(text);
    if (!match || !fields.includes(match[1]!) || Object.hasOwn(result, match[1]!)) throw new Error();
    result[match[1]!] = JSON.parse(match[2]!) as string;
    offset = member.lastIndex;
    if (text[offset] === '}') { offset++; break; }
    if (text[offset++] !== ',') throw new Error();
  }
  whitespace();
  if (offset !== text.length || Object.keys(result).length !== fields.length) throw new Error();
  // Enforce JSON whitespace too (the member regex intentionally parses strings).
  JSON.parse(text);
  return result;
}

function readSecret(path: string): Record<string, string> {
  if (!isAbsolute(path) || realpathSync(path) !== resolve(path)) throw new Error();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || ![0, process.geteuid?.()].includes(before.uid) ||
        ![0o400, 0o600].includes(before.mode & 0o7777) || before.size < 1 || before.size > maximumBytes) throw new Error();
    const buffer = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    const after = fstatSync(fd);
    if (length !== before.size || length > maximumBytes || after.nlink !== 1 || after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.mode !== before.mode || after.uid !== before.uid) throw new Error();
    return parseSecret(buffer.subarray(0, length));
  } finally { closeSync(fd); }
}

export function readPushConfig(env: NodeJS.ProcessEnv = process.env): PushConfig {
  const environment = env.APP_ENV;
  if (!['local', 'test', 'qa', 'production'].includes(environment ?? '')) throw new Error('invalid_push_environment');
  const audience = `rogi-${environment}`;
  const native = readNativePushConfig(env);
  const nativeConfig = native ? { native } : {};
  const prefix = `PUSH_${environment!.toUpperCase()}_`;
  const inline = ['VAPID_SUBJECT', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'].map(key => env[prefix + key]);
  try {
    const file = env.PUSH_VAPID_SECRET_FILE;
    const hosted = environment === 'qa' || environment === 'production';
    if ((hosted || file !== undefined) && inline.some(value => value !== undefined)) throw new Error();
    if (['PUSH_VAPID_SUBJECT', 'PUSH_VAPID_PUBLIC_KEY', 'PUSH_VAPID_PRIVATE_KEY'].some(key => env[key] !== undefined)) throw new Error();
    if (file === undefined && inline.every(value => value === undefined)) return { audience, vapid: null, ...nativeConfig };
    let [subject, publicKey, privateKey] = inline;
    if (file !== undefined) {
      const secret = readSecret(file);
      if (secret.environment !== environment) throw new Error();
      ({ subject, publicKey, privateKey } = secret);
    }
    if (!subject || !publicKey || !privateKey || !/^[A-Za-z0-9_-]{87}$/.test(publicKey) || !/^[A-Za-z0-9_-]{43}$/.test(privateKey)) throw new Error();
    const url = new URL(subject);
    if (!['mailto:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || /\s/.test(subject) || (url.protocol === 'mailto:' && !/^[^\s@]+@[^\s@]+$/.test(url.pathname))) throw new Error();
    const privateBytes = Buffer.from(privateKey, 'base64url');
    if (privateBytes.length !== 32 || privateBytes.toString('base64url') !== privateKey) throw new Error();
    const key = createECDH('prime256v1'); key.setPrivateKey(privateBytes);
    if (key.getPublicKey().toString('base64url') !== publicKey) throw new Error();
    return { audience, vapid: { subject, publicKey, privateKey }, ...nativeConfig };
  } catch { throw new Error('invalid_push_vapid'); }
}
