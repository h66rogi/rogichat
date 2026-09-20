import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { consumeRate } from '../../infrastructure/rate-limit/rate-limit.repository.js';

export interface CurrentSession {
  id: string; user_id: string; csrf_digest: Buffer; status: string; soop_status: string | null;
}

// Every operation uses the caller's handle; this repository never starts a transaction.
@Injectable()
export class SessionRepository {
  async findCurrent(tx: Transaction, tokenDigest: Buffer, audience: string): Promise<CurrentSession | undefined> {
    if (tx.writable) {
      const [row] = await tx.rows<CurrentSession>(`SELECT s.id,s.user_id,s.csrf_digest,u.status,p.status AS soop_status FROM auth_sessions s JOIN users u ON u.id=s.user_id LEFT JOIN platform_soop p ON p.user_id=u.id WHERE s.token_digest=? AND s.audience=? AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(3) FOR UPDATE`, [tokenDigest, audience]);
      return row;
    }
    const row = await tx.prisma.auth_sessions.findFirst({ where: { token_digest: new Uint8Array(tokenDigest), audience, revoked_at: null, expires_at: { gt: await tx.now() } }, select: { id: true, user_id: true, csrf_digest: true, user: { select: { status: true, soop: { select: { status: true } } } } } });
    return row ? { id: row.id, user_id: row.user_id, csrf_digest: Buffer.from(row.csrf_digest), status: row.user.status, soop_status: row.user.soop?.status ?? null } : undefined;
  }
  async insert(tx: Transaction, session: { id: string; userId: string; tokenDigest: Buffer; csrfDigest: Buffer; audience: string }): Promise<void> {
    await tx.prisma.auth_sessions.create({ data: { id: session.id, user_id: session.userId, token_digest: new Uint8Array(session.tokenDigest), csrf_digest: new Uint8Array(session.csrfDigest), audience: session.audience, expires_at: new Date((await tx.now()).getTime() + 7 * 86400000) }, select: { id: true } });
  }
  consumeAuthRate(tx: Transaction, key: Buffer, limit: number): Promise<boolean> { return consumeRate(tx, key, limit, 60); }
  async revoke(tx: Transaction, sessionId: string): Promise<void> {
    await tx.prisma.auth_sessions.updateMany({ where: { id: sessionId }, data: { revoked_at: await tx.now() } });
  }

}
