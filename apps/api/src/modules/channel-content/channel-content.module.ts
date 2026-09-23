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

@Module({})
export class ChannelContentModule {
  static register(infrastructure: DynamicModule, authentication: DynamicModule, refreshRecurring = false): DynamicModule {
    return { module: ChannelContentModule, imports: [infrastructure,authentication],
      controllers: [ChannelContentController,MelomingWardrobeController,MelomingChannelController,MelomingScheduleController,MelomingProfileController],
      providers: [ChannelContentRepository,ChannelScheduleService,WardrobeService,SongbookService,RecurringScheduleService,MelomingChannelService,MelomingProfileService,
        ...(refreshRecurring ? [RecurringScheduleRefresh] : [])] };
  }
}
