import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { HealthController } from './health.controller.js';

@Module({})
export class HealthModule {
  static register(database: DynamicModule): DynamicModule {
    return { module: HealthModule, imports: [database], controllers: [HealthController] };
  }
}
