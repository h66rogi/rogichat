import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { NotificationsCoreService } from './notifications-core.service.js';
import { NotificationsRepository } from './notifications.repository.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationsController } from './notifications.controller.js';

// Static module is the transport-independent core port for workers/deletion.
@Module({ providers: [NotificationsRepository, NotificationsCoreService], exports: [NotificationsCoreService] })
export class NotificationsModule {
  static register(infrastructure: DynamicModule, authentication: DynamicModule, transport: DynamicModule): DynamicModule {
    return { module: NotificationsModule, imports: [infrastructure, authentication, transport],
      providers: [NotificationsService], controllers: [NotificationsController] };
  }
}
