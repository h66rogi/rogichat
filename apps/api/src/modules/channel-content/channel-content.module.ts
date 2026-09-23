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
import { MelomingSongsController } from './meloming-songs.controller.js';
import { MelomingArtistsController, MelomingCategoriesController } from './meloming-song-taxonomy.controller.js';
import { MelomingUserController } from './meloming-user.controller.js';
import { MelomingUserService } from './meloming-user.service.js';
import { MelomingMusicbookSettingsService } from './meloming-musicbook-settings.service.js';

@Module({})
export class ChannelContentModule {
  static register(infrastructure: DynamicModule, authentication: DynamicModule, refreshRecurring = false): DynamicModule {
    return { module: ChannelContentModule, imports: [infrastructure,authentication],
      controllers: [ChannelContentController,MelomingWardrobeController,MelomingChannelController,MelomingScheduleController,MelomingProfileController,MelomingSongsController,MelomingCategoriesController,MelomingArtistsController,MelomingUserController],
      providers: [ChannelContentRepository,ChannelScheduleService,WardrobeService,SongbookService,RecurringScheduleService,MelomingChannelService,MelomingProfileService,MelomingUserService,MelomingMusicbookSettingsService,
        ...(refreshRecurring ? [RecurringScheduleRefresh] : [])] };
  }
}
