import { ScheduleService } from './schedule.service';
import { POINT_ACTIONS } from '../points/constants/point-actions';
import { NotificationType } from '../notifications/constants/notification-types';
import { PrismaService } from '../prisma/prisma.service';
import { PointsService } from '../points/points.service';
import { NotificationsService } from '../notifications/notifications.service';

const createPointTx = () => ({
  id: 99,
  type: 'CREDIT' as const,
  amount: 300,
  balanceAfter: 1000,
  reason: '일정 등록 보상',
  action: POINT_ACTIONS.SCHEDULE_CREATE,
  createdAt: new Date(),
});

describe('ScheduleService - grantScheduleCreateBonus', () => {
  let prisma: Pick<
    PrismaService,
    '$transaction'
  > & { $transaction: jest.Mock };
  let txClient: {
    pointTransaction: { findFirst: jest.Mock; count: jest.Mock };
  };
  let points: Pick<PointsService, 'grantWithTx'> & { grantWithTx: jest.Mock };
  let notifications: Pick<
    NotificationsService,
    'sendToUser'
  > & { sendToUser: jest.Mock };
  let service: ScheduleService;

  beforeEach(() => {
    txClient = {
      pointTransaction: {
        findFirst: jest.fn(),
        count: jest.fn(),
      },
    };
    prisma = {
      $transaction: jest.fn(async (handler: any) => handler(txClient)),
    } as any;
    points = {
      grantWithTx: jest.fn(),
    } as any;
    notifications = {
      sendToUser: jest.fn(),
    } as any;
    service = new ScheduleService(
      prisma as unknown as PrismaService,
      points as unknown as PointsService,
      notifications as unknown as NotificationsService,
    );
  });

  it('grants points and sends notification when under the daily cap', async () => {
    txClient.pointTransaction.findFirst.mockResolvedValue(null);
    txClient.pointTransaction.count.mockResolvedValue(3);
    points.grantWithTx.mockResolvedValue(createPointTx());
    notifications.sendToUser.mockResolvedValue(undefined);

    await (service as any).grantScheduleCreateBonus({
      id: 1,
      authorUserId: 10,
      title: '팬미팅',
      channel: { name: '멜로밍' },
    });

    expect(points.grantWithTx).toHaveBeenCalledWith(
      txClient,
      expect.objectContaining({
        userId: 10,
        amount: 300,
        action: POINT_ACTIONS.SCHEDULE_CREATE,
        uniqueKey: 'schedule:create:1',
        referenceType: 'schedule',
        referenceId: '1',
      }),
      expect.objectContaining({ skipUniqueCheck: true }),
    );
    expect(notifications.sendToUser).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        type: NotificationType.SCHEDULE_POINT_REWARD,
        url: '/page/point',
        data: expect.objectContaining({
          amount: 300,
          scheduleId: 1,
        }),
      }),
      expect.objectContaining({
        saveInApp: true,
        idempotencyKey: 'schedule:create:1',
      }),
    );
  });

  it('skips granting when the daily cap is reached', async () => {
    txClient.pointTransaction.findFirst.mockResolvedValue(null);
    txClient.pointTransaction.count.mockResolvedValue(7);

    await (service as any).grantScheduleCreateBonus({
      id: 2,
      authorUserId: 20,
      title: '콘서트',
      channel: { name: '테스트 채널' },
    });

    expect(points.grantWithTx).not.toHaveBeenCalled();
    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });
});
