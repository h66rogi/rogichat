import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChannelModule } from '../channel/channel.module';
import { SongRequestModule } from '../song-request/song-request.module';
import { ConsoleTokenGuard } from '../console-api/guards/console-token.guard';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import { OmakaseController } from './omakase.controller';
import { OmakaseService } from './omakase.service';

@Module({
  imports: [PrismaModule, ChannelModule, SongRequestModule],
  controllers: [OmakaseController],
  providers: [OmakaseService, ConsoleTokenGuard, InternalApiKeyGuard],
  exports: [OmakaseService],
})
export class OmakaseModule {}
