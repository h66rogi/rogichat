import { ApiError } from '../auth-primitives.js';
import type { Transactions, Transaction } from '../../../infrastructure/database/transactions.js';
import type { AuthConfig } from '../../../infrastructure/config/auth-config.js';
import type { DeletionReceipt } from '../../deletion/deletion-ledger.js';
import type { IdentityGuardService } from '../identity-guard.service.js';
import type { AppleProvider } from './apple-provider.js';
import { appleGuardSubject } from './apple-provider.js';
import type { AppleRepository } from './apple.repository.js';
import type { AppleLifecycleRepository } from './apple-lifecycle.repository.js';
import { AppleSeal } from './apple-seal.js';

export class AppleLifecycleService {
  private activeCursor: string | null = null;
  constructor(private readonly transactions: Transactions, private readonly repository: AppleLifecycleRepository,
    private readonly identities: AppleRepository, private readonly provider: AppleProvider,
    private readonly guards: IdentityGuardService, private readonly config?: AuthConfig) {}
  async notification(payload: string) {
    const event = await this.provider.notification(payload);
    await this.transactions.write(async tx => {
      if (!await this.repository.receipt(tx, event.id)) return;
      if (event.type === 'email-enabled' || event.type === 'email-disabled') return;
      // Guard fence is shared with deletion and all identity admission paths.
      // Deleted identities can reject the callback; receipt rollback lets Apple retry.
      try { await this.guards.checkApple(tx, appleGuardSubject(event.scope, event.subject), this.config?.identityGuardKey); }
      catch (error) { if (error instanceof ApiError && error.code === 'AUTH_FAILED') return; throw error; }
      const prior = await this.identities.event(tx, event.scope, event.subject);
      if (prior >= event.eventTime) return;
      await this.repository.recordEvent(tx, event.scope, event.subject, event.eventTime);
      const identity = await this.identities.identity(tx, event.scope, event.subject);
      if (!identity || (identity.verified_at && identity.verified_at > event.eventTime)) return;
      await this.identities.account(tx, identity.user_id);
      await this.repository.invalidate(tx, identity.id, identity.user_id, event.eventTime);
    });
  }
  async revokeStep() {
    if (!this.config?.apple) return { processed: 0, unavailable: false };
    this.activeCursor = await this.transactions.write(tx => this.repository.recover(tx, this.activeCursor));
    const claim = await this.transactions.write(tx => this.repository.revokeCandidate(tx));
    if (!claim) return { processed: 0, unavailable: false };
    let success = false;
    try {
      const token = new AppleSeal(this.config.key, this.config.audience).open(claim.token, claim.id, 'refresh');
      if (typeof token !== 'string') throw new Error('invalid_apple_token');
      await this.provider.revoke(claim.audience, token); success = true;
    } catch { /* Durable exponential retry; never discard an unacknowledged token. */ }
    await this.transactions.write(tx => this.repository.finishRevoke(tx, claim.id, claim.lease, success, claim.attempts));
    return { processed: 1, unavailable: !success };
  }
  purgeAccount(tx: Transaction, receipt: DeletionReceipt, limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('invalid_auth_purge_limit');
    return this.repository.purgeAccount(tx, receipt, limit);
  }
}
