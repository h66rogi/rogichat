import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SongRequestModule } from '../song-request.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { MetricsModule } from '../../metrics';
import { SongMatcherV2Service } from './song-matcher-v2.service';
import { TierClassifierService } from './tier-classifier.service';
import { GlobalSongCrossAliasService } from './global-song-cross-alias.service';
import { LlmMatcherService } from './llm-matcher.service';
import { AdminSongMatcherV2Controller } from './admin-song-matcher-v2.controller';

@Module({
  imports: [SongRequestModule, PrismaModule, ConfigModule, MetricsModule],
  controllers: [AdminSongMatcherV2Controller],
  providers: [
    SongMatcherV2Service,
    TierClassifierService,
    GlobalSongCrossAliasService,
    LlmMatcherService,
  ],
  exports: [
    SongMatcherV2Service,
    TierClassifierService,
    GlobalSongCrossAliasService,
    LlmMatcherService,
  ],
})
export class SongMatcherV2Module {}
