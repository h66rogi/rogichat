import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { MessagePurgeRepository } from './message-purge.repository.js';
import { MessagePurgeService } from './message-purge.service.js';

// Internal only. Not installed as a runtime PURGE handler until the remaining
// media/account/backup obligations have their own truthful continuation paths.
@Module({ imports: [NotificationsModule], providers: [MessagePurgeRepository, MessagePurgeService], exports: [MessagePurgeService] })
export class MessagePurgeModule {}
