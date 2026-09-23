import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChannelModule } from './channel.module';
import { SongLiveModule } from '../song-live/song-live.module';
import { ChannelCalendarController } from './channel-calendar.controller';
import { ChannelCalendarService } from './channel-calendar.service';

/**
 * 채널 통합 캘린더 (Task 1.7) 모듈.
 *
 * SongLiveModule (SessionService) 와 ChannelModule (ChannelService) 모두에
 * 의존하므로 ChannelModule 안쪽에 두면 SongLiveModule → ChannelModule →
 * SongLiveModule 순환참조가 생긴다. 별도 모듈로 분리하여 두 모듈을 모두
 * 외부에서 import 한다.
 *
 * RedisModule (CacheModule) 도 `@Global()`.
 */
@Module({
  imports: [PrismaModule, ChannelModule, SongLiveModule],
  controllers: [ChannelCalendarController],
  providers: [ChannelCalendarService],
})
export class ChannelCalendarModule {}
