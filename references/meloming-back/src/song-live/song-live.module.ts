import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChannelModule } from '../channel/channel.module';
import { SessionController } from './session.controller';
import { PublicSessionController } from './public-session.controller';
import { ManageSessionController } from './manage-session.controller';
import { InternalSessionController } from './internal-session.controller';
import { SessionService } from './session.service';
import { ChatGateway } from './chat/chat.gateway';
import { ChzzkChatService } from './chat/chzzk/chzzk-chat.service';
import { SoopChatService } from './chat/soop/soop-chat.service';
import { SongRequestOverlayFeatureGuard } from '../common/guards/song-request-overlay-feature.guard';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import { SongRequestModule } from '../song-request/song-request.module';
import { SongMatcherV2Module } from '../song-request/v2/song-matcher-v2.module';
import { SongbookAddModule } from '../songbook-add/songbook-add.module';
import { SyncRoomModule } from '../sync-room/sync-room.module';
import { MetricsModule } from '../metrics';
import { InternalChatDispatcherController } from './internal-chat-dispatcher.controller';
import { InternalMelomingLiveController } from './internal-meloming-live.controller';
import { SongLiveAdminController } from './admin/song-live-admin.controller';
import { SongLiveAdminService } from './admin/song-live-admin.service';

@Module({
  imports: [
    PrismaModule,
    ChannelModule,
    SongRequestModule,
    SongMatcherV2Module,
    SongbookAddModule,
    SyncRoomModule,
    MetricsModule,
  ],
  controllers: [
    SessionController,
    PublicSessionController,
    ManageSessionController,
    InternalSessionController,
    InternalChatDispatcherController,
    InternalMelomingLiveController,
    SongLiveAdminController,
  ],
  providers: [
    SessionService,
    ChatGateway,
    ChzzkChatService,
    SoopChatService,
    SongRequestOverlayFeatureGuard,
    InternalApiKeyGuard,
    SongLiveAdminService,
  ],
  exports: [SessionService],
})
export class SongLiveModule {}
