import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../../infrastructure/database/transactions.js';
import { consumeRate } from '../../../infrastructure/rate-limit/rate-limit.repository.js';
const fields = { user_id: true, password_hash: true, revision: true, disabled_at: true } as const;
@Injectable()
export class PasswordRepository {
  byLogin(tx: Transaction, loginId: string) {
    return tx.prisma.password_accounts.findUnique({ where: { login_id: loginId }, select: fields });
  }
  byUser(tx: Transaction, userId: string) {
    return tx.prisma.password_accounts.findUnique({ where: { user_id: userId }, select: fields });
  }
  async lock(tx: Transaction, userId: string) {
    // Serialize credential reset/deletion under the account-first lock order.
    const [account] = await tx.rows<{ status: string }>('SELECT status FROM users WHERE id=? FOR UPDATE', [userId]);
    const [credential] = await tx.rows<{ user_id: string; password_hash: string; revision: string; disabled_at: Date | null }>(
      'SELECT user_id,password_hash,revision,disabled_at FROM password_accounts WHERE user_id=? FOR UPDATE', [userId]);
    return account?.status === 'ACTIVE' ? credential : undefined;
  }
  rate(tx: Transaction, key: Buffer) { return consumeRate(tx, key, 10, 900); }
  terms(tx: Transaction, userId: string, version: string) {
    return tx.prisma.users.update({ where: { id: userId }, data: { terms_version: version }, select: { id: true } });
  }
  async replace(tx: Transaction, userId: string, hash: string, revision: bigint) {
    const result = await tx.prisma.password_accounts.updateMany({ where: { user_id: userId, revision, disabled_at: null }, data: { password_hash: hash, revision: { increment: 1n } } });
    if (result.count !== 1) return false;
    const now = await tx.now();
    await tx.prisma.auth_sessions.updateMany({ where: { user_id: userId, revoked_at: null }, data: { revoked_at: now } });
    await tx.prisma.users.update({ where: { id: userId }, data: { membership_generation: { increment: 1n } }, select: { id: true } });
    await tx.prisma.push_subscriptions.updateMany({ where: { user_id: userId, revoked_at: null }, data: { revoked_at: now, generation: { increment: 1n } } });
    await this.audit(tx, userId, 'PASSWORD_CHANGED');
    return true;
  }
  audit(tx: Transaction, userId: string, action: string) {
    return tx.prisma.access_audit.create({ data: { id: randomUUID(), operator_user_id: userId, target_user_id: userId, action }, select: { id: true } });
  }
}
