import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from '../../transactions.js';
import { consumeRate } from '../../repositories.js';

export interface CurrentSession {
  id: string; user_id: string; csrf_digest: Buffer; status: string; soop_status: string | null;
}

// Every operation uses the caller's handle; this repository never starts a transaction.
@Injectable()
export class SessionRepository {
  async findCurrent(tx: Transaction, tokenDigest: Buffer, audience: string): Promise<CurrentSession | undefined> {
    const [session] = await tx.rows<RowDataPacket & CurrentSession>(`SELECT s.id,s.user_id,s.csrf_digest,u.status,p.status AS soop_status FROM auth_sessions s JOIN users u ON u.id=s.user_id LEFT JOIN platform_soop p ON p.user_id=u.id WHERE s.token_digest=? AND s.audience=? AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(3)${tx.writable ? ' FOR UPDATE' : ''}`, [tokenDigest, audience]);
    return session;
  }
  async insert(tx: Transaction, session: { id: string; userId: string; tokenDigest: Buffer; csrfDigest: Buffer; audience: string }): Promise<void> {
    await tx.execute('INSERT INTO auth_sessions (id,user_id,token_digest,csrf_digest,audience,expires_at) VALUES (?,?,?,?,?,TIMESTAMPADD(DAY,7,UTC_TIMESTAMP(3)))',
      [session.id, session.userId, session.tokenDigest, session.csrfDigest, session.audience]);
  }
  consumeAuthRate(tx: Transaction, key: Buffer, limit: number): Promise<boolean> { return consumeRate(tx, key, limit, 60); }
  async revoke(tx: Transaction, sessionId: string): Promise<void> {
    await tx.execute('UPDATE auth_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE id=?', [sessionId]);
  }
}
