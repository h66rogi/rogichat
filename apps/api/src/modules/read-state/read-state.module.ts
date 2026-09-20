import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ReadStateCoreModule } from './read-state-core.module.js';
import { ReadStateController } from './read-state.controller.js';
import { ReadStateService } from './read-state.service.js';

@Module({})
export class ReadStateModule {
  static register(infrastructure: DynamicModule, auth: DynamicModule): DynamicModule {
    return { module: ReadStateModule, imports: [infrastructure, auth, ReadStateCoreModule],
      controllers: [ReadStateController], providers: [ReadStateService], exports: [ReadStateService] };
  }
}
