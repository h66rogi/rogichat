import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { AccountMediaService } from '../media/account-media.service.js';
import { AccountContentRepository } from './account-content.repository.js';
import { AccountCleanupRepository } from './account-cleanup.repository.js';
import type { DeletionReceipt } from './deletion-ledger.js';
import { MessageDependenciesService } from './message-dependencies.service.js';

/** Exported ACCOUNT receipt port; never fabricates individual MESSAGE requests. */
@Injectable()
export class AccountContentService {
  constructor(@Inject(AccountContentRepository) private readonly repository: AccountContentRepository,
    @Inject(AccountCleanupRepository) private readonly authority: AccountCleanupRepository,
    @Inject(MessageDependenciesService) private readonly dependencies: MessageDependenciesService,
    @Inject(AccountMediaService) private readonly media: AccountMediaService) {}
  async page(tx: Transaction, receipt: DeletionReceipt, limit: number) {
    await this.authority.authorize(tx, receipt);
    const message = await this.repository.candidate(tx, receipt.intent.targetId);
    if (!message) {
      const restored = await this.repository.restoredDependencies(tx, receipt);
      if (!restored) return null;
      const dependencies = await this.dependencies.page(tx, restored.room_id, restored.message_id, limit);
      return { phase: 'content' as const, changed: dependencies.changed, hasMore: !dependencies.done };
    }
    // Another scope may remove discovery's row while we wait for its room.
    // Yield without acquiring a second room in this transaction.
    if ('missing' in message) return { phase: 'content' as const, changed: 0, hasMore: true };
    await this.repository.checkpoint(tx, receipt, message);
    const finish = async (changed: number) => {
      if (changed) await this.repository.epoch(tx, message.room_id);
      return { phase: 'content' as const, changed, hasMore: true };
    };
    const tombstoned = await this.repository.tombstone(tx, message.id, receipt.intent.targetId);
    if (tombstoned) return finish(tombstoned);
    // One asset lock per transaction. Snapshot the ownership basis and revoke
    // before detaching even one reference; objects stay for the media worker.
    const [attachment] = await this.repository.attachments(tx, message.room_id, message.id, 1);
    if (attachment) {
      await this.media.admit(tx, receipt, { kind: 'ATTACHMENT', id: message.id, assetId: attachment.asset_id, roomId: message.room_id });
      await this.repository.detachAttachment(tx, message.room_id, attachment.id);
      return finish(1);
    }
    const publication = await this.repository.publication(tx, message.room_id, message.id);
    if (publication) {
      await this.media.admit(tx, receipt, { kind: 'PUBLICATION', id: message.id, assetId: publication.destination_asset_id, roomId: message.room_id });
      await this.repository.detachPublication(tx, message.room_id, publication.id);
      return finish(1);
    }
    const dependencies = await this.dependencies.page(tx, message.room_id, message.id, limit);
    if (!dependencies.done) return finish(dependencies.changed);
    return finish(await this.repository.remove(tx, receipt, message.room_id, message.id) ? 1 : 0);
  }
}
