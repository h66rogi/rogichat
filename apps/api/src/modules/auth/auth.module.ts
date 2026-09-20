import { IdentityService } from './identity.service.js';
import { IdentityRepository } from './identity.repository.js';
import { LoginRepository } from './login.repository.js';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AuthFlow } from './auth-flow.service.js';
import { HttpBroker } from './broker.adapter.js';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { AuthService } from './auth.service.js';
import { AUTH_CONFIG } from './auth.tokens.js';
import { SessionRepository } from './session.repository.js';
import { SessionService } from './session.service.js';
import { AuthController } from './auth.controller.js';

export interface AuthModuleOptions {
  readonly config: AuthConfig;
  // Composition-root/test overrides only. Consumers receive AuthService, never these instances.
  readonly sessions?: SessionService;
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
        options.sessions === undefined ? { provide: SessionService, inject: [SessionRepository, AUTH_CONFIG],
          useFactory: (repository: SessionRepository, config: AuthConfig) => new SessionService(repository, config.audience, config.key) } : { provide: SessionService, useValue: options.sessions },
        { provide: HttpBroker, inject: [AUTH_CONFIG], useFactory: (config: AuthConfig) => new HttpBroker(config) },
        options.flow === undefined ? {
          provide: AuthFlow, inject: [SessionService, Transactions, AUTH_CONFIG, HttpBroker, LoginRepository, IdentityService],
          useFactory: (sessions: SessionService, transactions: Transactions, config: AuthConfig, broker: HttpBroker, repository: LoginRepository, identities: IdentityService) => new AuthFlow(sessions, transactions, config, broker, repository, identities),
        } : { provide: AuthFlow, useValue: options.flow },
        SessionRepository, LoginRepository, IdentityRepository, IdentityService, AuthService,
      ],
      exports: [AuthService, AUTH_CONFIG],
    };
  }
}
