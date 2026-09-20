import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { PublicationsCoreModule } from './publications-core.module.js';
import { PublicationsService } from './publications.service.js';
import { PublicationsController } from './publications.controller.js';
@Module({})
export class PublicationsModule {
  static register(infrastructure: DynamicModule, authentication: DynamicModule): DynamicModule {
    return { module: PublicationsModule, imports: [infrastructure, authentication, PublicationsCoreModule], providers: [PublicationsService], controllers: [PublicationsController] };
  }
}
