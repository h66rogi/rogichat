import { Module } from '@nestjs/common';
import { ScheduleService } from './schedule.service';
import { ScheduleController } from './schedule.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ChannelModule } from '../channel/channel.module';
import { PointsModule } from '../points/points.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RecurringScheduleModule } from './recurring/recurring-schedule.module';

@Module({
  imports: [
    PrismaModule,
    ChannelModule,
    PointsModule,
    NotificationsModule,
    RecurringScheduleModule,
  ],
  providers: [ScheduleService],
  controllers: [ScheduleController],
  exports: [ScheduleService],
})
export class ScheduleModule {}
