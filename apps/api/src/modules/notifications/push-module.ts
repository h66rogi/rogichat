import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { MessagesCoreModule } from '../messages/messages-core.module.js';
import { JobsCoreModule } from '../jobs/jobs-core.module.js';
import { PushEndpointPolicy, PushTransport } from './push-transport.js';
import type { PushConfig } from './push-transport.js';
import { NotificationsModule } from './notifications.module.js';
import { PushDeliveryService } from './push-delivery.service.js';
import { PushDeliveryRepository } from './push-delivery.repository.js';
import { NativePushTransport } from './native-push-transport.js';

@Module({})
export class PushTransportModule {
  static register(config: PushConfig): DynamicModule {
    return { module: PushTransportModule, providers: [PushEndpointPolicy,
      { provide: NativePushTransport, useFactory: () => new NativePushTransport(config.native) },
      { provide: PushTransport, inject: [PushEndpointPolicy], useFactory: (policy: PushEndpointPolicy) => new PushTransport(config, policy) }], exports: [PushEndpointPolicy, PushTransport, NativePushTransport] };
  }
}
@Module({})
export class PushModule {
  static register(infrastructure: DynamicModule, notificationsCore: DynamicModule | typeof NotificationsModule, transport: DynamicModule): DynamicModule {
    return { module: PushModule, imports: [infrastructure, notificationsCore, transport, AccessModule, MessagesCoreModule, JobsCoreModule], providers: [PushDeliveryRepository, PushDeliveryService], exports: [PushDeliveryService] };
  }
}
