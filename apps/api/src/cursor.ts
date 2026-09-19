import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { uuid } from './repositories.js';

export type CursorPurpose = 'manifest' | 'snapshot' | 'events' | 'history' | 'profile';
export interface CursorBinding {
  purpose: CursorPurpose;
  userId: string;
  sessionId: string;
  deviceId: string;
  cacheId: string;
  roomId: string | null;
  periodId: string | null;
  acl: string;
}
export interface CursorPosition { from: string; upper: string | null; lastId: string | null }
export interface CursorOptions { now: Date; ttlSeconds?: number }
export class CursorError extends Error {
  readonly code = 'INVALID_CURSOR';
  constructor() { super('INVALID_CURSOR'); }
}

const purposes = ['manifest', 'snapshot', 'events', 'history', 'profile'];
const bindingKeys = ['purpose', 'userId', 'sessionId', 'deviceId', 'cacheId', 'roomId', 'periodId', 'acl'];
const positionKeys = ['from', 'upper', 'lastId'];
const clearBytes = 1536;
const tokenBytes = 1 + 12 + 16 + clearBytes;
const tokenLength = Math.ceil(tokenBytes * 4 / 3);
const maxTtlMs = 7 * 86400000;
const uint64Max = 18446744073709551615n;
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new CursorError();
}
function order(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > uint64Max) throw new CursorError();
}
function binding(value: unknown): asserts value is CursorBinding {
  exact(value, bindingKeys);
  if (typeof value.purpose !== 'string' || !purposes.includes(value.purpose) || typeof value.acl !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.acl) || Buffer.from(value.acl, 'base64url').toString('base64url') !== value.acl) throw new CursorError();
  for (const field of ['userId', 'sessionId', 'deviceId', 'cacheId']) {
    if (typeof value[field] !== 'string') throw new CursorError();
    uuid(value[field]);
  }
  if (value.purpose === 'manifest') {
    if (value.roomId !== null || value.periodId !== null) throw new CursorError();
  } else {
    if (typeof value.roomId !== 'string' || typeof value.periodId !== 'string') throw new CursorError();
    uuid(value.roomId); uuid(value.periodId);
  }
}
function position(value: unknown): asserts value is CursorPosition {
  exact(value, positionKeys); order(value.from);
  if (value.upper !== null) order(value.upper);
  if (value.lastId !== null) {
    if (typeof value.lastId !== 'string') throw new CursorError();
    uuid(value.lastId);
  }
}
function clock(value: unknown): number {
  if (!(value instanceof Date) || !Number.isSafeInteger(value.getTime()) || value.getTime() < 0) throw new CursorError();
  return value.getTime();
}
function normalizeBinding(value: CursorBinding): CursorBinding {
  // Fixed field order also makes binding comparison independent of caller object insertion order.
  return { purpose: value.purpose, userId: value.userId, sessionId: value.sessionId, deviceId: value.deviceId,
    cacheId: value.cacheId, roomId: value.roomId, periodId: value.periodId, acl: value.acl };
}

// Only the server supplies DB UTC time and ACL fingerprints. These tokens are never authorization:
// each page must freshly require the session, membership and grants in the same read snapshot.
export class CursorCodec {
  private readonly key: Buffer;
  private readonly aad: Buffer;
  constructor(key: Buffer, audience: string) {
    if (!Buffer.isBuffer(key) || key.length !== 32 || typeof audience !== 'string' || !/^[a-zA-Z0-9:_-]{1,64}$/.test(audience)) throw new CursorError();
    this.key = createHmac('sha256', key).update(`rogichat:cursor:key:v1:${audience}`).digest();
    this.aad = Buffer.from(`rogichat:cursor:v1:${audience}`, 'utf8');
  }
  encode(scope: CursorBinding, progress: CursorPosition, options: CursorOptions): string {
    try {
      binding(scope); position(progress);
      if (!options || typeof options !== 'object' || Object.keys(options).some(key => !['now', 'ttlSeconds'].includes(key))) throw new CursorError();
      const issued = clock(options.now); const ttl = options.ttlSeconds === undefined ? 86400 : options.ttlSeconds;
      if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > maxTtlMs / 1000) throw new CursorError();
      const expires = issued + ttl * 1000;
      if (!Number.isSafeInteger(expires)) throw new CursorError();
      const encoded = Buffer.from(JSON.stringify({ version: 1, binding: normalizeBinding(scope), position: { from: progress.from, upper: progress.upper, lastId: progress.lastId }, issued, expires }), 'utf8');
      if (encoded.length > clearBytes - 2) throw new CursorError();
      const clear = Buffer.alloc(clearBytes); clear.writeUInt16BE(encoded.length); encoded.copy(clear, 2);
      const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
      cipher.setAAD(this.aad);
      const encrypted = Buffer.concat([cipher.update(clear), cipher.final()]);
      return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]).toString('base64url');
    } catch { throw new CursorError(); }
  }
  decode(token: unknown, expected: CursorBinding, now: Date): CursorPosition {
    try {
      binding(expected); const current = clock(now);
      if (typeof token !== 'string' || token.length !== tokenLength || !/^[A-Za-z0-9_-]+$/.test(token)) throw new CursorError();
      const bytes = Buffer.from(token, 'base64url');
      if (bytes.length !== tokenBytes || bytes[0] !== 1 || bytes.toString('base64url') !== token) throw new CursorError();
      const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(1, 13));
      decipher.setAAD(this.aad); decipher.setAuthTag(bytes.subarray(13, 29));
      const clear = Buffer.concat([decipher.update(bytes.subarray(29)), decipher.final()]);
      const size = clear.readUInt16BE();
      if (size < 2 || size > clearBytes - 2 || clear.subarray(size + 2).some(byte => byte !== 0)) throw new CursorError();
      const decoded: unknown = JSON.parse(clear.subarray(2, size + 2).toString('utf8'));
      exact(decoded, ['version', 'binding', 'position', 'issued', 'expires']);
      binding(decoded.binding); position(decoded.position);
      if (decoded.version !== 1 || typeof decoded.issued !== 'number' || typeof decoded.expires !== 'number' || !Number.isSafeInteger(decoded.issued) || !Number.isSafeInteger(decoded.expires) || decoded.issued < 0 || decoded.expires <= decoded.issued || decoded.expires - decoded.issued > maxTtlMs || decoded.issued > current || decoded.expires <= current) throw new CursorError();
      if (JSON.stringify(normalizeBinding(decoded.binding)) !== JSON.stringify(normalizeBinding(expected))) throw new CursorError();
      return Object.freeze({ from: decoded.position.from, upper: decoded.position.upper, lastId: decoded.position.lastId });
    } catch { throw new CursorError(); }
  }
}
