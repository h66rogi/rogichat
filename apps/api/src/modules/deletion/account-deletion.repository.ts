import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { DeletionIntent, LedgerEnvironment } from './deletion-ledger.js';
import { MAX_AUTH_TRANSACTION_MS } from '../auth/identity-guard.service.js';

@Injectable()
export class AccountDeletionRepository {
  recent(tx: Transaction, sessionId: string) {
    return tx.now().then(now => tx.prisma.auth_sessions.count({ where: { id: sessionId,
      created_at: { gt: new Date(now.getTime() - 900000), lte: now } } }));
  }
  subject(tx: Transaction, userId: string) {
    return tx.prisma.platform_soop.findUnique({ where: { user_id: userId }, select: { id: true, provider_subject: true } });
  }
  prior(tx: Transaction, userId: string, environment: LedgerEnvironment) {
    return tx.prisma.deletion_intents.findFirst({ where: { target_id: userId, actor_user_id: userId, scope: 'ACCOUNT', environment },
      orderBy: [{ requested_at: 'asc' }, { request_id: 'asc' }], select: { request_id: true, requested_at: true } });
  }
  async block(tx: Transaction, intent: DeletionIntent) {
    // Guard -> current identity -> current account. Never visit rooms or all sessions.
    const [subject] = await tx.rows<{ id: string }>('SELECT id FROM platform_soop WHERE user_id=? FOR UPDATE', [intent.targetId]);
    const [user] = await tx.rows<{ status: string }>('SELECT status FROM users WHERE id=? FOR UPDATE', [intent.targetId]);
    const covered = Boolean(user) && intent.schemaVersion === 2 && (subject?.id ?? null) === (intent.subjectGuard?.identityId ?? null);
    const requestedAt = new Date(intent.requestedAt);
    const blockedAt = user ? await tx.now() : null;
    await tx.prisma.account_deletion_obligations.createMany({ data: [{ user_id: intent.targetId, request_id: intent.requestId,
      requested_at: requestedAt, auth_not_before: new Date(requestedAt.getTime() + MAX_AUTH_TRANSACTION_MS) }], skipDuplicates: true });
    const [prior] = await tx.rows<{ request_id: string; requested_at: Date; blocked_at: Date | null }>('SELECT request_id,requested_at,blocked_at FROM account_deletion_obligations WHERE user_id=? FOR UPDATE', [intent.targetId]);
    if (!prior) throw new Error('account_deletion_obligation_unavailable');
    if (prior.request_id !== intent.requestId || prior.requested_at.toISOString() !== intent.requestedAt) throw new Error('account_deletion_receipt_conflict');
    if (user && user.status !== 'DELETING' && user.status !== 'DELETED') {
      await tx.prisma.users.update({ where: { id: intent.targetId }, data: { status: 'DELETING', membership_generation: { increment: 1n } }, select: { id: true } });
    }
    await tx.prisma.account_deletion_obligations.update({ where: { user_id: intent.targetId }, data: {
      blocked_at: prior.blocked_at ?? blockedAt, guard_coverage: covered,
    }, select: { user_id: true } });
    return covered;
  }
  async scrubBindings(tx: Transaction, userId: string) {
    const account = await tx.prisma.users.findUnique({ where: { id: userId }, select: { status: true } });
    if (account && !['DELETING', 'DELETED'].includes(account.status)) return;
    // Separate bounded transaction, without account/guard locks: callbacks already
    // hold their login row before acquiring those locks. Status denied them at commit.
    const logins = await tx.prisma.login_transactions.findMany({ where: { user_id: userId, status: { in: ['PENDING', 'PROCESSING'] } },
      orderBy: { id: 'asc' }, take: 100, select: { id: true } });
    if (logins.length) await tx.prisma.login_transactions.updateMany({ where: { id: { in: logins.map(row => row.id) } }, data: {
      status: 'FAILED', verifier: Buffer.alloc(0), launch_payload: null, identity_payload: null, completion_digest: null,
      launch_digest: null, app_challenge: null, return_state: null, bound_generation: null,
    } });
    const sessions = await tx.prisma.auth_sessions.findMany({ where: { user_id: userId, revoked_at: null }, orderBy: { id: 'asc' }, take: 100, select: { id: true } });
    if (sessions.length) await tx.prisma.auth_sessions.updateMany({ where: { id: { in: sessions.map(row => row.id) }, revoked_at: null }, data: { revoked_at: await tx.now() } });
  }
}
