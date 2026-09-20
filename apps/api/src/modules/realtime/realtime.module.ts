import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { LifecycleState } from '../../common/lifecycle/lifecycle-state.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { Jobs } from '../jobs/jobs.service.js';
import { RealtimeService } from './realtime.service.js';
import { RealtimeRepository } from './realtime.repository.js';
import { RealtimeGateway } from './realtime.gateway.js';
@Module({})
export class RealtimeModule {
  static register(infrastructure: DynamicModule, authentication: DynamicModule, http = false): DynamicModule {
    return { module: RealtimeModule, imports: [infrastructure, authentication, JobsModule.register(infrastructure, 'api')],
      providers: [RealtimeService, RealtimeRepository, ...(http ? [{ provide: RealtimeGateway, inject: [HttpAdapterHost, RealtimeService, AUTH_CONFIG, LifecycleState, Jobs],
        useFactory: (host: HttpAdapterHost, service: RealtimeService, config: AuthConfig, lifecycle: LifecycleState, jobs: Jobs) => new RealtimeGateway(() => host.httpAdapter.getHttpServer(), service, config, lifecycle, jobs) }] : [])], exports: [RealtimeService] };
  }
}
