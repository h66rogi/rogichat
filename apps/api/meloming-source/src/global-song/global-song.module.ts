import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DistributedLockModule } from '../common/distributed-lock/distributed-lock.module';
import { SongModule } from '../song/song.module';
import { ChannelModule } from '../channel/channel.module';
import { LiveStatusModule } from '../live-status/live-status.module';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import { GlobalSongController } from './global-song.controller';
import { GlobalArtistController } from './global-artist.controller';
import { GlobalArtistPublicService } from './global-artist-public.service';
import { GlobalArtistPopularService } from './global-artist-popular.service';
import { GlobalSongMatcherService } from './global-song-matcher.service';
import { GlobalSongRedisService } from './global-song-redis.service';
import { GlobalSongIndexerService } from './global-song-indexer.service';
import { GlobalSongRebuildService } from './global-song-rebuild.service';
import { GlobalSongBackfillService } from './global-song-backfill.service';
import { GlobalSongQuickAddService } from './global-song-quick-add.service';
import { GlobalSongRecommendationService } from './global-song-recommendation.service';
import { GlobalSongPublicService } from './global-song-public.service';
import { GlobalSongPopularService } from './global-song-popular.service';
import { UnmappedSongReconciliationService } from './unmapped-song-reconciliation.service';
import { CFComputationService } from './cf/cf-computation.service';
import { GlobalSongMergeService } from './global-song-merge.service';
import { GlobalArtistMergeService } from './global-artist-merge.service';
import { AdminCanonicalNameDupsController } from './admin/admin-canonical-name-dups.controller';
import { AdminCanonicalNameDupsService } from './admin/admin-canonical-name-dups.service';
import { AdminArtistsController } from './admin/admin-artists.controller';
import { AdminArtistsService } from './admin/admin-artists.service';
import { AdminSongsController } from './admin/admin-songs.controller';
import { AdminSongsService } from './admin/admin-songs.service';
import { AdminUnmappedSongsController } from './admin/admin-unmapped-songs.controller';
import { AdminUnmappedSongsService } from './admin/admin-unmapped-songs.service';
import { AdminNormTitleDupsController } from './admin/admin-norm-title-dups.controller';
import { AdminNormTitleDupsService } from './admin/admin-norm-title-dups.service';
import { AdminFuzzyClustersController } from './admin/admin-fuzzy-clusters.controller';
import { AdminFuzzyClustersService } from './admin/admin-fuzzy-clusters.service';
import { AdminMusixmatchController } from './admin/admin-musixmatch.controller';
import { AdminMusixmatchService } from './admin/admin-musixmatch.service';
import { MusixmatchModule } from './musixmatch/musixmatch.module';

@Module({
  imports: [
    PrismaModule,
    DistributedLockModule,
    SongModule,
    ChannelModule,
    LiveStatusModule,
    MusixmatchModule,
  ],
  controllers: [
    GlobalSongController,
    GlobalArtistController,
    AdminCanonicalNameDupsController,
    AdminArtistsController,
    AdminSongsController,
    AdminUnmappedSongsController,
    AdminNormTitleDupsController,
    AdminFuzzyClustersController,
    AdminMusixmatchController,
  ],
  providers: [
    GlobalSongMatcherService,
    GlobalSongRedisService,
    GlobalSongIndexerService,
    GlobalSongRebuildService,
    GlobalSongBackfillService,
    GlobalSongQuickAddService,
    GlobalSongRecommendationService,
    GlobalSongPublicService,
    GlobalSongPopularService,
    GlobalArtistPublicService,
    GlobalArtistPopularService,
    UnmappedSongReconciliationService,
    CFComputationService,
    GlobalSongMergeService,
    GlobalArtistMergeService,
    AdminCanonicalNameDupsService,
    AdminArtistsService,
    AdminSongsService,
    AdminUnmappedSongsService,
    AdminNormTitleDupsService,
    AdminFuzzyClustersService,
    AdminMusixmatchService,
    InternalApiKeyGuard,
  ],
  exports: [
    GlobalSongMatcherService,
    GlobalSongRedisService,
    GlobalSongIndexerService,
    GlobalSongRebuildService,
    GlobalSongQuickAddService,
    GlobalSongRecommendationService,
    GlobalSongPublicService,
    GlobalSongMergeService,
    GlobalArtistMergeService,
  ],
})
export class GlobalSongModule {}
