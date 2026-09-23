import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { MetricsModule } from '../metrics';
import { SongMatcherV2Module } from '../song-request/v2/song-matcher-v2.module';
import { AuthModule } from '../auth/auth.module';
import { SongModule } from '../song/song.module';
import { SongRequestModule } from '../song-request/song-request.module';
import { ChannelModule } from '../channel/channel.module';
import { GlobalSongMatcherService } from './global-song-matcher.service';
import { LlmCategoryDifficultyJudgeService } from './llm-category-difficulty-judge.service';
import { SongbookAddService } from './songbook-add.service';
import { EnsureChannelSongService } from './ensure-channel-song.service';
import { SongbookAddAdminController } from './admin/songbook-add-admin.controller';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    MetricsModule,
    SongMatcherV2Module,
    AuthModule,
    SongModule,
    SongRequestModule,
    ChannelModule,
  ],
  controllers: [SongbookAddAdminController],
  providers: [
    GlobalSongMatcherService,
    LlmCategoryDifficultyJudgeService,
    SongbookAddService,
    EnsureChannelSongService,
  ],
  exports: [SongbookAddService, EnsureChannelSongService],
})
export class SongbookAddModule {}
