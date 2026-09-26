import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { NotificationsCoreService } from './notifications-core.service.js';
import { NotificationsRepository } from './notifications.repository.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NativePushService } from './native-push.service.js';
import { NativePushRepository } from './native-push.repository.js';
import { NativePushController } from './native-push.controller.js';
import { NotificationInboxRepository } from './notification-inbox.repository.js';
import { NotificationInboxService } from './notification-inbox.service.js';

// Static module is the transport-independent core port for workers/deletion.
@Module({ providers: [NotificationsRepository, NotificationsCoreService], exports: [NotificationsCoreService] })
export class NotificationsModule {
  static register(infrastructure: DynamicModule, authentication: DynamicModule, transport: DynamicModule): DynamicModule {
    return { module: NotificationsModule, imports: [infrastructure, authentication, transport],
      providers: [NotificationsService, NativePushService, NativePushRepository, NotificationInboxRepository, NotificationInboxService], controllers: [NotificationsController, NativePushController] };
  }
}
