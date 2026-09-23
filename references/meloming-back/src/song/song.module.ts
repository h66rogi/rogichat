import { Module } from '@nestjs/common';
import { SongService } from './song.service';
import { SongController } from './song.controller';
import { ChannelModule } from '../channel/channel.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SongAlbumArtService } from './song-album-art.service';
import { SongCacheService } from './song-cache.service';
import { SongHelperService } from './song-helper.service';
import { SongQueryService } from './song-query.service';
import { SongMutationService } from './song-mutation.service';
import { SongExportService } from './song-export.service';
import { SongSuggestService } from './song-suggest.service';
import { SongAddRequestService } from './song-add-request.service';
import { SongAddRequestController } from './song-add-request.controller';
import { PointsModule } from '../points/points.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SongAutocompleteService } from './song-autocomplete.service';
import { DistributedLockModule } from '../common/distributed-lock/distributed-lock.module';
import { UploadModule } from '../upload/upload.module';
import { SongMrVideoController } from './song-mr-video.controller';
import { SongMrVideoService } from './song-mr-video.service';

@Module({
  imports: [
    ChannelModule,
    PrismaModule,
    PointsModule,
    NotificationsModule,
    DistributedLockModule,
    UploadModule,
  ],
  providers: [
    SongService,
    SongAlbumArtService,
    SongCacheService,
    SongHelperService,
    SongQueryService,
    SongMutationService,
    SongExportService,
    SongSuggestService,
    SongAutocompleteService,
    SongAddRequestService,
    SongMrVideoService,
  ],
  controllers: [
    SongController,
    SongAddRequestController,
    SongMrVideoController,
  ],
  exports: [SongQueryService, SongMutationService],
})
export class SongModule {}
