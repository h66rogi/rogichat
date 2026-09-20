import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { StickersCoreModule } from './stickers-core.module.js';
import { StickersController } from './stickers.controller.js';
import { StickersService } from './stickers.service.js';

@Module({})
export class StickersModule {
  static register(infrastructure: DynamicModule, authentication: DynamicModule): DynamicModule {
    return { module: StickersModule, imports: [infrastructure, authentication, StickersCoreModule],
      controllers: [StickersController], providers: [StickersService] };
  }
}
