import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
export interface DefaultRoomConfig { expectedSubject?: string; roomId?: string }
// Stable product catalog seed. It grants no authorization; ownership requires
// exact verified provider identity supplied through protected configuration.
export const DEFAULT_ROOM_ID = 'bdcc3129-e4a8-49ec-9491-ce9ca62cb5d3';
export function readDefaultRoomConfig(env: NodeJS.ProcessEnv = process.env): DefaultRoomConfig {
  const path = env.DEFAULT_ROOM_SECRET_FILE;
  if (!path) return {};
  let fd: number | undefined;
  try {
  if (!isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path) throw new Error();
  const before = lstatSync(path, { bigint: true });
  fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const stat = fstatSync(fd, { bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n || stat.size < 1n || stat.size > 2048n || ![0o400n, 0o600n].includes(stat.mode & 0o7777n) ||
    ![0n, BigInt(process.geteuid?.() ?? -1)].includes(stat.uid) || before.dev !== stat.dev || before.ino !== stat.ino) throw new Error();
  const bytes = Buffer.alloc(2049); let length = 0, count: number;
  do { count = readSync(fd, bytes, length, bytes.length - length, null); length += count; } while (count > 0 && length < bytes.length);
  const after = fstatSync(fd, { bigint: true }), current = lstatSync(path, { bigint: true });
  const fields = ['dev', 'ino', 'size', 'mode', 'uid', 'nlink', 'mtimeNs', 'ctimeNs'] as const;
  if (BigInt(length) !== stat.size || fields.some(field => before[field] !== stat[field] || after[field] !== stat[field] || current[field] !== stat[field])) throw new Error();
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('default_room_configuration');
  const config = value as Record<string, unknown>;
  if (Object.keys(config).some(key => !['expectedSubject', 'roomId'].includes(key)) ||
    typeof config.expectedSubject !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(config.expectedSubject) ||
    (config.roomId !== undefined && (typeof config.roomId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(config.roomId)))) throw new Error('default_room_configuration');
  return { expectedSubject: config.expectedSubject, ...(config.roomId ? { roomId: config.roomId as string } : {}) };
  } catch { throw new Error('default_room_configuration'); }
  finally { if (fd !== undefined) closeSync(fd); }
}
