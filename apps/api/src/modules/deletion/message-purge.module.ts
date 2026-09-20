import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { MessagePurgeRepository } from './message-purge.repository.js';
import { MessageDependenciesService } from './message-dependencies.service.js';
import { MessagePurgeService } from './message-purge.service.js';

// Internal bounded row-cleanup port. PurgeWorkerModule schedules this subset
// while retaining media/account/backup obligations as durable pending work.
@Module({ imports: [NotificationsModule], providers: [MessagePurgeRepository, MessageDependenciesService, MessagePurgeService], exports: [MessagePurgeService, MessageDependenciesService] })
export class MessagePurgeModule {}
