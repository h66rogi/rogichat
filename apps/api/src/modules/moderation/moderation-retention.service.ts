import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { ModerationRetentionRepository } from './moderation-retention.repository.js';
@Injectable()
export class ModerationRetentionService {
  constructor(@Inject(ModerationRetentionRepository) private readonly repository: ModerationRetentionRepository) {}
  private limit(limit: number) { if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('invalid_moderation_cleanup_limit'); return limit; }
  clearForMessage(tx: Transaction, roomId: string, messageId: string, limit = 100) {
    return this.repository.clear(tx, { kind: 'message', roomId, messageId }, this.limit(limit));
  }
  clearForAccount(tx: Transaction, userId: string, limit = 100) {
    return this.repository.clear(tx, { kind: 'account', userId }, this.limit(limit));
  }
  async expire(tx: Transaction, limit = 100) {
    return this.repository.clear(tx, { kind: 'expiry', now: await tx.now() }, this.limit(limit));
  }
}
