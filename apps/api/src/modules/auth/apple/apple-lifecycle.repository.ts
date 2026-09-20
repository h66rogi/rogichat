import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../../infrastructure/database/transactions.js';
import { APPLE_ISSUER } from './apple-provider.js';
import type { DeletionReceipt } from '../../deletion/deletion-ledger.js';

@Injectable()
export class AppleLifecycleRepository {
  async receipt(tx: Transaction, digest: Buffer) {
    return (await tx.prisma.apple_notification_receipts.createMany({ data: [{ digest: new Uint8Array(digest) }], skipDuplicates: true })).count === 1;
  }
  async recordEvent(tx: Transaction, scope: string, subject: string, eventTime: Date) {
    await tx.prisma.apple_identity_events.updateMany({ where: { scope, subject: Buffer.from(subject), revoked_at: { lt: eventTime } }, data: { revoked_at: eventTime } });
  }
  async invalidate(tx: Transaction, identityId: string, userId: string, eventTime: Date) {
    await tx.prisma.auth_identities.updateMany({ where: { id: identityId, OR: [{ verified_at: null }, { verified_at: { lte: eventTime } }] }, data: { status: 'REVOKED', revoked_at: eventTime } });
    await tx.prisma.users.updateMany({ where: { id: userId }, data: { membership_generation: { increment: 1n } } });
    // Conservative invalidation of all sessions does not delete the account or its
    // SOOP identity. Direct SOOP authentication safely restores that same UUID.
    await tx.prisma.auth_sessions.updateMany({ where: { user_id: userId, revoked_at: null }, data: { revoked_at: await tx.now() } });
    await tx.prisma.apple_provider_credentials.updateMany({ where: { identity_id: identityId, status: { in: ['ACTIVE', 'PENDING'] } }, data: { status: 'REVOKE_PENDING', available_at: await tx.now() } });
  }
  async recover(tx: Transaction, after: string | null) {
    const now = await tx.now();
    // Fair bounded discovery; a page of old deleted accounts without credentials
    // must not starve later accounts. Cursor is discovery only, never authority.
    const active = await tx.prisma.apple_provider_credentials.findMany({ where: { status: 'ACTIVE', ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: 'asc' }, take: 100, select: { id: true, user_id: true } });
    const ids = active.flatMap(row => row.user_id ? [row.user_id] : []);
    const blocked = ids.length ? await tx.prisma.users.findMany({ where: { id: { in: ids }, status: { in: ['DELETING', 'DELETED'] } }, select: { id: true } }) : [];
    if (blocked.length) await tx.prisma.apple_provider_credentials.updateMany({ where: { id: { in: active.map(row => row.id) }, user_id: { in: blocked.map(row => row.id) }, status: 'ACTIVE' }, data: { status: 'REVOKE_PENDING' } });
    const unknown = await tx.prisma.apple_provider_credentials.findMany({ where: { status: 'EXCHANGE_PENDING', expires_at: { lte: now } }, orderBy: { id: 'asc' }, take: 100, select: { id: true } });
    if (unknown.length) await tx.prisma.apple_provider_credentials.updateMany({ where: { id: { in: unknown.map(row => row.id) }, status: 'EXCHANGE_PENDING' }, data: { status: 'EXCHANGE_UNKNOWN' } });
    const expired = await tx.prisma.apple_auth_transactions.findMany({ where: { expires_at: { lte: now }, OR: [{ proof: { not: null } }, { completion_digest: { not: null } }, { status: { in: ['PENDING', 'PROCESSING'] } }] },
      orderBy: { id: 'asc' }, take: 100, select: { id: true } });
    if (expired.length) await tx.prisma.apple_auth_transactions.updateMany({ where: { id: { in: expired.map(row => row.id) }, expires_at: { lte: now } }, data: { status: 'FAILED', proof: null, completion_digest: null } });
    return active.length === 100 ? active.at(-1)!.id : null;
  }
  async revokeCandidate(tx: Transaction) {
    const now = await tx.now();
    const candidate = await tx.prisma.apple_provider_credentials.findFirst({ where: { available_at: { lte: now }, OR: [
      { status: { in: ['REVOKE_PENDING', 'REVOKING'] } }, { status: 'PENDING', expires_at: { lte: now } },
    ] }, orderBy: [{ available_at: 'asc' }, { id: 'asc' }], select: { id: true } });
    if (!candidate) return null;
    const [row] = await tx.rows<{ id: string; status: string; token: Buffer | null; audience: string; expires_at: Date; available_at: Date; attempts: number }>(
      'SELECT id,status,token,audience,expires_at,available_at,attempts FROM apple_provider_credentials WHERE id=? FOR UPDATE', [candidate.id]);
    if (!row || row.available_at > now || !['REVOKE_PENDING', 'REVOKING', 'PENDING'].includes(row.status) || (row.status === 'PENDING' && row.expires_at > now) || !row.token) return null;
    const lease = randomUUID();
    await tx.prisma.apple_provider_credentials.update({ where: { id: row.id }, data: { status: 'REVOKING', lease_token: lease, available_at: new Date(now.getTime() + 30000), attempts: { increment: 1 } }, select: { id: true } });
    return { id: row.id, token: row.token, audience: row.audience, lease, attempts: row.attempts + 1 };
  }
  async finishRevoke(tx: Transaction, id: string, lease: string, success: boolean, attempts: number) {
    await tx.prisma.apple_provider_credentials.updateMany({ where: { id, lease_token: lease, status: 'REVOKING' },
      data: success ? { status: 'REVOKED', token: null, lease_token: null } : { status: 'REVOKE_PENDING', lease_token: null,
        available_at: new Date((await tx.now()).getTime() + Math.min(3600000, 5000 * 2 ** Math.min(attempts, 10))) } });
  }
  async purgeAccount(tx: Transaction, receipt: DeletionReceipt, limit: number) {
    const { intent } = receipt;
    const [obligation] = await tx.rows<{ request_id: string; requested_at: Date; auth_not_before: Date; guard_coverage: number; status: string; ledger_sha256: Buffer }>(
      'SELECT o.request_id,o.requested_at,o.auth_not_before,o.guard_coverage,u.status,d.ledger_sha256 FROM account_deletion_obligations o JOIN users u ON u.id=o.user_id JOIN deletion_intents d ON d.request_id=o.request_id WHERE o.user_id=? FOR UPDATE', [intent.targetId]);
    if (!obligation || intent.scope !== 'ACCOUNT' || obligation.request_id !== intent.requestId || obligation.requested_at.toISOString() !== intent.requestedAt ||
      obligation.ledger_sha256.toString('hex') !== receipt.sha256 || !Number(obligation.guard_coverage) || !['DELETING', 'DELETED'].includes(obligation.status)) throw new Error('auth_purge_not_admitted');
    const now = await tx.now();
    if (obligation.auth_not_before > now) return { changed: 0, hasMore: true, providerPending: false };
    // Preserve UUID/subject guard anchors. All-status scrub includes successful,
    // denied and expired callbacks, and runs only after ORIGINAL auth_not_before.
    const logins = await tx.prisma.login_transactions.findMany({ where: { user_id: intent.targetId, OR: [
      { launch_payload: { not: null } }, { identity_payload: { not: null } }, { completion_digest: { not: null } },
      { launch_digest: { not: null } }, { app_challenge: { not: null } }, { return_state: { not: null } },
      { verifier: { not: Buffer.alloc(0) } },
    ] }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (logins.length) await tx.prisma.login_transactions.updateMany({ where: { id: { in: logins.map(row => row.id) } }, data: {
      status: 'FAILED', verifier: Buffer.alloc(0), launch_payload: null, identity_payload: null, completion_digest: null,
      launch_digest: null, app_challenge: null, return_state: null, bound_generation: null,
    } });
    const apples = await tx.prisma.apple_auth_transactions.findMany({ where: { user_id: intent.targetId, OR: [{ proof: { not: null } }, { completion_digest: { not: null } }, { status: { in: ['PENDING', 'PROCESSING'] } }] },
      orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (apples.length) await tx.prisma.apple_auth_transactions.updateMany({ where: { id: { in: apples.map(row => row.id) } }, data: { status: 'FAILED', proof: null, completion_digest: null } });
    const credentials = await tx.prisma.apple_provider_credentials.findMany({ where: { user_id: intent.targetId, status: { in: ['ACTIVE', 'PENDING'] } }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (credentials.length) await tx.prisma.apple_provider_credentials.updateMany({ where: { id: { in: credentials.map(row => row.id) }, status: { in: ['ACTIVE', 'PENDING'] } }, data: { status: 'REVOKE_PENDING', available_at: now } });
    await tx.prisma.auth_identities.updateMany({ where: { user_id: intent.targetId, provider: 'apple', issuer: Buffer.from(APPLE_ISSUER), status: 'VERIFIED' }, data: { status: 'REVOKED', revoked_at: now } });
    const providerPending = await tx.prisma.apple_provider_credentials.count({ where: { user_id: intent.targetId, status: { not: 'REVOKED' } } }) > 0;
    const changed = logins.length + apples.length + credentials.length;
    return { changed, hasMore: changed > 0 || providerPending, providerPending };
  }
}
