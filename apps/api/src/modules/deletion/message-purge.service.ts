import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Transactions } from '../../infrastructure/database/transactions.js';
import { leaseValues } from '../jobs/jobs.policy.js';
import type { JobLease } from '../jobs/jobs.policy.js';
import { NotificationsCoreService } from '../notifications/notifications-core.service.js';
import { checkedDeletionIntent, encodeDeletionIntent } from './deletion-ledger.js';
import type { LedgerEnvironment } from './deletion-ledger.js';
import { MessagePurgeRepository } from './message-purge.repository.js';

export type MessagePurgeResult = { status: 'progress' | 'rows_purged' | 'deferred'; changed: number };

@Injectable()
export class MessagePurgeService {
  constructor(@Inject(MessagePurgeRepository) private readonly repository: MessagePurgeRepository,
    @Inject(NotificationsCoreService) private readonly notifications: NotificationsCoreService) {}

  // One fresh transaction per bounded step. No external I/O, hidden inherited RR
  // snapshot, whole-account sweep, job completion or LIVE_PURGED claim.
  async step(transactions: Transactions, environment: LedgerEnvironment, lease: JobLease, limit = 100): Promise<MessagePurgeResult> {
    leaseValues(lease);
    if (lease.purpose !== 'PURGE' || !lease.roomId || !lease.resourceId || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('invalid_message_purge_input');
    return transactions.write(async tx => {
      const intent = await this.repository.intent(tx, lease.resourceId!);
      if (!intent || intent.scope !== 'MESSAGE' || intent.room_id !== lease.roomId || intent.environment !== environment) throw new Error('invalid_message_purge_intent');
      const canonical = checkedDeletionIntent({ schemaVersion: 1, environment: intent.environment, requestId: intent.request_id,
        actorUserId: intent.actor_user_id, scope: intent.scope, targetId: intent.target_id, roomId: intent.room_id, requestedAt: intent.requested_at.toISOString() }, environment);
      if (!createHash('sha256').update(encodeDeletionIntent(canonical)).digest().equals(intent.ledger_sha256)) throw new Error('invalid_message_purge_intent');
      // Absence of an actor cannot erase a durable proof. Active actors are valid
      // for individual message deletion; this is not account-deletion admission.
      await this.repository.account(tx, intent.actor_user_id);
      const roomExists = await this.repository.room(tx, lease.roomId!);
      const root = roomExists ? await this.repository.message(tx, lease.roomId!, intent.target_id) : undefined;
      const request = await this.repository.request(tx, intent);
      const proof = await this.repository.proof(tx, intent.request_id);
      if (proof && (proof.environment !== intent.environment || proof.room_id !== intent.room_id || proof.target_id !== intent.target_id ||
          proof.actor_user_id !== intent.actor_user_id || proof.requested_at.toISOString() !== intent.requested_at.toISOString() ||
          !Buffer.from(proof.ledger_sha256).equals(intent.ledger_sha256))) throw new Error('message_purge_checkpoint_conflict');
      const finish = async (status: MessagePurgeResult['status'], changed = 0): Promise<MessagePurgeResult> => {
        if (!await this.repository.fence(tx, lease)) throw new Error('message_purge_lease_lost');
        return { status, changed };
      };
      if (!root) {
        // Missing data is not evidence. A completed proof must match the immutable
        // intent, and restored children must not be mistaken for a finished root.
        const copy = await this.repository.copy(tx, lease.roomId!, intent.target_id);
        if (!intent.blocked_at || !proof?.rows_purged_at || copy) return finish('deferred');
        // FK-free metadata and polymorphic jobs can be restored without the
        // content row. Exact proof authorizes only this target's cleanup, not a
        // room/account sweep or a claim about lost historical child provenance.
        const notifications = await this.notifications.purgeMessage(tx, lease.roomId!, intent.target_id, limit);
        if (!notifications.done) return finish('progress', notifications.deleted);
        const scrubbed = await this.repository.scrubReceipts(tx, lease.roomId!, intent.target_id, limit);
        if (scrubbed) return finish('progress', scrubbed);
        return finish('rows_purged');
      }
      if (!intent.blocked_at || !request || request.actor_user_id !== intent.actor_user_id || request.room_id !== intent.room_id ||
          request.message_id !== intent.target_id || request.requested_at.toISOString() !== intent.requested_at.toISOString()) return finish('deferred');
      if (!root.deleted_at || root.sender_user_id !== intent.actor_user_id) return finish('deferred');
      if (await this.repository.unsupported(tx, lease.roomId!, intent.target_id)) return finish('deferred');
      const candidate = await this.repository.copy(tx, lease.roomId!, intent.target_id);
      const message = candidate ? await this.repository.message(tx, lease.roomId!, candidate.id) : root;
      if (!message?.deleted_at || message.content_owner_user_id !== root.content_owner_user_id ||
          (candidate && message.deletion_root_id !== intent.target_id)) return finish('deferred');
      const id = message.id, roomId = lease.roomId!;
      // Let an independently admitted copy request produce its own exact proof.
      // Otherwise source-first deletion would strand that request at absent/no-proof.
      if (candidate && await this.repository.admittedCopyRequest(tx, roomId, id)) return finish('deferred');
      const notifications = await this.notifications.purgeMessage(tx, roomId, id, limit);
      if (!notifications.done) return finish('progress', notifications.deleted);
      const scrubbed = await this.repository.scrubReceipts(tx, roomId, id, limit);
      if (scrubbed) return finish('progress', scrubbed);
      const quotes = await this.repository.clearQuotes(tx, roomId, id, limit);
      if (quotes) return finish('progress', quotes);
      const publications = await this.repository.publications(tx, roomId, id, limit);
      if (publications) return finish('progress', publications);
      const reactions = await this.repository.reactions(tx, roomId, id, limit);
      if (reactions) return finish('progress', reactions);
      const sticker = await this.repository.sticker(tx, roomId, id);
      if (sticker) return finish('progress', sticker);
      const events = await this.repository.events(tx, roomId, id, limit);
      if (events) return finish('progress', events);
      if (await this.repository.remove(tx, roomId, id) !== 1) throw new Error('message_purge_row_conflict');
      if (candidate) return finish('progress', 1);
      // Root is last; all remaining dependency probes ran under its room lock.
      // This atomic proof covers physical message rows, not media/backups/account.
      await this.repository.recordProof(tx, intent);
      return finish('rows_purged', 1);
    });
  }
}
