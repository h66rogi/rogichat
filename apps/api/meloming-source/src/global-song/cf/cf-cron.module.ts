import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { DistributedLockModule } from '../../common/distributed-lock/distributed-lock.module';
import { CFComputationService } from './cf-computation.service';
import { GlobalSongRedisService } from '../global-song-redis.service';
import { SlackWebhookService } from '../../common/slack/slack-webhook.service';

@Module({
  imports: [ConfigModule.forRoot(), PrismaModule, DistributedLockModule],
  providers: [
    CFComputationService,
    GlobalSongRedisService,
    SlackWebhookService,
  ],
})
export class CfCronModule {}
