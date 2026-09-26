import { DeletionModule } from '../deletion/deletion.module.js';
import type { DeletionOptions } from '../deletion/deletion.module.js';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';
import { MessagesCoreModule } from './messages-core.module.js';
import { AccessModule } from '../access/access.module.js';
import { MessageCommandsController } from './message-commands.controller.js';
import { MessageCommandsService } from './message-commands.service.js';
import { MessageCommandsRepository } from './message-commands.repository.js';
import { MessageSearchController } from './message-search.controller.js';
import { MessageSearchService } from './message-search.service.js';
import { MessageSearchRepository } from './message-search.repository.js';

@Module({})
export class MessagesModule {
  static register(infrastructure: DynamicModule, auth: DynamicModule, deletion?: DeletionOptions): DynamicModule {
    return { module: MessagesModule, imports: [infrastructure, auth, MessagesCoreModule, AccessModule, DeletionModule.register(infrastructure, deletion)],
      controllers: [MessagesController, MessageCommandsController, MessageSearchController], providers: [MessagesService, MessageCommandsService, MessageCommandsRepository, MessageSearchService, MessageSearchRepository], exports: [MessagesService] };
  }
}
