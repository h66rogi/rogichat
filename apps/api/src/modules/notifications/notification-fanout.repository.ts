import { chatUser } from '../auth/chat-entitlement.js';
import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { JobLease } from '../jobs/jobs.policy.js';

@Injectable()
export class NotificationFanoutRepository {
  async candidates(tx: Transaction, messageId: string, audience: string, after: string | undefined) {
    const source = await tx.prisma.messages.findFirst({ where: { id: messageId, deleted_at: null, moderated: false,
      content_owner: { status: 'ACTIVE' }, stream: { room: { status: 'ACTIVE' } } },
    select: { id: true, room_id: true, created_at: true, sender: { select: { user_id: true } } } });
    if (!source) return [];
    const now = await tx.now();
    // Discovery is deliberately not send authorization. The enqueue and delivery
    // ports recheck current state. Keyset pages bound memory and each write below.
    return tx.prisma.push_subscriptions.findMany({ where: {
      ...(after ? { id: { gt: after } } : {}), audience, revoked_at: null,
      updated_at: { lte: source.created_at }, user_id: { not: source.sender.user_id },
      session: { revoked_at: null, expires_at: { gt: now }, audience },
      OR: [
        { provider: 'WEB', session: { transport: 'WEB', client_id: null } },
        { provider: 'APNS', native_client_id: 'ios', session: { transport: 'NATIVE', client_id: 'ios' } },
        { provider: 'FCM', native_client_id: 'android', session: { transport: 'NATIVE', client_id: 'android' } },
      ],
      user: { ...chatUser(await tx.now()),
        notification_preferences: { push_enabled: true, updated_at: { lte: source.created_at } },
        members: { some: { room_id: source.room_id, status: 'ACTIVE', active_period: { is: { left_at: null } } } } },
      deliveries: { none: { message_id: source.id } },
    }, select: { id: true }, orderBy: { id: 'asc' }, take: 50 });
  }

  async fence(tx: Transaction, lease: JobLease): Promise<boolean> {
    // Lock first: the UPDATE may otherwise wait past expiry while retaining a
    // timestamp sampled before its lock wait. Clock sampling follows acquisition.
    if (!(await tx.rows('SELECT id FROM jobs WHERE id=? FOR UPDATE', [lease.id])).length) return false;
    const now = await tx.now();
    // Domain locks precede this queue fence. Stale workers roll back intent
    // creation; valid workers extend the lease without external I/O in the tx.
    return (await tx.prisma.jobs.updateMany({ where: {
      id: lease.id, purpose: 'PUSH', room_id: null, resource_id: lease.resourceId,
      state: 'RUNNING', generation: lease.generation, lease_owner: lease.leaseOwner,
      lease_token: lease.leaseToken, lease_until: { gt: now },
    }, data: { lease_until: new Date(now.getTime() + 30_000) } })).count === 1;
  }
}
