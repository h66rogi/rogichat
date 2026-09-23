import { forwardRef, Module } from '@nestjs/common';
import { SongPricingService } from './song-pricing.service';
import { SongPricingController } from './song-pricing.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ChannelModule } from '../channel/channel.module';

@Module({
  // ChannelModule ↔ OverlayModule ↔ SongPricingModule form a cycle through
  // OverlayModule's imports; resolve the graph with a forwardRef here.
  imports: [PrismaModule, forwardRef(() => ChannelModule)],
  controllers: [SongPricingController],
  providers: [SongPricingService],
  exports: [SongPricingService],
})
export class SongPricingModule {}
