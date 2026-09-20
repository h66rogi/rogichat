import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ReactionsCoreModule } from './reactions-core.module.js';
import { ReactionsService } from './reactions.service.js';
import { ReactionsController } from './reactions.controller.js';
@Module({})
export class ReactionsModule {
  static register(infrastructure: DynamicModule, authentication: DynamicModule): DynamicModule {
    return { module: ReactionsModule, imports: [infrastructure, authentication, ReactionsCoreModule], providers: [ReactionsService], controllers: [ReactionsController] };
  }
}
