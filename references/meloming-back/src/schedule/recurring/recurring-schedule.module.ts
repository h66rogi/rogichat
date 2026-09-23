import { Module } from '@nestjs/common';
import { RecurringScheduleService } from './recurring-schedule.service';
import { RecurringScheduleController } from './recurring-schedule.controller';
import { RecurringScheduleCronService } from './recurring-schedule-cron.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { DistributedLockModule } from '../../common/distributed-lock/distributed-lock.module';

@Module({
  imports: [PrismaModule, DistributedLockModule],
  providers: [RecurringScheduleService, RecurringScheduleCronService],
  controllers: [RecurringScheduleController],
  exports: [RecurringScheduleService],
})
export class RecurringScheduleModule {}
