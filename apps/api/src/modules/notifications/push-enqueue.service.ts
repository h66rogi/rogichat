import { Inject, Injectable, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { identifier } from '../../common/validation/identifier.js';
import { digest } from '../auth/auth-primitives.js';
import { JobsCoreService } from '../jobs/jobs-core.service.js';
import { PushEnqueueRepository } from './push-enqueue.repository.js';
import { JobsCoreModule } from '../jobs/jobs-core.module.js';

// Intent production does not authorize network I/O. Caller owns the message
// transaction; the consumer checks every snapshot and current ACL before send.
@Injectable()
export class PushEnqueueService {
  constructor(@Inject(JobsCoreService) private readonly jobs: JobsCoreService, @Inject(PushEnqueueRepository) private readonly repository: PushEnqueueRepository) {}
  async enqueue(tx: Transaction, input: { messageId: string; subscriptionId: string }): Promise<string | null> {
    const messageId = identifier(input.messageId); const subscriptionId = identifier(input.subscriptionId);
    const current = await this.repository.eligible(tx, messageId, subscriptionId);
    if (!current) return null;
    const where = { subscription_id: subscriptionId, message_id: messageId, subscription_generation: BigInt(current.generation), preference_generation: BigInt(current.preference_generation) };
    await tx.prisma.push_deliveries.createMany({ data: [{ id: randomUUID(), ...where, room_id: current.room_id, account_generation: BigInt(current.account_generation) }], skipDuplicates: true });
    const intent = await tx.prisma.push_deliveries.findUnique({ where: { subscription_id_message_id_subscription_generation_preference_generation: where }, select: { id: true } });
    if (!intent) throw new Error('push_intent_unavailable');
    await this.jobs.enqueue(tx, { purpose: 'PUSH', roomId: current.room_id, resourceId: intent.id, dedupeKey: digest(`push:${intent.id}`) });
    return intent.id;
  }
}
@Module({ imports: [JobsCoreModule], providers: [PushEnqueueRepository, PushEnqueueService], exports: [PushEnqueueService] })
export class PushEnqueueModule {}
