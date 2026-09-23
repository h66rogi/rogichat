import { Module, OnModuleInit } from '@nestjs/common';
import { SongRequestService } from './song-request.service';
import { SongRequestController } from './song-request.controller';
import { SongRequestQueueService } from './song-request-queue.service';
import { SongRequestParserService } from './song-request-parser.service';
import { SongMatcherService } from './song-matcher.service';
import { DonationCurrencyBackfillService } from './donation-currency-backfill.service';
import { SongRequestUserBlockService } from './song-request-user-block.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SongPricingModule } from '../song-pricing/song-pricing.module';
import { DistributedLockModule } from '../common/distributed-lock/distributed-lock.module';
import { ChannelModule } from '../channel/channel.module';

@Module({
  imports: [
    PrismaModule,
    SongPricingModule,
    DistributedLockModule,
    ChannelModule,
  ],
  controllers: [SongRequestController],
  providers: [
    SongRequestService,
    SongRequestQueueService,
    SongRequestParserService,
    SongMatcherService,
    DonationCurrencyBackfillService,
    SongRequestUserBlockService,
  ],
  exports: [
    SongRequestService,
    SongRequestQueueService,
    SongRequestParserService,
    SongMatcherService,
    SongRequestUserBlockService,
  ],
})
export class SongRequestModule implements OnModuleInit {
  constructor(
    private readonly backfillService: DonationCurrencyBackfillService,
  ) {}

  async onModuleInit() {
    await this.backfillService.runBackfill();
  }
}
