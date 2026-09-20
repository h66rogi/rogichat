import { DeletionModule } from '../deletion/deletion.module.js';
import type { DeletionOptions } from '../deletion/deletion.module.js';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';
import { MessagesCoreModule } from './messages-core.module.js';

@Module({})
export class MessagesModule {
  static register(infrastructure: DynamicModule, auth: DynamicModule, deletion?: DeletionOptions): DynamicModule {
    return { module: MessagesModule, imports: [infrastructure, auth, MessagesCoreModule, DeletionModule.register(infrastructure, deletion)],
      controllers: [MessagesController], providers: [MessagesService], exports: [MessagesService] };
  }
}
