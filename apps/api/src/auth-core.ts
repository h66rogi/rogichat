import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2';
import type { Transaction, Transactions } from './transactions.js';
import { createUser } from './repositories.js';
import { SessionRepository } from './modules/auth/session.repository.js';
import { SessionService } from './modules/auth/session.service.js';
import { ApiError } from './modules/auth/auth-primitives.js';
import type { Principal } from './modules/auth/auth-primitives.js';

export { ApiError, digest, secret, opaque, equalDigest, object } from './modules/auth/auth-primitives.js';
export type { ErrorCode, Principal } from './modules/auth/auth-primitives.js';
// Compatibility adapter for legacy AuthFlow and direct callers. Production receives the
// Nest-owned SessionService explicitly; only the legacy 3-argument constructor falls back.
export class Sessions {
  private readonly service: SessionService;
  constructor(readonly transactions: Transactions, readonly audience: string, key: Buffer, service?: SessionService) {
    this.service = service ?? new SessionService(new SessionRepository(), audience, key);
  }
  csrf(token: string): string { return this.service.csrf(token); }
  issue(tx: Transaction, userId: string): Promise<{ token: string; csrf: string }> { return this.service.issue(tx, userId); }
  require(tx: Transaction, token: string | undefined, csrf?: string, chat = false): Promise<Principal> { return this.service.require(tx, token, csrf, chat); }
  logout(token: string | undefined, csrf: string): Promise<void> {
    return this.transactions.write(tx => this.service.revoke(tx, token, csrf));
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
