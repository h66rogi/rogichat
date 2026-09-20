import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { AccountSubjectGuard, DeletionIntent } from '../deletion/deletion-ledger.js';

@Injectable()
export class IdentityGuardRepository {
  unresolvedRegistration(tx: Transaction) {
    return tx.rows('SELECT user_id FROM account_deletion_obligations WHERE guard_coverage=0 ORDER BY user_id LIMIT 1 FOR SHARE');
  }
  policies(tx: Transaction) {
    // Current shared lock also fences first policy installation for keyless callers.
    return tx.rows<{ fingerprint: Buffer }>('SELECT fingerprint FROM identity_guard_keys WHERE version=1 FOR SHARE');
  }
  async pin(tx: Transaction, guard: AccountSubjectGuard) {
    await tx.prisma.identity_guard_keys.createMany({ data: [{ version: guard.version, fingerprint: Buffer.from(guard.keyFingerprint, 'hex') }], skipDuplicates: true });
    const [row] = await tx.rows<{ fingerprint: Buffer }>('SELECT fingerprint FROM identity_guard_keys WHERE version=? FOR SHARE', [guard.version]);
    return row;
  }
  async lock(tx: Transaction, guard: Pick<AccountSubjectGuard, 'version' | 'keyFingerprint' | 'subjectHmac'>) {
    const subject_hmac = Buffer.from(guard.subjectHmac, 'hex');
    await tx.prisma.identity_subject_guards.createMany({ data: [{ subject_hmac, key_version: guard.version,
      key_fingerprint: Buffer.from(guard.keyFingerprint, 'hex') }], skipDuplicates: true });
    // Project the current locked row directly; an earlier RR snapshot is not authority.
    const [row] = await tx.rows<{ request_id: string | null; user_id: string | null; requested_at: Date | null }>(
      'SELECT request_id,user_id,requested_at FROM identity_subject_guards WHERE subject_hmac=? FOR UPDATE', [subject_hmac]);
    if (!row) throw new Error('identity_guard_unavailable');
    return row;
  }
  async block(tx: Transaction, guard: AccountSubjectGuard, intent: DeletionIntent, maxAuthLifetime: number) {
    await tx.prisma.identity_subject_guards.update({ where: { subject_hmac: Buffer.from(guard.subjectHmac, 'hex') }, data: {
      request_id: intent.requestId, user_id: intent.targetId, requested_at: new Date(intent.requestedAt),
      auth_not_before: new Date(Date.parse(intent.requestedAt) + maxAuthLifetime),
    }, select: { subject_hmac: true } });
  }
}
