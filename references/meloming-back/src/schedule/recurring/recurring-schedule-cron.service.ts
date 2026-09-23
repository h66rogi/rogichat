import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DistributedLock } from '../../common/distributed-lock/distributed-lock.decorator';
import { DistributedLockService } from '../../common/distributed-lock/distributed-lock.service';
import { RecurringScheduleService } from './recurring-schedule.service';
import { MetricsService } from '../../metrics';

@Injectable()
export class RecurringScheduleCronService {
  private readonly logger = new Logger(RecurringScheduleCronService.name);

  constructor(
    private readonly recurringScheduleService: RecurringScheduleService,
    // Used by @DistributedLock decorator to acquire the lock.
    private readonly distributedLockService: DistributedLockService,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * 매주 일요일 10:00 KST에 다음 1주일치 일정 생성
   * 분산 락을 사용하여 다중 인스턴스 환경에서 중복 실행 방지
   */
  @Cron('0 10 * * 0', {
    name: 'recurring-schedule-weekly-generation',
    timeZone: 'Asia/Seoul',
  })
  @DistributedLock('cron:recurring-schedule:weekly', 5 * 60 * 1000, 2000)
  async handleWeeklyScheduleGeneration(): Promise<void> {
    const endTimer = this.metricsService.startJobTimer('recurring_schedule');
    try {
      const startTime = Date.now();
      this.logger.log('Starting weekly recurring schedule generation...');

      await this.recurringScheduleService.generateWeeklySchedules();
      const duration = Date.now() - startTime;
      this.logger.log(
        `Weekly recurring schedule generation completed. Duration: ${duration}ms`,
      );
      this.metricsService.recordJobRun('recurring_schedule', 'success');
    } catch (error) {
      this.metricsService.recordJobRun('recurring_schedule', 'error');
      this.logger.error(
        'Weekly recurring schedule generation failed:',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      endTimer();
    }
  }
}
