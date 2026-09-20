import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { Database } from './database.js';
import type { LifecycleState } from './common/lifecycle/lifecycle-state.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AUTH } from './auth-http.js';
import type { AuthRuntime } from './auth-http.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CommunityController } from './community-http.js';
import { MessagesModule } from './modules/messages/messages.module.js';
import { SyncController } from './sync-http.js';
import { InteractionsController } from './interactions-http.js';

// Migration composition adapter. R2 converts the remaining controllers into feature modules;
// R4 removes externally assembled runtime inputs from the production bootstrap.
@Module({})
export class AppModule {
  static register(database: Database, lifecycle: LifecycleState, auth?: AuthRuntime): DynamicModule {
    const infrastructure = DatabaseModule.register({ database, lifecycle, externallyOwned: true,
      ...(auth ? { transactions: auth.sessions.transactions } : {}) });
    const authentication = auth ? AuthModule.register(infrastructure, auth) : undefined;
    return {
      module: AppModule,
      imports: [infrastructure, HealthModule.register(infrastructure), ...(authentication ? [authentication, MessagesModule.register(infrastructure, authentication)] : [])],
      controllers: auth ? [CommunityController, SyncController, InteractionsController] : [],
      providers: [...(auth ? [{ provide: AUTH, useValue: auth }] : [])],
    };
  }
}
