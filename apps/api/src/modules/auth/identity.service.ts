import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { ApiError } from './auth-primitives.js';
import { IdentityGuardService } from './identity-guard.service.js';
import { AUTH_CONFIG } from './auth.tokens.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { IdentityRepository } from './identity.repository.js';
import { parseSoopProfile } from './soop-profile.contract.js';
import type { SoopProfile } from './soop-profile.contract.js';
import { JobsCoreService } from '../jobs/jobs-core.service.js';

export interface VerifiedIdentity {
  schemaVersion: 1; provider: 'soop'; subject: string; clientId: string; transactionId: string; authenticatedAt: string;
  profile?: SoopProfile;
}

@Injectable()
export class IdentityService {
  constructor(@Inject(IdentityRepository) private readonly repository: IdentityRepository,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(IdentityGuardService) private readonly guards: IdentityGuardService,
    @Inject(JobsCoreService) private readonly jobs: JobsCoreService) {}
  private async initializeProfile(tx: Transaction, userId: string, identity: VerifiedIdentity) {
    if (!identity.profile) return;
    const change = await this.repository.initializeProfile(tx, userId, parseSoopProfile(identity.profile, identity.subject));
    if (change) await this.jobs.enqueue(tx, { purpose: 'REALTIME_HINT', resourceId: change });
  }
  async check(tx: Transaction, identity: VerifiedIdentity): Promise<void> {
    const subject = Buffer.from(identity.subject, 'utf8');
    if (!subject.length || subject.length > 191) throw new ApiError('AUTH_FAILED', 400);
    await this.guards.check(tx, subject, this.config?.identityGuardKey);
  }
  async resolve(tx: Transaction, identity: VerifiedIdentity, linkUserId?: string): Promise<string> {
    const subject = Buffer.from(identity.subject, 'utf8');
    if (!subject.length || subject.length > 191) throw new ApiError('AUTH_FAILED', 400);
    await this.check(tx, identity);
    const existing = await this.repository.findSubject(tx, subject);
    if (existing) {
      if (linkUserId && existing.user_id !== linkUserId) throw new ApiError('CONFLICT', 409);
      const user = await this.repository.account(tx, String(existing.user_id));
      if (!user || user.status !== 'ACTIVE') throw new ApiError('AUTH_FAILED', 400);
      if (existing.status === 'REVOKED') await this.repository.reverify(tx, String(existing.user_id));
      await this.initializeProfile(tx, String(existing.user_id), identity);
      return String(existing.user_id);
    }
    await this.guards.requireRegistration(tx);
    if (linkUserId && (await this.repository.account(tx, linkUserId))?.status !== 'ACTIVE') throw new ApiError('AUTH_FAILED', 400);
    const userId = linkUserId ?? await this.repository.registerAccount(tx);
    if (linkUserId && await this.repository.linked(tx, linkUserId)) throw new ApiError('CONFLICT', 409);
    await this.repository.link(tx, userId, subject);
    await this.initializeProfile(tx, userId, identity);
    return userId;
  }
}
