import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../transactions.js';
import { consumeRate } from '../../repositories.js';

// R1 owns revocation here; legacy Sessions.require/issue SQL extraction is deferred to R2.
@Injectable()
export class SessionRepository {
  consumeAuthRate(tx: Transaction, key: Buffer, limit: number): Promise<boolean> { return consumeRate(tx, key, limit, 60); }
  async revoke(tx: Transaction, sessionId: string): Promise<void> {
    await tx.execute('UPDATE auth_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE id=?', [sessionId]);
  }
}
