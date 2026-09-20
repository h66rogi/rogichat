import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { AdminBootstrapRequest } from './admin-bootstrap.request.js';
@Injectable()
export class AdminBootstrapRepository {
  async operator(tx: Transaction, request: AdminBootstrapRequest) {
    // Match session/account deletion lock order; identity discovery is never authority.
    const [account] = await tx.rows<{ status: string }>('SELECT status FROM users WHERE id=? FOR UPDATE', [request.operatorUserId]);
    if (account?.status !== 'ACTIVE') throw new Error('admin_identity_unavailable');
    const [identity] = await tx.rows<{ user_id: string }>('SELECT user_id FROM platform_soop WHERE provider_subject=? AND status=? FOR UPDATE', [Buffer.from(request.expectedSubject), 'VERIFIED']);
    if (identity?.user_id !== request.operatorUserId) throw new Error('admin_identity_mismatch');
    if (request.scope !== 'ADMIN_TEST_ACCESS') {
      const [admin] = await tx.rows<{ manage_test_access: number }>('SELECT manage_test_access FROM admin_capabilities WHERE user_id=? FOR UPDATE', [request.operatorUserId]);
      if (Number(admin?.manage_test_access) !== 1) throw new Error('admin_capability_required');
    }
  }
  receipt(tx: Transaction, id: string) { return tx.prisma.access_audit.findUnique({ where: { id }, select: { operator_user_id: true, action: true, reason_digest: true } }); }
  async grant(tx: Transaction, userId: string) {
    await tx.prisma.admin_capabilities.upsert({ where: { user_id: userId }, create: { user_id: userId, manage_test_access: true }, update: { manage_test_access: true }, select: { user_id: true } });
    await tx.prisma.users.update({ where: { id: userId }, data: { membership_generation: { increment: 1n } }, select: { id: true } });
  }
  async reviewer(tx: Transaction, request: Extract<AdminBootstrapRequest, { scope: 'REVIEWER_ACCOUNT' }>, passwordHash: string) {
    const now = await tx.now(), expiry = new Date(request.expiresAt);
    if (expiry.getTime() - now.getTime() < 1800000 || expiry.getTime() - now.getTime() > 90 * 86400000) throw new Error('reviewer_expiry_outside_window');
    // Create only. Any existing UUID or login ID conflicts; never take over an
    // existing SOOP/Apple account or attach a guessed platform identity.
    await tx.prisma.users.create({ data: { id: request.targetUserId, reviewer_expires_at: expiry,
      profile: { create: { nickname: request.nickname, nickname_customized: true } },
      password_account: { create: { login_id: request.loginId, password_hash: passwordHash } } }, select: { id: true } });
  }
  async revoke(tx: Transaction, userId: string) {
    const [user] = await tx.rows<{ status: string }>('SELECT status FROM users WHERE id=? FOR UPDATE', [userId]);
    if (!user) throw new Error('reviewer_not_found');
    const password = await tx.prisma.password_accounts.findUnique({ where: { user_id: userId }, select: { user_id: true } });
    if (!password) throw new Error('reviewer_not_found');
    const now = await tx.now();
    await tx.prisma.users.update({ where: { id: userId }, data: { reviewer_expires_at: null, membership_generation: { increment: 1n } }, select: { id: true } });
    await tx.prisma.password_accounts.update({ where: { user_id: userId }, data: { disabled_at: now, revision: { increment: 1n } }, select: { user_id: true } });
    await tx.prisma.auth_sessions.updateMany({ where: { user_id: userId, revoked_at: null }, data: { revoked_at: now } });
    await tx.prisma.push_subscriptions.updateMany({ where: { user_id: userId, revoked_at: null }, data: { revoked_at: now, generation: { increment: 1n } } });
  }
  audit(tx: Transaction, r: AdminBootstrapRequest, digest: Buffer) {
    return tx.prisma.access_audit.create({ data: { id: r.requestId, operator_user_id: r.operatorUserId, target_user_id: r.scope === 'ADMIN_TEST_ACCESS' ? r.operatorUserId : r.targetUserId, action: r.scope, reason_digest: new Uint8Array(digest) }, select: { id: true } });
  }
}
