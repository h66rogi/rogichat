import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChannelModule } from '../channel.module';
import { FavoritesModule } from '../../favorites/favorites.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { FanBroadcastController } from './fan-broadcast.controller';
import { InternalFanBroadcastController } from './internal-fan-broadcast.controller';
import { FanBroadcastService } from './fan-broadcast.service';
import {
  FAN_BROADCAST_REDIS_CLIENT,
  FanBroadcastQuotaService,
} from './fan-broadcast-quota.service';
import type { EnvironmentVariables } from '../../config/env.config';

@Module({
  imports: [PrismaModule, ChannelModule, FavoritesModule, NotificationsModule],
  controllers: [FanBroadcastController, InternalFanBroadcastController],
  providers: [
    FanBroadcastService,
    FanBroadcastQuotaService,
    {
      provide: FAN_BROADCAST_REDIS_CLIENT,
      useFactory: (config: ConfigService<EnvironmentVariables>) => {
        const host = config.get('REDIS_HOST', { infer: true }) ?? 'localhost';
        const port = config.get('REDIS_PORT', { infer: true }) ?? 6379;
        const password = config.get('REDIS_PASSWORD', { infer: true });
        return new Redis({
          host,
          port: Number(port),
          ...(password ? { password } : {}),
          lazyConnect: false,
        });
      },
      inject: [ConfigService],
    },
  ],
})
export class FanBroadcastModule {}
