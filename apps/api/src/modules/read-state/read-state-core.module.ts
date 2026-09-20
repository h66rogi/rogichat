import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { MessagesCoreModule } from '../messages/messages-core.module.js';
import { ReadStateCoreService } from './read-state-core.service.js';
import { ReadStateRepository } from './read-state.repository.js';

// M10 imports this entrypoint without loading HTTP or authentication providers.
@Module({ imports: [AccessModule, MessagesCoreModule], providers: [ReadStateRepository, ReadStateCoreService], exports: [ReadStateCoreService] })
export class ReadStateCoreModule {}
