import { lstatSync, readFileSync } from 'node:fs';
export interface DefaultRoomConfig { expectedSubject?: string; roomId?: string }
// Stable product catalog seed. It grants no authorization; ownership requires
// exact verified provider identity supplied through protected configuration.
export const DEFAULT_ROOM_ID = 'bdcc3129-e4a8-49ec-9491-ce9ca62cb5d3';
export function readDefaultRoomConfig(env: NodeJS.ProcessEnv = process.env): DefaultRoomConfig {
  const path = env.DEFAULT_ROOM_SECRET_FILE;
  if (!path) return {};
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2048 || (stat.mode & 0o077) !== 0 ||
    (stat.uid !== 0 && stat.uid !== process.getuid?.())) throw new Error('default_room_configuration');
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('default_room_configuration');
  const config = value as Record<string, unknown>;
  if (Object.keys(config).some(key => !['expectedSubject', 'roomId'].includes(key)) ||
    typeof config.expectedSubject !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(config.expectedSubject) ||
    (config.roomId !== undefined && (typeof config.roomId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(config.roomId)))) throw new Error('default_room_configuration');
  return { expectedSubject: config.expectedSubject, ...(config.roomId ? { roomId: config.roomId as string } : {}) };
}
