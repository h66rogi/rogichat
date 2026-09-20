import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class NotificationsRepository {
  preferences(tx: Transaction, userId: string) {
    return tx.prisma.notification_preferences.findUnique({ where: { user_id: userId }, select: { push_enabled: true, generation: true } });
  }
  savePreferences(tx: Transaction, userId: string, pushEnabled: boolean, generation: bigint) {
    return tx.prisma.notification_preferences.upsert({ where: { user_id: userId }, create: { user_id: userId, push_enabled: pushEnabled, generation }, update: { push_enabled: pushEnabled, generation }, select: { push_enabled: true, generation: true } });
  }
  // Current-row locking is necessary for worker admission and logout/account races.
  // HTTP mutations already hold these locks through AuthService on this handle.
  async binding(tx: Transaction, userId: string, sessionId: string, client?: string) {
    const predicate = client ? "s.transport='NATIVE' AND s.client_id=?" : "s.transport='WEB' AND s.client_id IS NULL";
    const [row] = await tx.rows<{ audience: string; membership_generation: string; soop_status: string | null }>(`SELECT s.audience,u.membership_generation,p.status AS soop_status FROM auth_sessions s JOIN users u ON u.id=s.user_id LEFT JOIN platform_soop p ON p.user_id=u.id WHERE s.id=? AND s.user_id=? AND ${predicate} AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(3) AND u.status='ACTIVE' FOR UPDATE`, [sessionId, userId, ...(client ? [client] : [])]);
    return row;
  }
  byEndpoint(tx: Transaction, endpointDigest: Uint8Array) {
    return tx.prisma.push_subscriptions.findUnique({ where: { endpoint_digest: new Uint8Array(endpointDigest) }, select: { id: true } });
  }
  nativeEnrollment(tx: Transaction, userId: string, sessionId: string, audience: string, client: 'ios' | 'android', generation: bigint) {
    return tx.prisma.push_subscriptions.findFirst({ where: { user_id: userId, session_id: sessionId, audience,
      provider: client === 'ios' ? 'APNS' : 'FCM', native_client_id: client, revoked_at: null, native_token: { not: null }, account_generation: generation },
    orderBy: { id: 'asc' }, select: { id: true } });
  }
  byId(tx: Transaction, id: string) {
    return tx.prisma.push_subscriptions.findUnique({ where: { id }, select: { id: true, user_id: true, session_id: true, provider: true, native_client_id: true } });
  }
  // The initial hint locates the account/session lock; this current read must be
  // used afterwards so a concurrent rebind cannot authorize snapshot credentials.
  async lockSubscription(tx: Transaction, id: string) {
    const [row] = await tx.rows<{ id: string; user_id: string; session_id: string; audience: string; endpoint: string | null; p256dh: string | null; auth_secret: string | null; generation: string; account_generation: string; revoked_at: Date | null; provider: 'WEB' | 'APNS' | 'FCM'; native_client_id: string | null; native_token: Buffer | null }>('SELECT id,user_id,session_id,audience,endpoint,p256dh,auth_secret,generation,account_generation,revoked_at,provider,native_client_id,native_token FROM push_subscriptions WHERE id=? FOR UPDATE', [id]);
    return row;
  }
  async lockPreferences(tx: Transaction, userId: string) {
    const [row] = await tx.rows<{ push_enabled: number; generation: string }>('SELECT push_enabled,generation FROM notification_preferences WHERE user_id=? FOR UPDATE', [userId]);
    return row;
  }
  create(tx: Transaction, data: Prisma.push_subscriptionsUncheckedCreateInput) {
    return tx.prisma.push_subscriptions.create({ data, select: { id: true, generation: true } });
  }
  replace(tx: Transaction, id: string, userId: string, generation: bigint, data: Prisma.push_subscriptionsUncheckedUpdateManyInput) {
    return tx.prisma.push_subscriptions.updateMany({ where: { id, user_id: userId, generation }, data });
  }
  async revokeSession(tx: Transaction, sessionId: string) {
    return (await tx.prisma.push_subscriptions.updateMany({ where: { session_id: sessionId, revoked_at: null }, data: { revoked_at: await tx.now(), generation: { increment: 1n } } })).count;
  }
  async invalidate(tx: Transaction, id: string, generation: bigint) {
    return (await tx.prisma.push_subscriptions.updateMany({ where: { id, generation, revoked_at: null }, data: { revoked_at: await tx.now(), generation: { increment: 1n } } })).count;
  }
  async purgeMessage(tx: Transaction, roomId: string, messageId: string, limit: number): Promise<{ deleted: number; done: boolean }> {
    const fanout = await tx.prisma.jobs.findMany({ where: { purpose: 'PUSH', room_id: null, resource_id: messageId }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (fanout.length) return { deleted: (await tx.prisma.jobs.deleteMany({ where: { id: { in: fanout.map(row => row.id) }, purpose: 'PUSH', room_id: null, resource_id: messageId } })).count, done: false };
    const deliveries = await tx.prisma.push_deliveries.findMany({ where: { room_id: roomId, message_id: messageId }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (!deliveries.length) return { deleted: 0, done: true };
    const ids = deliveries.map(row => row.id);
    const jobs = await tx.prisma.jobs.findMany({ where: { purpose: 'PUSH', room_id: roomId, resource_id: { in: ids } }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (jobs.length) return { deleted: (await tx.prisma.jobs.deleteMany({ where: { id: { in: jobs.map(row => row.id) }, purpose: 'PUSH', room_id: roomId } })).count, done: false };
    return { deleted: (await tx.prisma.push_deliveries.deleteMany({ where: { id: { in: ids }, room_id: roomId, message_id: messageId } })).count, done: false };
  }
  async purgeAccount(tx: Transaction, userId: string, limit: number): Promise<{ deleted: number; done: boolean }> {
    // Polymorphic jobs.resource_id has no Prisma relation: this bounded join
    // applies content ownership BEFORE LIMIT without materializing all messages.
    const fanout = await tx.rows<{ id: string }>(`SELECT j.id FROM jobs j JOIN messages m ON m.id=j.resource_id LEFT JOIN messages root ON root.id=m.deletion_root_id AND root.room_id=m.room_id WHERE j.purpose='PUSH' AND j.room_id IS NULL AND (m.content_owner_user_id=? OR root.content_owner_user_id=?) ORDER BY j.id LIMIT ?`, [userId, userId, limit]);
    if (fanout.length) return { deleted: (await tx.prisma.jobs.deleteMany({ where: { id: { in: fanout.map(row => row.id) }, purpose: 'PUSH', room_id: null } })).count, done: false };
    const affectedDelivery: Prisma.push_deliveriesWhereInput = { OR: [
      { subscription: { user_id: userId } },
      { message: { content_owner_user_id: userId } },
      { message: { deletion_root: { content_owner_user_id: userId } } },
    ] };
    const deliveries = await tx.prisma.push_deliveries.findMany({ where: affectedDelivery, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    let deleted = 0;
    if (deliveries.length) {
      const ids = deliveries.map(row => row.id);
      const jobs = await tx.prisma.jobs.findMany({ where: { purpose: 'PUSH', resource_id: { in: ids } }, take: limit, orderBy: { id: 'asc' }, select: { id: true } });
      if (jobs.length) {
        deleted = (await tx.prisma.jobs.deleteMany({ where: { id: { in: jobs.map(row => row.id) }, purpose: 'PUSH' } })).count;
        return { deleted, done: false };
      }
      deleted = (await tx.prisma.push_deliveries.deleteMany({ where: { id: { in: ids } } })).count;
      return { deleted, done: false };
    }
    const subscriptions = await tx.prisma.push_subscriptions.findMany({ where: { user_id: userId, deliveries: { none: {} } }, take: limit, orderBy: { id: 'asc' }, select: { id: true } });
    if (subscriptions.length) {
      deleted = (await tx.prisma.push_subscriptions.deleteMany({ where: { id: { in: subscriptions.map(row => row.id) }, user_id: userId, deliveries: { none: {} } } })).count;
      return { deleted, done: false };
    }
    if (await tx.prisma.push_subscriptions.findFirst({ where: { user_id: userId }, select: { id: true } })) return { deleted, done: false };
    deleted = (await tx.prisma.notification_preferences.deleteMany({ where: { user_id: userId } })).count;
    return { deleted, done: true };
  }
}
