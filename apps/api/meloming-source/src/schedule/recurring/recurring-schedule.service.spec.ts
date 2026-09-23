import { BadRequestException } from '@nestjs/common';
import { RecurringScheduleService } from './recurring-schedule.service';
import { PrismaService } from '../../prisma/prisma.service';

type TxMockOverrides = {
  existingRecurring?: Array<{ id: number; dayOfWeek: number }>;
  findManySchedulesResult?: Array<{ startAt: Date }>;
};

type SaveScenarioMocks = {
  tx: {
    channelRecurringSchedule: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
      upsert: jest.Mock;
    };
    channelSchedule: {
      updateMany: jest.Mock;
      findMany: jest.Mock;
      createMany: jest.Mock;
    };
  };
  prisma: PrismaService;
};

function buildSaveScenarioMocks(overrides: TxMockOverrides = {}): SaveScenarioMocks {
  const tx = {
    channelRecurringSchedule: {
      findMany: jest.fn().mockResolvedValue(overrides.existingRecurring ?? []),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({
        id: Math.floor(Math.random() * 10_000) + 1,
        ...create,
      })),
    },
    channelSchedule: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue(overrides.findManySchedulesResult ?? []),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const prisma = {
    channel: {
      findUnique: jest.fn().mockResolvedValue({ userId: 1 }),
    },
    channelManager: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(async (handler: (txArg: typeof tx) => Promise<unknown>) => handler(tx)),
  } as unknown as PrismaService;
  return { tx, prisma };
}

describe('RecurringScheduleService', () => {
  it('throws when LIVE recurring schedule has no startTime', async () => {
    const { prisma } = buildSaveScenarioMocks();
    const service = new RecurringScheduleService(prisma);

    await expect(
      service.saveRecurringSchedules(10, 1, {
        schedules: [
          {
            dayOfWeek: 0,
            title: '정기 방송',
            status: 'LIVE',
            isActive: true,
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('soft-deletes all future auto-gen schedules and removes recurring records when all patterns are cleared', async () => {
    const { tx, prisma } = buildSaveScenarioMocks({
      existingRecurring: [
        { id: 11, dayOfWeek: 1 },
        { id: 12, dayOfWeek: 3 },
      ],
    });
    const service = new RecurringScheduleService(prisma);

    const result = await service.saveRecurringSchedules(10, 1, { schedules: [] });

    // Expect soft-delete of auto-gen schedules for BOTH existing recurringScheduleIds
    expect(tx.channelSchedule.updateMany).toHaveBeenCalledTimes(1);
    const softDeleteCall = tx.channelSchedule.updateMany.mock.calls[0][0];
    expect(softDeleteCall.where.channelId).toBe(10);
    expect(softDeleteCall.where.recurringScheduleId).toEqual({ in: [11, 12] });
    expect(softDeleteCall.where.isDeleted).toBe(false);
    expect(softDeleteCall.data.isDeleted).toBe(true);
    expect(softDeleteCall.data.deletedAt).toBeInstanceOf(Date);

    // Recurring records deleted via explicit id list, not notIn
    expect(tx.channelRecurringSchedule.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [11, 12] } },
    });

    // No upsert, no regen
    expect(tx.channelRecurringSchedule.upsert).not.toHaveBeenCalled();
    expect(tx.channelSchedule.createMany).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('only removes auto-gen schedules for days removed from input; kept days are refreshed and regenerated', async () => {
    // Existing: Mon(id=21), Wed(id=22), Fri(id=23). Input keeps Mon only.
    const { tx, prisma } = buildSaveScenarioMocks({
      existingRecurring: [
        { id: 21, dayOfWeek: 1 },
        { id: 22, dayOfWeek: 3 },
        { id: 23, dayOfWeek: 5 },
      ],
    });
    const service = new RecurringScheduleService(prisma);

    await service.saveRecurringSchedules(10, 1, {
      schedules: [
        {
          dayOfWeek: 1,
          title: '월요일 정기 방송',
          status: 'LIVE',
          startTime: '21:00',
          isActive: true,
        },
      ],
    });

    // Soft-delete covers BOTH days-to-delete (22, 23) and day-to-keep (21)
    // days-to-keep need refresh because title/time may have changed
    expect(tx.channelSchedule.updateMany).toHaveBeenCalledTimes(1);
    const softDeleteCall = tx.channelSchedule.updateMany.mock.calls[0][0];
    const softDeleteIds = softDeleteCall.where.recurringScheduleId.in as number[];
    // Order-agnostic set comparison
    expect(new Set(softDeleteIds)).toEqual(new Set([21, 22, 23]));

    // Only Wed(22) and Fri(23) ChannelRecurringSchedule rows are deleted
    expect(tx.channelRecurringSchedule.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.channelRecurringSchedule.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [22, 23] } },
    });

    // Monday recurring pattern upserted
    expect(tx.channelRecurringSchedule.upsert).toHaveBeenCalledTimes(1);
    const upsertArgs = tx.channelRecurringSchedule.upsert.mock.calls[0][0];
    expect(upsertArgs.where).toEqual({
      channelId_dayOfWeek: { channelId: 10, dayOfWeek: 1 },
    });

    // Regeneration pass should have been invoked (createMany called when schedulesToCreate > 0)
    expect(tx.channelSchedule.findMany).toHaveBeenCalled();
  });

  it('re-saves patterns from an empty state without emitting soft-delete or delete operations', async () => {
    // No existing recurring patterns in DB
    const { tx, prisma } = buildSaveScenarioMocks({ existingRecurring: [] });
    const service = new RecurringScheduleService(prisma);

    await service.saveRecurringSchedules(10, 1, {
      schedules: [
        {
          dayOfWeek: 2,
          title: '화요일 방송',
          status: 'LIVE',
          startTime: '20:00',
          isActive: true,
        },
      ],
    });

    // No existing rows -> no mass soft-delete call
    expect(tx.channelSchedule.updateMany).not.toHaveBeenCalled();
    // No days to delete -> no deleteMany call
    expect(tx.channelRecurringSchedule.deleteMany).not.toHaveBeenCalled();
    // But upsert + regen should still happen
    expect(tx.channelRecurringSchedule.upsert).toHaveBeenCalledTimes(1);
    expect(tx.channelSchedule.findMany).toHaveBeenCalled();
  });

  it('skips generation when a schedule with the same startAt already exists', async () => {
    const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
    const expectedStartAt = new Date(
      Date.UTC(2025, 0, 5, 20, 0, 0) - KST_OFFSET_MS,
    );

    const tx = {
      channelSchedule: {
        findMany: jest.fn().mockResolvedValue([{ startAt: expectedStartAt }]),
        createMany: jest.fn(),
      },
    };
    const service = new RecurringScheduleService({} as PrismaService);

    const createdCount = await service.generateSchedulesForRange(
      tx as any,
      10,
      1,
      [
        {
          id: 1,
          channelId: 10,
          dayOfWeek: 0,
          title: '정기 방송',
          startTime: '20:00',
          status: 'LIVE',
          isActive: true,
        } as any,
      ],
      new Date('2025-01-05T00:00:00.000Z'),
      new Date('2025-01-05T23:59:59.999Z'),
    );

    expect(createdCount).toBe(0);
    expect(tx.channelSchedule.createMany).not.toHaveBeenCalled();
  });

  it('creates schedules when none exist in range', async () => {
    const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
    const expectedStartAt = new Date(
      Date.UTC(2025, 0, 5, 20, 0, 0) - KST_OFFSET_MS,
    );

    const tx = {
      channelSchedule: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new RecurringScheduleService({} as PrismaService);

    const createdCount = await service.generateSchedulesForRange(
      tx as any,
      10,
      1,
      [
        {
          id: 1,
          channelId: 10,
          dayOfWeek: 0,
          title: '정기 방송',
          startTime: '20:00',
          status: 'LIVE',
          isActive: true,
        } as any,
      ],
      new Date('2025-01-05T00:00:00.000Z'),
      new Date('2025-01-05T23:59:59.999Z'),
    );

    expect(createdCount).toBe(1);
    expect(tx.channelSchedule.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          channelId: 10,
          authorUserId: 1,
          recurringScheduleId: 1,
          title: '정기 방송',
          startAt: expectedStartAt,
          allDay: false,
          status: 'LIVE',
          visibility: 'PUBLIC',
        }),
      ],
    });
  });
});
