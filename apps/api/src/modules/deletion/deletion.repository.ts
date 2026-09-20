import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { DeletionReceipt } from './deletion-ledger.js';

@Injectable()
export class DeletionRepository {
  async checkpoint(tx: Transaction, receipt: DeletionReceipt) {
    const { intent } = receipt;
    const data = { request_id: intent.requestId, environment: intent.environment, actor_user_id: intent.actorUserId,
    scope: intent.scope, target_id: intent.targetId, room_id: intent.roomId, requested_at: new Date(intent.requestedAt),
    ledger_sha256: new Uint8Array(Buffer.from(receipt.sha256, 'hex')) };
    // Serialize the immutable checkpoint before domain/job locks. No FK to a restored parent.
    await tx.prisma.deletion_intents.createMany({ data: [data], skipDuplicates: true });
    // Bound current-row lock: serialize concurrent receipt application before domain/job locks.
    await tx.rows('SELECT request_id FROM deletion_intents WHERE request_id=? FOR UPDATE', [intent.requestId]);
    const checkpoint = await tx.prisma.deletion_intents.findUniqueOrThrow({ where: { request_id: intent.requestId },
    select: { environment: true, actor_user_id: true, scope: true, target_id: true, room_id: true, requested_at: true, ledger_sha256: true, blocked_at: true } });
    if (checkpoint.environment !== intent.environment || checkpoint.actor_user_id !== intent.actorUserId || checkpoint.scope !== intent.scope ||
      checkpoint.target_id !== intent.targetId || checkpoint.room_id !== intent.roomId || checkpoint.requested_at.toISOString() !== intent.requestedAt ||
      Buffer.from(checkpoint.ledger_sha256).toString('hex') !== receipt.sha256) throw new Error('deletion_checkpoint_conflict');
    return checkpoint;
  }
  async markBlocked(tx: Transaction, requestId: string, blockedAt: Date | null) {
    await tx.prisma.deletion_intents.update({ where: { request_id: requestId }, data: { blocked_at: blockedAt }, select: { request_id: true } });
  }
}
