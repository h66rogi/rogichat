import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { consumeRate } from '../../infrastructure/rate-limit/rate-limit.repository.js';
import type { NativeClientId } from './auth-context.js';

export type SessionBinding = { transport: 'WEB'; clientId?: never } | { transport: 'NATIVE'; clientId: NativeClientId };

export interface CurrentSession {
  id: string; user_id: string; csrf_digest: Buffer; status: string; soop_status: string | null; reviewer_expires_at: Date | null; apple_verified?: boolean;
}

// Every operation uses the caller's handle; this repository never starts a transaction.
@Injectable()
export class SessionRepository {
  async boundNative(tx: Transaction, id: string, audience: string, clientId: NativeClientId) {
    // Callback has no app Bearer. Lock the stored native session and account,
    // then check its generation/recent-auth binding in the caller transaction.
    const [row] = await tx.rows<{ user_id: string; membership_generation: string; recent: number; terms_version: string | null }>(
      'SELECT s.user_id,u.membership_generation,u.terms_version,(s.created_at>UTC_TIMESTAMP(3)-INTERVAL 15 MINUTE) AS recent FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.audience=? AND s.transport=? AND s.client_id=? AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(3) AND u.status=? FOR UPDATE',
      [id, audience, 'NATIVE', clientId, 'ACTIVE']);
    return row;
  }
  async findCurrent(tx: Transaction, tokenDigest: Buffer, audience: string, binding: SessionBinding = { transport: 'WEB' }): Promise<CurrentSession | undefined> {
    if (tx.writable) {
      // Current locking read is retained: a later command must not race session
      // revocation/account suspension/SOOP revocation on this same transaction.
      const [row] = await tx.rows<CurrentSession>(`SELECT s.id,s.user_id,s.csrf_digest,u.status,p.status AS soop_status,u.reviewer_expires_at FROM auth_sessions s JOIN users u ON u.id=s.user_id LEFT JOIN platform_soop p ON p.user_id=u.id WHERE s.token_digest=? AND s.audience=? AND s.transport=? AND s.client_id <=> ? AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(3) FOR UPDATE`, [tokenDigest, audience, binding.transport, binding.clientId ?? null]);
      if (row) row.apple_verified = row.soop_status !== 'VERIFIED' && (await tx.rows('SELECT id FROM auth_identities WHERE user_id=? AND provider=? AND issuer=? AND status=? AND revoked_at IS NULL FOR UPDATE', [row.user_id, 'apple', Buffer.from('https://appleid.apple.com'), 'VERIFIED'])).length > 0;
      return row;
    }
    const row = await tx.prisma.auth_sessions.findFirst({ where: { token_digest: new Uint8Array(tokenDigest), audience, transport: binding.transport, client_id: binding.clientId ?? null, revoked_at: null, expires_at: { gt: await tx.now() } }, select: { id: true, user_id: true, csrf_digest: true, user: { select: { status: true, reviewer_expires_at: true, soop: { select: { status: true } } } } } });
    const apple = row && row.user.soop?.status !== 'VERIFIED' && await tx.prisma.auth_identities.findFirst({ where: { user_id: row.user_id, provider: 'apple', issuer: Buffer.from('https://appleid.apple.com'), status: 'VERIFIED', revoked_at: null }, select: { id: true } });
    return row ? { id: row.id, user_id: row.user_id, csrf_digest: Buffer.from(row.csrf_digest), status: row.user.status, soop_status: row.user.soop?.status ?? null, reviewer_expires_at: row.user.reviewer_expires_at, apple_verified: Boolean(apple) } : undefined;
  }
  currentTerms(tx: Transaction, userId: string) {
    return tx.prisma.users.findUnique({ where: { id: userId }, select: { terms_version: true } });
  }
  async insert(tx: Transaction, session: { id: string; userId: string; tokenDigest: Buffer; csrfDigest: Buffer; audience: string }, binding: SessionBinding = { transport: 'WEB' }): Promise<Date> {
    const expiresAt = new Date((await tx.now()).getTime() + 7 * 86400000);
    await tx.prisma.auth_sessions.create({ data: { id: session.id, user_id: session.userId, token_digest: new Uint8Array(session.tokenDigest), csrf_digest: new Uint8Array(session.csrfDigest), audience: session.audience, transport: binding.transport, client_id: binding.clientId ?? null, expires_at: expiresAt }, select: { id: true } });
    return expiresAt;
  }
  nativeAccount(tx: Transaction, sessionId: string, userId: string, audience: string, clientId: NativeClientId) {
    return tx.prisma.auth_sessions.findFirst({ where: { id: sessionId, user_id: userId, audience, transport: 'NATIVE', client_id: clientId, revoked_at: null }, select: {
      expires_at: true, user: { select: { membership_generation: true, profile: { select: {
        nickname: true, avatar: { select: { id: true, owner_user_id: true, kind: true, room_id: true, state: true, deleted_at: true } },
      } } } },
    } });
  }
  consumeAuthRate(tx: Transaction, key: Buffer, limit: number): Promise<boolean> { return consumeRate(tx, key, limit, 60); }
  async revoke(tx: Transaction, sessionId: string): Promise<void> {
    const now = await tx.now();
    await tx.prisma.auth_sessions.updateMany({ where: { id: sessionId }, data: { revoked_at: now } });
    await tx.prisma.push_subscriptions.updateMany({ where: { session_id: sessionId, revoked_at: null }, data: { revoked_at: now, generation: { increment: 1n } } });
  }

  async list(tx: Transaction, userId: string, audience: string, after?: string) {
    const rows = await tx.prisma.auth_sessions.findMany({ where: { user_id: userId, audience, revoked_at: null, expires_at: { gt: await tx.now() }, ...(after ? { id: { lt: after } } : {}) },
      orderBy: { id: 'desc' }, take: 51, select: { id: true, transport: true, client_id: true, created_at: true, expires_at: true } });
    return { sessions: rows.slice(0, 50), next: rows.length > 50 ? rows[49]!.id : null };
  }

  async revokeOwned(tx: Transaction, userId: string, audience: string, targetId: string): Promise<boolean> {
    const owned = await tx.prisma.auth_sessions.findFirst({ where: { id: targetId, user_id: userId, audience }, select: { id: true } });
    if (!owned) return false;
    await this.revoke(tx, targetId);
    return true;
  }

}
