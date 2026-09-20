import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { NativePushProvider } from './native-push-contract.js';

export interface NativeBindingRow {
  id: string; user_id: string; session_id: string; audience: string; provider: NativePushProvider;
  native_client_id: string; installation_id: string; binding_digest: Buffer;
  endpoint_digest: Buffer; native_token: Buffer; generation: string; account_generation: string; revoked_at: Date | null;
}
@Injectable()
export class NativePushRepository {
  hint(tx: Transaction, installation: string) {
    return tx.prisma.push_subscriptions.findUnique({ where: { installation_id: installation }, select: { id: true, user_id: true } });
  }
  async lockPreviousAccount(tx: Transaction, userId: string) {
    // Registration already holds the new account lock. NOWAIT prevents a
    // crossed A→B/B→A rebind from forming an inverse account-lock cycle.
    await tx.rows('SELECT id FROM users WHERE id=? FOR UPDATE NOWAIT', [userId]);
  }
  async lock(tx: Transaction, installation: string) {
    const [row] = await tx.rows<NativeBindingRow>('SELECT id,user_id,session_id,audience,provider,native_client_id,installation_id,binding_digest,endpoint_digest,native_token,generation,account_generation,revoked_at FROM push_subscriptions WHERE installation_id=? FOR UPDATE', [installation]);
    return row;
  }
  async session(tx: Transaction, userId: string, sessionId: string, client: string, audience: string) {
    const [row] = await tx.rows<{ membership_generation: string }>(`SELECT u.membership_generation FROM users u JOIN auth_sessions s ON s.user_id=u.id WHERE u.id=? AND s.id=? AND s.transport='NATIVE' AND s.client_id=? AND s.audience=? AND u.status='ACTIVE' AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(3) FOR UPDATE`, [userId, sessionId, client, audience]);
    return row;
  }
  create(tx: Transaction, data: Prisma.push_subscriptionsUncheckedCreateInput) {
    return tx.prisma.push_subscriptions.create({ data, select: { id: true, generation: true } });
  }
  update(tx: Transaction, id: string, generation: bigint, data: Prisma.push_subscriptionsUncheckedUpdateManyInput) {
    return tx.prisma.push_subscriptions.updateMany({ where: { id, generation, provider: { in: ['APNS', 'FCM'] } }, data });
  }
  byId(tx: Transaction, id: string) {
    return tx.prisma.push_subscriptions.findUnique({ where: { id }, select: { installation_id: true, user_id: true } });
  }
  async count(tx: Transaction, userId: string, replacingId?: string) {
    const now = await tx.now();
    // Expired/logged-out installations must not permanently exhaust slots.
    // Their tombstones/credentials still follow bounded account cleanup; they
    // cannot deliver because every enqueue and send rechecks the session.
    return tx.prisma.push_subscriptions.count({ where: { user_id: userId, ...(replacingId ? { id: { not: replacingId } } : {}), provider: { in: ['APNS', 'FCM'] }, revoked_at: null,
      session: { transport: 'NATIVE', revoked_at: null, expires_at: { gt: now } } } });
  }
}
