import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2';
import type { Transaction, Transactions } from './transactions.js';
import { createUser } from './repositories.js';

export type ErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'SOOP_LINK_REQUIRED' | 'INVALID_REQUEST' | 'AUTH_FAILED' | 'AUTH_UNAVAILABLE' | 'RATE_LIMITED' | 'CONFLICT' | 'NOT_FOUND';
export class ApiError extends HttpException {
  constructor(readonly code: ErrorCode, status: number) { super({ error: { code } }, status); }
}
export const digest = (value: string): Buffer => createHash('sha256').update(value).digest();
export const secret = (): string => randomBytes(32).toString('base64url');
export function opaque(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new ApiError('INVALID_REQUEST', 400);
  return value;
}
export function equalDigest(value: string, expected: Buffer): boolean {
  return expected.length === 32 && timingSafeEqual(digest(value), expected);
}
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new ApiError('INVALID_REQUEST', 400);
  return value as Record<string, unknown>;
}

export interface Principal {
  userId: string;
  sessionId: string;
  soopLinked: boolean;
}
interface SessionRow extends RowDataPacket {
  id: string; user_id: string; csrf_digest: Buffer; status: string; soop_status: string | null;
}

export class Sessions {
  constructor(readonly transactions: Transactions, readonly audience: string, private readonly key: Buffer) {}
  csrf(token: string): string { return createHmac('sha256', this.key).update(`csrf:${this.audience}:${token}`).digest('base64url'); }
  async issue(tx: Transaction, userId: string): Promise<{ token: string; csrf: string }> {
    const token = secret(); const csrf = this.csrf(token);
    await tx.execute('INSERT INTO auth_sessions (id,user_id,token_digest,csrf_digest,audience,expires_at) VALUES (?,?,?,?,?,TIMESTAMPADD(DAY,7,UTC_TIMESTAMP(3)))',
      [randomUUID(), userId, digest(token), digest(csrf), this.audience]);
    return { token, csrf };
  }
  // Reads and subsequent projections MUST use this same handle; current locking read for commands.
  async require(tx: Transaction, token: string | undefined, csrf?: string, chat = false): Promise<Principal> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError('UNAUTHENTICATED', 401);
    const [session] = await tx.rows<SessionRow>(`SELECT s.id,s.user_id,s.csrf_digest,u.status,p.status AS soop_status FROM auth_sessions s JOIN users u ON u.id=s.user_id LEFT JOIN platform_soop p ON p.user_id=u.id WHERE s.token_digest=? AND s.audience=? AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(3)${tx.writable ? ' FOR UPDATE' : ''}`, [digest(token), this.audience]);
    if (!session || session.status !== 'ACTIVE') throw new ApiError('UNAUTHENTICATED', 401);
    if (csrf !== undefined && !equalDigest(csrf, session.csrf_digest)) throw new ApiError('FORBIDDEN', 403);
    const soopLinked = session.soop_status === 'VERIFIED';
    if (chat && !soopLinked) throw new ApiError('SOOP_LINK_REQUIRED', 403);
    return { userId: session.user_id, sessionId: session.id, soopLinked };
  }
  async logout(token: string | undefined, csrf: string): Promise<void> {
    await this.transactions.write(async tx => {
      const principal = await this.require(tx, token, csrf);
      await tx.execute('UPDATE auth_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE id=?', [principal.sessionId]);
    });
  }
}

export interface VerifiedIdentity {
  schemaVersion: 1; provider: 'soop'; subject: string; clientId: string; transactionId: string; authenticatedAt: string;
}

export async function resolveSoop(tx: Transaction, identity: VerifiedIdentity, linkUserId?: string): Promise<string> {
  const subject = Buffer.from(identity.subject, 'utf8');
  if (!subject.length || subject.length > 191) throw new ApiError('AUTH_FAILED', 400);
  const [existing] = await tx.rows<RowDataPacket>('SELECT user_id,status FROM platform_soop WHERE provider_subject=? FOR UPDATE', [subject]);
  if (existing) {
    if (linkUserId && existing.user_id !== linkUserId) throw new ApiError('CONFLICT', 409);
    if (existing.status !== 'VERIFIED') throw new ApiError('AUTH_FAILED', 400);
    const [user] = await tx.rows<RowDataPacket>('SELECT status FROM users WHERE id=? FOR UPDATE', [existing.user_id]);
    if (!user || user.status !== 'ACTIVE') throw new ApiError('AUTH_FAILED', 400);
    return existing.user_id as string;
  }
  const userId = linkUserId ?? await createUser(tx, '새 사용자');
  if (linkUserId) {
    const linked = await tx.rows('SELECT id FROM platform_soop WHERE user_id=? FOR UPDATE', [linkUserId]);
    if (linked.length) throw new ApiError('CONFLICT', 409);
  }
  await tx.execute('INSERT INTO platform_soop (id,user_id,provider_subject,verified_at) VALUES (?,?,?,UTC_TIMESTAMP(3))', [randomUUID(), userId, subject]);
  await tx.execute('UPDATE users SET membership_generation=membership_generation+1 WHERE id=?', [userId]);
  return userId;
}
