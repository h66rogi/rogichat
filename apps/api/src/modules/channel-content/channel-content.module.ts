import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ChannelContentController } from './channel-content.controller.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { ChannelScheduleService } from './schedule.service.js';
import { WardrobeService } from './wardrobe.service.js';
import { SongbookService } from './songbook.service.js';
import { RecurringScheduleService, RecurringScheduleRefresh } from './recurring-schedule.service.js';
import { MelomingWardrobeController } from './meloming-wardrobe.controller.js';
import { MelomingChannelController } from './meloming-channel.controller.js';
import { MelomingChannelService } from './meloming-channel.service.js';
import { MelomingScheduleController } from './meloming-schedule.controller.js';
import { MelomingProfileController } from './meloming-profile.controller.js';
import { MelomingProfileService } from './meloming-profile.service.js';
import { MelomingSongsController, MelomingFavoriteSongsController } from './meloming-songs.controller.js';
import { MelomingArtistsController, MelomingCategoriesController } from './meloming-song-taxonomy.controller.js';
import { MelomingUserController } from './meloming-user.controller.js';
import { MelomingUserService } from './meloming-user.service.js';
import { MelomingMusicbookSettingsService } from './meloming-musicbook-settings.service.js';
import { MelomingCategoryService } from './meloming-category.service.js';
import { MelomingArtistService } from './meloming-artist.service.js';
import { MelomingSongAddRequestController } from './meloming-song-add-request.controller.js';
import { MelomingSongAddRequestService } from './meloming-song-add-request.service.js';
import { MelomingSetlistController } from './meloming-setlist.controller.js';
import { MelomingSetlistService } from './meloming-setlist.service.js';
import { MelomingSongRequestSettingsController } from './meloming-song-request-settings.controller.js';
import { MelomingSongRequestSettingsService } from './meloming-song-request-settings.service.js';
import { MelomingLiveSessionController } from './meloming-live-session.controller.js';
import { MelomingLiveSessionService } from './meloming-live-session.service.js';
import { MelomingLiveSongRequestController, MelomingManualSongRequestController } from './meloming-live-song-request.controller.js';
import { MelomingLiveSongRequestService } from './meloming-live-song-request.service.js';
import { MelomingCalendarController } from './meloming-calendar.controller.js';
import { MelomingCalendarService } from './meloming-calendar.service.js';
import { MelomingUploadController } from './meloming-upload.controller.js';
import { MelomingUploadService } from './meloming-upload.service.js';
import { MelomingFavoritesController } from './meloming-favorites.controller.js';
import { MelomingFavoritesService } from './meloming-favorites.service.js';
import { MelomingSheetMusicController, MelomingSheetMusicReadController } from './meloming-sheet-music.controller.js';
import { MelomingSheetMusicService } from './meloming-sheet-music.service.js';
import { SongSuggestService } from './upstream/song-suggest.service.js';
import { SongAutocompleteService } from './upstream/song-autocomplete.service.js';
import { MelomingMrVideoController, MelomingMrVideoReadController } from './meloming-mr-video.controller.js';
import { MelomingMrVideoService } from './meloming-mr-video.service.js';
import { MelomingPricingController } from './meloming-pricing.controller.js';
import { MelomingPricingService } from './meloming-pricing.service.js';
import { MelomingOmakaseSettingsController, MelomingOmakaseConsoleController } from './meloming-omakase.controller.js';
import { MelomingOmakaseService } from './meloming-omakase.service.js';
import { MelomingSongLiveGateway } from './meloming-song-live.gateway.js';
import { MediaStorageModule } from '../media/media-storage.module.js';
import type { MediaOptions } from '../media/media.module.js';
import type { MediaSettings } from '../../infrastructure/config/runtime-settings.js';

@Module({})
export class ChannelContentModule {
  static register(infrastructure: DynamicModule, authentication: DynamicModule, refreshRecurring = false, media?: MediaOptions | MediaSettings): DynamicModule {
    return { module: ChannelContentModule, imports: [infrastructure,authentication,...(media ? [MediaStorageModule.register(media)] : [])],
      controllers: [ChannelContentController,MelomingWardrobeController,MelomingChannelController,MelomingScheduleController,MelomingCalendarController,MelomingProfileController,MelomingSongsController,MelomingFavoriteSongsController,MelomingCategoriesController,MelomingArtistsController,MelomingUserController,MelomingFavoritesController,MelomingSongAddRequestController,MelomingSetlistController,MelomingSongRequestSettingsController,MelomingPricingController,MelomingOmakaseSettingsController,MelomingOmakaseConsoleController,MelomingLiveSessionController,MelomingLiveSongRequestController,MelomingManualSongRequestController,...(media ? [MelomingUploadController,MelomingSheetMusicController,MelomingSheetMusicReadController,MelomingMrVideoController,MelomingMrVideoReadController] : [])],
      providers: [ChannelContentRepository,ChannelScheduleService,MelomingCalendarService,WardrobeService,SongbookService,SongSuggestService,SongAutocompleteService,RecurringScheduleService,MelomingChannelService,MelomingProfileService,MelomingUserService,MelomingFavoritesService,MelomingMusicbookSettingsService,MelomingCategoryService,MelomingArtistService,MelomingSongAddRequestService,MelomingSetlistService,MelomingSongRequestSettingsService,MelomingPricingService,MelomingOmakaseService,MelomingSongLiveGateway,MelomingLiveSessionService,MelomingLiveSongRequestService,...(media ? [MelomingUploadService,MelomingSheetMusicService,MelomingMrVideoService] : []),
        ...(refreshRecurring ? [RecurringScheduleRefresh] : [])] };
  }
}
