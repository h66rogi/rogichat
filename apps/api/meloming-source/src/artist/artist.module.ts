import { Module } from '@nestjs/common';
import { ArtistService } from './artist.service';
import { ArtistController } from './artist.controller';
import { ChannelModule } from '../channel/channel.module';

@Module({
  imports: [ChannelModule],
  providers: [ArtistService],
  controllers: [ArtistController],
})
export class ArtistModule {}
