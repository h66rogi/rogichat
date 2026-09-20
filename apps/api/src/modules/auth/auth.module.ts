import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { AuthConfig } from '../../auth-config.js';
import { Sessions } from '../../auth-core.js';
import { AuthFlow } from '../../auth-flow.js';
import { HttpBroker } from '../../broker.js';
import { Transactions } from '../../transactions.js';
import { AuthService } from './auth.service.js';
import { AUTH_CONFIG } from './auth.tokens.js';
import { SessionRepository } from './session.repository.js';
import { SessionService } from './session.service.js';
import { AuthController } from './auth.controller.js';

export interface AuthModuleOptions {
  readonly config: AuthConfig;
  // Composition-root/test overrides only. Consumers receive AuthService, never these instances.
  readonly sessions?: Sessions;
  readonly flow?: AuthFlow;
}

@Module({})
export class AuthModule {
  static register(infrastructure: DynamicModule, options: AuthModuleOptions): DynamicModule {
    return {
      module: AuthModule,
      imports: [infrastructure],
      controllers: [AuthController],
      providers: [
        { provide: AUTH_CONFIG, useValue: options.config },
        { provide: SessionService, inject: [SessionRepository, AUTH_CONFIG],
          useFactory: (repository: SessionRepository, config: AuthConfig) => new SessionService(repository, config.audience, config.key) },
        options.sessions === undefined ? {
          provide: Sessions, inject: [Transactions, AUTH_CONFIG, SessionService],
          useFactory: (transactions: Transactions, config: AuthConfig, service: SessionService) => new Sessions(transactions, config.audience, config.key, service),
        } : { provide: Sessions, useValue: options.sessions },
        { provide: HttpBroker, inject: [AUTH_CONFIG], useFactory: (config: AuthConfig) => new HttpBroker(config) },
        options.flow === undefined ? {
          provide: AuthFlow, inject: [Sessions, AUTH_CONFIG, HttpBroker],
          useFactory: (sessions: Sessions, config: AuthConfig, broker: HttpBroker) => new AuthFlow(sessions, config, broker),
        } : { provide: AuthFlow, useValue: options.flow },
        SessionRepository, AuthService,
      ],
      exports: [AuthService, AUTH_CONFIG],
    };
  }
}
