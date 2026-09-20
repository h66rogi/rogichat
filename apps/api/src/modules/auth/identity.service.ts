import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { ApiError } from './auth-primitives.js';
import { IdentityRepository } from './identity.repository.js';

export interface VerifiedIdentity {
  schemaVersion: 1; provider: 'soop'; subject: string; clientId: string; transactionId: string; authenticatedAt: string;
}

@Injectable()
export class IdentityService {
  constructor(@Inject(IdentityRepository) private readonly repository: IdentityRepository) {}
  async resolve(tx: Transaction, identity: VerifiedIdentity, linkUserId?: string): Promise<string> {
    const subject = Buffer.from(identity.subject, 'utf8');
    if (!subject.length || subject.length > 191) throw new ApiError('AUTH_FAILED', 400);
    const existing = await this.repository.findSubject(tx, subject);
    if (existing) {
      if (linkUserId && existing.user_id !== linkUserId) throw new ApiError('CONFLICT', 409);
      if (existing.status !== 'VERIFIED') throw new ApiError('AUTH_FAILED', 400);
      const user = await this.repository.account(tx, String(existing.user_id));
      if (!user || user.status !== 'ACTIVE') throw new ApiError('AUTH_FAILED', 400);
      return String(existing.user_id);
    }
    const userId = linkUserId ?? await this.repository.registerAccount(tx);
    if (linkUserId && await this.repository.linked(tx, linkUserId)) throw new ApiError('CONFLICT', 409);
    await this.repository.link(tx, userId, subject);
    return userId;
  }
}
