import { IdentityGuardRepository } from './identity-guard.repository.js';
import { createHash, createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { accountSubjectGuards } from '../deletion/deletion-ledger.js';
import type { AccountSubjectGuard, DeletionIntent } from '../deletion/deletion-ledger.js';
import { ApiError } from './auth-primitives.js';

export const MAX_AUTH_TRANSACTION_MS = 600000;

/** Internal guard port. No cleanup/completion operation exists in admission. */
@Injectable()
export class IdentityGuardService {
  constructor(@Inject(IdentityGuardRepository) private readonly repository: IdentityGuardRepository) {}
  async requireRegistration(tx: Transaction) {
    // Legacy/missing evidence cannot identify which absent subject was deleted.
    // Until reconciled, deny creation instead of guessing a new account is safe.
    if ((await this.repository.unresolvedRegistration(tx)).length) throw new ApiError('AUTH_UNAVAILABLE', 503);
  }
  evidence(subject: Uint8Array, identityId: string, key: Buffer | undefined): AccountSubjectGuard {
    if (!key || key.length !== 32) throw new ApiError('AUTH_UNAVAILABLE', 503);
    return { version: 1, identityId,
      keyFingerprint: createHash('sha256').update('rogi:identity-guard-key:v1:').update(key).digest('hex'),
      subjectHmac: createHmac('sha256', key).update('rogi:identity-resurrection:soop:v1:').update(subject).digest('hex') };
  }

  appleEvidence(subject: Uint8Array, identityId: string, key: Buffer | undefined): AccountSubjectGuard {
    const evidence = this.evidence(Buffer.alloc(0), identityId, key);
    return { ...evidence, subjectHmac: createHmac('sha256', key!).update('rogi:identity-resurrection:apple:v1:').update(subject).digest('hex') };
  }
  async checkApple(tx: Transaction, subject: Uint8Array, key?: Buffer): Promise<void> {
    // Apple is new: unlike the legacy SOOP bootstrap, it requires a real guard key.
    if (!key) throw new ApiError('AUTH_UNAVAILABLE', 503);
    await this.checkKey(tx, key);
    const row = await this.repository.lock(tx, this.appleEvidence(subject, 'unused', key));
    if (row.request_id !== null) throw new ApiError('AUTH_FAILED', 400);
  }

  async check(tx: Transaction, subject: Uint8Array, key?: Buffer): Promise<void> {
    await this.checkKey(tx, key);
    if (!key) return;
    const guard = this.evidence(subject, 'unused', key);
    const row = await this.repository.lock(tx, guard);
    // Neither a timestamp nor a caller-written completion flag expires a guard.
    // Explicit registration/verified purge cleanup is a separate future command.
    if (row.request_id !== null) throw new ApiError('AUTH_FAILED', 400);
  }

  async checkKey(tx: Transaction, key?: Buffer): Promise<void> {
    const policies = await this.repository.policies(tx);
    if (!key) {
      if (policies.length) throw new ApiError('AUTH_UNAVAILABLE', 503);
      return;
    }
    const guard = this.evidence(Buffer.alloc(0), 'unused', key);
    if (policies.some(policy => policy.fingerprint.toString('hex') !== guard.keyFingerprint)) throw new ApiError('AUTH_UNAVAILABLE', 503);
  }

  async block(tx: Transaction, intent: DeletionIntent): Promise<void> {
    for (const guard of accountSubjectGuards(intent)) {
    const policy = await this.repository.pin(tx, guard);
    if (!policy || policy.fingerprint.toString('hex') !== guard.keyFingerprint) throw new Error('identity_guard_key_conflict');
    const prior = await this.repository.lock(tx, guard);
    if (prior.request_id !== null && (prior.request_id !== intent.requestId || prior.user_id !== intent.targetId || prior.requested_at?.toISOString() !== intent.requestedAt)) throw new Error('identity_guard_receipt_conflict');
    await this.repository.block(tx, guard, intent, MAX_AUTH_TRANSACTION_MS);
    }
  }
}
