import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ChannelRecurringSchedule,
  RecurringScheduleStatus,
  ScheduleStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  RecurringScheduleItemDto,
  SaveRecurringSchedulesDto,
} from './dto/recurring-schedule.request.dto';

@Injectable()
export class RecurringScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 채널 소유자 또는 일정 관리 권한이 있는 매니저인지 확인
   */
  private async ensureChannelOwnerOrManager(
    channelId: number,
    userId: number,
  ): Promise<void> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { userId: true },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    if (channel.userId === userId) {
      return;
    }

    const manager = await this.prisma.channelManager.findFirst({
      where: { channelId, userId, isActive: true, canManageContent: true },
    });

    if (!manager) {
      throw new ForbiddenException(
        'You do not have permission to manage this channel',
      );
    }
  }

  /**
   * 채널의 반복 일정 목록 조회
   */
  async getChannelRecurringSchedules(
    channelId: number,
  ): Promise<ChannelRecurringSchedule[]> {
    return this.prisma.channelRecurringSchedule.findMany({
      where: { channelId },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  /**
   * 반복 일정 저장 (일괄 upsert)
   * 1. 기존 반복 일정으로 생성된 미래 일정 삭제
   * 2. 반복 일정 upsert
   * 3. 내일부터 4주 후 일요일까지 일정 자동 생성
   */
  async saveRecurringSchedules(
    channelId: number,
    userId: number,
    dto: SaveRecurringSchedulesDto,
  ): Promise<ChannelRecurringSchedule[]> {
    await this.ensureChannelOwnerOrManager(channelId, userId);

    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { userId: true },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    const authorUserId = channel.userId;

    return this.prisma.$transaction(async (tx) => {
      // 1. 기존 반복 일정 조회 (dayOfWeek 포함) - 유지/삭제 대상 구분에 필요
      const existingRecurring = await tx.channelRecurringSchedule.findMany({
        where: { channelId },
        select: { id: true, dayOfWeek: true },
      });

      const inputDays = dto.schedules.map((s) => s.dayOfWeek);
      const inputDaySet = new Set<number>(inputDays);

      // 입력에 포함된 요일의 반복 일정은 유지(upsert 대상), 그 외는 삭제 대상
      const idsToDelete = existingRecurring
        .filter((r) => !inputDaySet.has(r.dayOfWeek))
        .map((r) => r.id);
      const idsToKeep = existingRecurring
        .filter((r) => inputDaySet.has(r.dayOfWeek))
        .map((r) => r.id);
      const allExistingIds = [...idsToDelete, ...idsToKeep];

      const tomorrow = this.getTomorrowKst();

      // 2. 기존 반복 일정으로 생성된 미래 auto-gen ChannelSchedule을 선제적으로 soft-delete
      //    - 삭제 대상 요일(idsToDelete): 이후 재생성 없이 영구 정리되어 고아가 남지 않도록
      //    - 유지 대상 요일(idsToKeep): 제목/시간 변경을 반영하도록 재생성 전 기존 auto-gen 정리
      //    ChannelRecurringSchedule 삭제는 onDelete:SetNull이므로, 실제 삭제 이전에
      //    soft-delete를 먼저 수행해야 recurringScheduleId 기반 식별이 가능하다.
      if (allExistingIds.length > 0) {
        await tx.channelSchedule.updateMany({
          where: {
            channelId,
            recurringScheduleId: { in: allExistingIds },
            startAt: { gte: tomorrow },
            isDeleted: false,
          },
          data: {
            isDeleted: true,
            deletedAt: new Date(),
          },
        });
      }

      // 3. 입력에 없는 기존 요일의 반복 일정 실제 삭제 (id 기반으로 명시적 처리)
      if (idsToDelete.length > 0) {
        await tx.channelRecurringSchedule.deleteMany({
          where: { id: { in: idsToDelete } },
        });
      }

      // 4. 반복 일정 upsert
      const upsertedSchedules: ChannelRecurringSchedule[] = [];
      for (const item of dto.schedules) {
        if (item.status === 'LIVE' && !item.startTime) {
          throw new BadRequestException(
            'startTime is required for LIVE schedules',
          );
        }
        const upserted = await tx.channelRecurringSchedule.upsert({
          where: {
            channelId_dayOfWeek: {
              channelId,
              dayOfWeek: item.dayOfWeek,
            },
          },
          create: {
            channelId,
            dayOfWeek: item.dayOfWeek,
            title: item.title,
            startTime: item.status === 'OFF' ? null : (item.startTime ?? null),
            status: item.status as RecurringScheduleStatus,
            isActive: item.isActive,
          },
          update: {
            title: item.title,
            startTime: item.status === 'OFF' ? null : (item.startTime ?? null),
            status: item.status as RecurringScheduleStatus,
            isActive: item.isActive,
          },
        });
        upsertedSchedules.push(upserted);
      }

      // 5. 활성화된 반복 일정으로 미래 일정 생성
      const activeSchedules = upsertedSchedules.filter((s) => s.isActive);
      if (activeSchedules.length > 0) {
        const endDate = this.get4WeeksAfterSunday();
        await this.generateSchedulesForRange(
          tx,
          channelId,
          authorUserId,
          activeSchedules,
          tomorrow,
          endDate,
        );
      }

      return upsertedSchedules;
    });
  }

  /**
   * 내일 날짜 (KST 기준 00:00) 반환
   * 서버 타임존에 의존하지 않도록 UTC 메서드 사용
   */
  private getTomorrowKst(): Date {
    const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
    const now = new Date();
    // 현재 KST 시간 계산
    const kstTimestamp = now.getTime() + KST_OFFSET_MS;
    const kstDate = new Date(kstTimestamp);
    // KST 기준 내일 00:00:00
    const tomorrowKst = Date.UTC(
      kstDate.getUTCFullYear(),
      kstDate.getUTCMonth(),
      kstDate.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    );
    // UTC로 변환
    return new Date(tomorrowKst - KST_OFFSET_MS);
  }

  /**
   * 4주 후 일요일 23:59:59 (KST 기준) 반환
   * 서버 타임존에 의존하지 않도록 UTC 메서드 사용
   */
  private get4WeeksAfterSunday(): Date {
    const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
    const now = new Date();
    // 현재 KST 시간 계산
    const kstTimestamp = now.getTime() + KST_OFFSET_MS;
    const kstDate = new Date(kstTimestamp);

    // 4주 후 날짜
    const futureDate = new Date(
      Date.UTC(
        kstDate.getUTCFullYear(),
        kstDate.getUTCMonth(),
        kstDate.getUTCDate() + 28,
      ),
    );

    // 다음 일요일까지 이동 (getUTCDay() 사용)
    const dayOfWeek = futureDate.getUTCDay();
    const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;

    // KST 23:59:59.999
    const sundayKst = Date.UTC(
      futureDate.getUTCFullYear(),
      futureDate.getUTCMonth(),
      futureDate.getUTCDate() + daysUntilSunday,
      23,
      59,
      59,
      999,
    );

    // UTC로 변환
    return new Date(sundayKst - KST_OFFSET_MS);
  }

  /**
   * 지정된 기간 동안 반복 일정에 따라 일정 생성
   */
  async generateSchedulesForRange(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    channelId: number,
    authorUserId: number,
    recurringSchedules: ChannelRecurringSchedule[],
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
    const schedulesByDay = new Map<number, ChannelRecurringSchedule>();
    for (const rs of recurringSchedules) {
      schedulesByDay.set(rs.dayOfWeek, rs);
    }

    const existingSchedules = await tx.channelSchedule.findMany({
      where: {
        channelId,
        isDeleted: false,
        startAt: { gte: startDate, lte: endDate },
      },
      select: { startAt: true },
    });
    const existingStartAt = new Set<number>(
      existingSchedules.map((s) => s.startAt.getTime()),
    );

    const schedulesToCreate: Array<{
      channelId: number;
      authorUserId: number;
      recurringScheduleId: number;
      title: string;
      startAt: Date;
      allDay: boolean;
      status: ScheduleStatus;
      visibility: 'PUBLIC';
    }> = [];

    const current = new Date(startDate);
    while (current <= endDate) {
      // KST 기준 요일 계산 (UTC 메서드 사용)
      const kstDate = new Date(current.getTime() + KST_OFFSET_MS);
      const dayOfWeek = kstDate.getUTCDay();

      const recurring = schedulesByDay.get(dayOfWeek);
      if (recurring) {
        let startAt: Date;
        let allDay = false;

        // KST 날짜의 년/월/일 추출 (UTC 기준으로 계산)
        const kstYear = kstDate.getUTCFullYear();
        const kstMonth = kstDate.getUTCMonth();
        const kstDay = kstDate.getUTCDate();

        if (recurring.status === 'OFF' || !recurring.startTime) {
          // 휴방 또는 시간 미지정: allDay 일정
          allDay = true;
          // KST 00:00:00 = UTC 전날 15:00:00
          startAt = new Date(
            Date.UTC(kstYear, kstMonth, kstDay, 0, 0, 0) - KST_OFFSET_MS,
          );
        } else {
          // 시간 지정: 해당 시간 (KST 기준)
          const [hours, minutes] = recurring.startTime.split(':').map(Number);
          // KST HH:mm = UTC (HH-9):mm
          startAt = new Date(
            Date.UTC(kstYear, kstMonth, kstDay, hours, minutes, 0) -
              KST_OFFSET_MS,
          );
        }

        const startKey = startAt.getTime();
        if (!existingStartAt.has(startKey)) {
          existingStartAt.add(startKey);
          schedulesToCreate.push({
            channelId,
            authorUserId,
            recurringScheduleId: recurring.id,
            title: recurring.title,
            startAt,
            allDay,
            status: recurring.status === 'OFF' ? 'OFF' : 'LIVE',
            visibility: 'PUBLIC',
          });
        }
      }

      current.setUTCDate(current.getUTCDate() + 1);
    }

    if (schedulesToCreate.length > 0) {
      await tx.channelSchedule.createMany({
        data: schedulesToCreate,
      });
    }

    return schedulesToCreate.length;
  }

  /**
   * Cronjob: 다음 1주일 일정 생성 (매주 일요일 실행)
   */
  async generateWeeklySchedules(): Promise<void> {
    // 활성화된 반복 일정이 있는 채널 조회
    const channelsWithActive = await this.prisma.channel.findMany({
      where: {
        recurringSchedules: {
          some: { isActive: true },
        },
      },
      select: {
        id: true,
        userId: true,
        recurringSchedules: {
          where: { isActive: true },
        },
      },
    });

    const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
    const now = new Date();
    // 현재 KST 시간 계산 (UTC 메서드 사용)
    const kstTimestamp = now.getTime() + KST_OFFSET_MS;
    const kstDate = new Date(kstTimestamp);

    // KST 기준 내일 00:00:00
    const tomorrowKst = Date.UTC(
      kstDate.getUTCFullYear(),
      kstDate.getUTCMonth(),
      kstDate.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    );
    const startDate = new Date(tomorrowKst - KST_OFFSET_MS);

    // KST 기준 7일 후 23:59:59.999
    const weekLaterKst = Date.UTC(
      kstDate.getUTCFullYear(),
      kstDate.getUTCMonth(),
      kstDate.getUTCDate() + 7,
      23,
      59,
      59,
      999,
    );
    const endDate = new Date(weekLaterKst - KST_OFFSET_MS);

    for (const channel of channelsWithActive) {
      await this.prisma.$transaction(async (tx) => {
        await this.generateSchedulesForRange(
          tx,
          channel.id,
          channel.userId,
          channel.recurringSchedules,
          startDate,
          endDate,
        );
      });
    }
  }
}
