import { appleGuardSubject, APPLE_ISSUER } from '../auth/apple/apple-provider.js';
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AuthService } from '../auth/auth.service.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { ApiError } from '../auth/auth-primitives.js';
import { requireCommandProof } from '../auth/auth-context.js';
import type { CommandCredentials } from '../auth/auth-context.js';
import { IdentityGuardService } from '../auth/identity-guard.service.js';
import { DeletionLedger, DeletionLedgerError, accountDeletionId } from './deletion-ledger.js';
import type { DeletionIntent, ScopedAccountSubjectGuard } from './deletion-ledger.js';
import { DeletionApplyService } from './deletion-apply.service.js';
import { AccountDeletionRepository } from './account-deletion.repository.js';

@Injectable()
export class AccountDeletionService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(IdentityGuardService) private readonly guards: IdentityGuardService,
    @Inject(AccountDeletionRepository) private readonly repository: AccountDeletionRepository,
    @Inject(DeletionLedger) private readonly ledger: DeletionLedger | null,
    @Inject(DeletionApplyService) private readonly apply: DeletionApplyService) {}

  async remove(credentials: CommandCredentials) {
    requireCommandProof(credentials);
    const intent = await this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials);
      if (!await this.repository.recent(tx, actor.sessionId)) throw new ApiError('RECENT_AUTH_REQUIRED', 403);
      if (!this.ledger || !this.config.identityGuardKey) throw new ServiceUnavailableException();
      await this.guards.checkKey(tx, this.config.identityGuardKey);
      const subject = await this.repository.subject(tx, actor.userId);
      const apple = await this.repository.appleSubjects(tx, actor.userId);
      if (apple.length > 7 || apple.some(identity => Buffer.from(identity.issuer).toString('utf8') !== APPLE_ISSUER)) throw new ServiceUnavailableException();
      const subjectGuards: ScopedAccountSubjectGuard[] = [
        ...(subject ? [{ ...this.guards.evidence(subject.provider_subject, subject.id, this.config.identityGuardKey), provider: 'soop' as const }] : []),
        ...apple.map(identity => ({ ...this.guards.appleEvidence(appleGuardSubject(identity.scope, Buffer.from(identity.subject).toString('utf8')), identity.id, this.config.identityGuardKey), provider: 'apple' as const })),
      ].sort((left, right) => left.subjectHmac.localeCompare(right.subjectHmac));
      const prior = await this.repository.prior(tx, actor.userId, this.ledger.environment);
      return { schemaVersion: 3, environment: this.ledger.environment, actorUserId: actor.userId, scope: 'ACCOUNT', roomId: null,
        targetId: actor.userId, requestId: prior?.request_id ?? accountDeletionId(this.ledger.environment, actor.userId),
        requestedAt: (prior?.requested_at ?? await tx.now()).toISOString(),
        subjectGuards } satisfies DeletionIntent;
    });
    try {
      // Durable intent is an authorized command, even when the response is lost.
      // All external I/O is outside the preflight and checkpoint transactions.
      const result = await this.apply.apply(await this.ledger!.ensureIntent(intent));
      if (result.status !== 'blocked') throw new ServiceUnavailableException();
      return result;
    } catch (error) {
      if (error instanceof DeletionLedgerError) throw new ServiceUnavailableException();
      throw error;
    }
  }
}
