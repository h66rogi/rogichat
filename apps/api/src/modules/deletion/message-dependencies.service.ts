import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { NotificationsCoreService } from '../notifications/notifications-core.service.js';
import { MessagePurgeRepository } from './message-purge.repository.js';

/** Shared transaction-scoped cleanup; caller owns receipt, room lock and lease fence. */
@Injectable()
export class MessageDependenciesService {
  constructor(@Inject(MessagePurgeRepository) private readonly repository: MessagePurgeRepository,
    @Inject(NotificationsCoreService) private readonly notifications: NotificationsCoreService) {}
  async page(tx: Transaction, roomId: string, messageId: string, limit: number): Promise<{ changed: number; done: boolean }> {
    const notifications = await this.notifications.purgeMessage(tx, roomId, messageId, limit);
    if (!notifications.done) return { changed: notifications.deleted, done: false };
    for (const operation of [this.repository.scrubReceipts, this.repository.clearQuotes, this.repository.publications,
      this.repository.reactions, this.repository.sticker, this.repository.events]) {
      const changed = await operation.call(this.repository, tx, roomId, messageId, limit);
      if (changed) return { changed, done: false };
    }
    return { changed: 0, done: true };
  }
}
