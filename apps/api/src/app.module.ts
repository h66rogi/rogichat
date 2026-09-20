import type { DeletionOptions } from './modules/deletion/deletion.module.js';
import type { RuntimeSettings, MediaSettings } from './infrastructure/config/runtime-settings.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { Database } from './infrastructure/database/database.js';
import type { LifecycleState } from './common/lifecycle/lifecycle-state.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { HealthModule } from './modules/health/health.module.js';
import type { AuthModuleOptions } from './modules/auth/auth.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { RoomsModule } from './modules/rooms/rooms.module.js';
import { MessagesModule } from './modules/messages/messages.module.js';
import { SyncModule } from './modules/sync/sync.module.js';
import { ReactionsModule } from './modules/reactions/reactions.module.js';
import { PublicationsModule } from './modules/publications/publications.module.js';
import { MediaModule } from './modules/media/media.module.js';
import type { MediaOptions } from './modules/media/media.module.js';

// Tests override providers through the same feature graph used by production.
@Module({})
export class AppModule {
  static register(database: Database, lifecycle: LifecycleState, auth?: AuthModuleOptions, media?: MediaOptions, deletion?: DeletionOptions): DynamicModule {
    const infrastructure = DatabaseModule.register({ database, lifecycle, externallyOwned: true });
    return this.compose(infrastructure, auth, media, deletion);
  }
  static production(settings: RuntimeSettings): DynamicModule {
    return this.compose(DatabaseModule.register({ config: settings.config }), settings.auth ? { config: settings.auth } : undefined, settings.media, settings.deletion);
  }
  private static compose(infrastructure: DynamicModule, auth?: AuthModuleOptions, media?: MediaOptions | MediaSettings, deletion?: DeletionOptions): DynamicModule {
    const authentication = auth ? AuthModule.register(infrastructure, auth) : undefined;
    return {
      module: AppModule,
      imports: [infrastructure, HealthModule.register(infrastructure), ...(authentication ? [authentication, MessagesModule.register(infrastructure, authentication, deletion), UsersModule.register(infrastructure, authentication), RoomsModule.register(infrastructure, authentication), SyncModule.register(infrastructure, authentication), ReactionsModule.register(infrastructure, authentication), PublicationsModule.register(infrastructure, authentication), RealtimeModule.register(infrastructure, authentication, true), ...(media ? [MediaModule.register(infrastructure, authentication, media)] : [])] : [])],
    };
  }
}
