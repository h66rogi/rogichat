import { Module } from '@nestjs/common';
import { MessagesCoreService } from './messages-core.service.js';
import { MessagesRepository } from './messages.repository.js';
import { AccessModule } from '../access/access.module.js';

// Separate entrypoint: worker imports do not load HTTP controllers or authentication providers.
@Module({ imports: [AccessModule], providers: [MessagesRepository, MessagesCoreService], exports: [MessagesCoreService] })
export class MessagesCoreModule {}
