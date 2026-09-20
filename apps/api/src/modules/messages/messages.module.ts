import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';
import { MessagesCoreModule } from './messages-core.module.js';

@Module({})
export class MessagesModule {
  static register(infrastructure: DynamicModule, auth: DynamicModule): DynamicModule {
    return { module: MessagesModule, imports: [infrastructure, auth, MessagesCoreModule],
      controllers: [MessagesController], providers: [MessagesService], exports: [MessagesService] };
  }
}
