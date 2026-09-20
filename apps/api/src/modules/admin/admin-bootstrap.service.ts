import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Transactions } from '../../infrastructure/database/transactions.js';
import type { AdminBootstrapRequest } from './admin-bootstrap.request.js';
import type { AdminBootstrapRepository } from './admin-bootstrap.repository.js';
import type { PasswordHasher } from '../auth/password/password-hasher.js';
export class AdminBootstrapService {
  constructor(private readonly transactions: Transactions, private readonly repository: AdminBootstrapRepository,
    private readonly hasher: PasswordHasher, private readonly environment: string, private readonly key: Buffer) {}
  async apply(request: AdminBootstrapRequest) {
    if (request.environment !== this.environment) throw new Error('admin_environment_mismatch');
    // Keyed receipt is not an offline password oracle. Canonical parsed order is
    // stable across exact reruns, including after an unknown COMMIT response.
    const digest = createHmac('sha256', this.key).update('admin-bootstrap:v1:').update(JSON.stringify(request)).digest();
    const hash = request.scope === 'REVIEWER_ACCOUNT' ? await this.hasher.hash(request.password) : null;
    await this.transactions.write(async tx => {
      await this.repository.operator(tx, request);
      const previous = await this.repository.receipt(tx, request.requestId);
      if (previous) {
        if (previous.operator_user_id !== request.operatorUserId || previous.action !== request.scope || !previous.reason_digest || !timingSafeEqual(Buffer.from(previous.reason_digest), digest)) throw new Error('admin_receipt_conflict');
        return;
      }
      if (request.scope === 'ADMIN_TEST_ACCESS') await this.repository.grant(tx, request.operatorUserId);
      else if (request.scope === 'REVIEWER_ACCOUNT') await this.repository.reviewer(tx, request, hash!);
      else await this.repository.revoke(tx, request.targetUserId);
      await this.repository.audit(tx, request, digest);
    });
  }
}
