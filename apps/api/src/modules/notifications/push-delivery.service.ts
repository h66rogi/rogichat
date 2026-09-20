import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { ApiError } from '../auth/auth-primitives.js';
import { AccessService } from '../access/access.service.js';
import { MessagesCoreService } from '../messages/messages-core.service.js';
import { JobsCoreService } from '../jobs/jobs-core.service.js';
import type { JobLease } from '../jobs/jobs.policy.js';
import { JobFailure } from '../jobs/jobs.service.js';
import { NotificationsCoreService } from './notifications-core.service.js';
import { PushDeliveryRepository } from './push-delivery.repository.js';
import { PushTransport } from './push-transport.js';

class StalePushLease extends Error {}
@Injectable()
export class PushDeliveryService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(PushDeliveryRepository) private readonly repository: PushDeliveryRepository,
    @Inject(NotificationsCoreService) private readonly notifications: NotificationsCoreService,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(MessagesCoreService) private readonly messages: MessagesCoreService,
    @Inject(JobsCoreService) private readonly jobs: JobsCoreService,
    @Inject(PushTransport) private readonly transport: PushTransport) {}
  private async finish(tx: Transaction, lease: JobLease) {
    // Domain writes (including gone-generation CAS) precede the job lock. A
    // stale fresh-clock fence throws so the entire transaction rolls back.
    if (!await this.repository.currentLease(tx, lease)) throw new StalePushLease();
    if (!await this.jobs.complete(tx, lease)) throw new StalePushLease();
  }
  private async authorize(tx: Transaction, lease: JobLease) {
    const intent = await this.repository.intent(tx, lease.resourceId!);
    if (!intent || intent.room_id !== lease.roomId) return null;
    const sub = await this.notifications.authorizeSubscription(tx, intent.subscription_id);
    if (!sub || sub.audience !== this.transport.config.audience || sub.generation !== intent.subscription_generation || sub.accountGeneration !== intent.account_generation || sub.preferenceGeneration !== intent.preference_generation) return null;
    try {
      if (!await this.repository.lockRoom(tx, intent.room_id)) return null;
      const viewer = await this.access.requireActiveMember(tx, intent.room_id, sub.userId);
      const message = await this.messages.load(tx, intent.room_id, intent.message_id);
      if (!message || !await this.messages.readable(tx, viewer, message)) return null;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'NOT_FOUND') return null;
      throw error;
    }
    return sub;
  }
  async consume(lease: JobLease): Promise<'completed' | 'lease_lost'> {
    if (lease.purpose !== 'PUSH' || !lease.resourceId || !lease.roomId) throw new JobFailure('INVALID_RESOURCE', true);
    try {
      const initial = await this.transactions.write(async tx => {
        const sub = await this.authorize(tx, lease);
        if (!sub) { await this.finish(tx, lease); return null; }
        if (!await this.repository.admitLease(tx, lease)) throw new StalePushLease();
        return sub;
      });
      if (!initial) return 'completed';
      let prepared;
      try { prepared = await this.transport.prepare({ endpoint: initial.endpoint, p256dh: initial.p256dh, auth_secret: initial.auth }); }
      catch (error) {
        if (error instanceof Error && ['invalid_push_endpoint', 'invalid_push_subscription'].includes(error.message)) throw new JobFailure('INVALID_RESOURCE', true);
        throw new JobFailure('TEMPORARY_UNAVAILABLE');
      }
      if (!prepared) throw new JobFailure('SOURCE_UNAVAILABLE');
      const admitted = await this.transactions.write(async tx => {
        const current = await this.authorize(tx, lease);
        if (!current || current.id !== initial.id || current.generation !== initial.generation || current.endpoint !== initial.endpoint || current.p256dh !== initial.p256dh || current.auth !== initial.auth) { await this.finish(tx, lease); return false; }
        if (!await this.repository.admitLease(tx, lease)) throw new StalePushLease();
        return true;
      });
      if (!admitted) return 'completed';
      // Final admission boundary: a later revocation cannot recall this request.
      // The encrypted body is only a wake; ACK is not device receipt/read proof.
      const result = await prepared.send();
      if (result.kind === 'retry') throw new JobFailure('TEMPORARY_UNAVAILABLE');
      if (result.kind === 'unavailable') throw new JobFailure('SOURCE_UNAVAILABLE');
      if (result.kind === 'rejected') throw new JobFailure('PERMANENT_FAILURE', true);
      await this.transactions.write(async tx => {
        if (result.kind === 'gone') await this.notifications.invalidateSubscription(tx, initial.id, initial.generation);
        await this.finish(tx, lease);
      });
      return 'completed';
    } catch (error) { if (error instanceof StalePushLease) return 'lease_lost'; throw error; }
  }
}
