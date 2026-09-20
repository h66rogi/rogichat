import { ApiError, object } from './auth-primitives.js';
import { nickname } from '../access/access.policy.js';

export interface SoopProfile { displayId: string; nickname: string | null; imageUrl: string | null }

// Token-bound broker metadata and the fixed public station endpoint are the only
// callers. This is not an arbitrary remote URL upload API.
export function canonicalProfileId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  const m = /^https:\/\/(?:stimg|profile\.img)\.sooplive\.(?:com|co\.kr)\/LOGO\/([A-Za-z0-9_-]{1,2})\/([A-Za-z0-9_-]{1,128})\/(m\/)?([A-Za-z0-9_-]{1,128})\.(jpg|webp)(?:\?t=[0-9]{1,16})?$/.exec(value);
  return m && m[0] === value && m[1] === m[2]!.slice(0, 2) && m[2] === m[4] && (!m[3] || m[5] === 'webp') ? m[2]! : null;
}
export function parseSoopProfile(value: unknown, subject: string): SoopProfile {
  const p = object(value, ['displayId', 'nickname', 'imageUrl']);
  if (p.displayId !== subject || !/^[A-Za-z0-9_-]{1,128}$/.test(subject) ||
    (p.imageUrl !== null && canonicalProfileId(p.imageUrl) !== subject)) throw new ApiError('AUTH_FAILED', 400);
  let name: string | null = null;
  if (p.nickname !== null) {
    try { name = nickname(p.nickname); } catch { throw new ApiError('AUTH_FAILED', 400); }
  }
  return { displayId: subject, nickname: name, imageUrl: p.imageUrl as string | null };
}
