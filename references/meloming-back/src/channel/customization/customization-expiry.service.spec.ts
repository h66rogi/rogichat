import { CustomizationExpiryService } from './customization-expiry.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DistributedLockService } from '../../common/distributed-lock/distributed-lock.service';
import { SoftconeConnectionService } from '../../softcone/services/softcone-connection.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { channelCacheKeys } from '../cache/channel.cache-keys';
import { SoftconeReleaseReason, SubscriptionTermStatus } from '@prisma/client';
import { NotificationType } from '../../notifications/constants/notification-types';

function makeExpiredUser(
  id: number,
  overrides: Partial<{
    channels: Array<{
      id: number;
      webPath: string;
      customization: { id: number; isEnabled: boolean } | null;
      managers: Array<{ id: number; createdAt: Date | null }>;
    }>;
  }> = {},
) {
  return {
    id,
    channels: overrides.channels ?? [
      {
        id: id * 10 + 1,
        webPath: `channel-${id}`,
        customization: null,
        managers: [],
      },
    ],
  };
}

describe('CustomizationExpiryService', () => {
  let service: CustomizationExpiryService;
  let prisma: {
    user: {
      findMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let tx: {
    channelCustomization: {
      update: jest.Mock;
    };
    channelManager: {
      updateMany: jest.Mock;
    };
    user: {
      update: jest.Mock;
    };
    userSubscriptionTerm: {
      updateMany: jest.Mock;
    };
  };
  let cacheManager: {
    del: jest.Mock;
  };
  let softconeConnectionService: {
    enqueueReleaseSync: jest.Mock;
  };
  let notificationsService: {
    sendToUser: jest.Mock;
  };

  beforeEach(() => {
    tx = {
      channelCustomization: {
        update: jest.fn(),
      },
      channelManager: {
        updateMany: jest.fn(),
      },
      user: {
        update: jest.fn(),
      },
      userSubscriptionTerm: {
        updateMany: jest.fn(),
      },
    };

    prisma = {
      user: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (fn) => fn(tx)),
    };

    cacheManager = {
      del: jest.fn().mockResolvedValue(undefined),
    };

    softconeConnectionService = {
      enqueueReleaseSync: jest.fn().mockResolvedValue(undefined),
    };

    notificationsService = {
      sendToUser: jest.fn().mockResolvedValue(undefined),
    };

    service = new CustomizationExpiryService(
      prisma as unknown as PrismaService,
      cacheManager as any,
      {} as DistributedLockService,
      softconeConnectionService as unknown as SoftconeConnectionService,
      notificationsService as unknown as NotificationsService,
    );
  });

  it('disables customization and extra managers, then marks user as non-pro', async () => {
    const expiredUsers = [
      makeExpiredUser(10, {
        channels: [
          {
            id: 101,
            webPath: 'owner-channel',
            customization: { id: 1, isEnabled: true },
            managers: [
              { id: 1001, createdAt: new Date('2026-01-01T00:00:00.000Z') },
              { id: 1002, createdAt: new Date('2026-01-02T00:00:00.000Z') },
              { id: 1003, createdAt: new Date('2026-01-03T00:00:00.000Z') },
            ],
          },
        ],
      }),
    ];

    prisma.user.findMany
      .mockResolvedValueOnce(expiredUsers)
      .mockResolvedValueOnce([]);
    tx.channelCustomization.update.mockResolvedValue({});
    tx.channelManager.updateMany.mockResolvedValue({ count: 2 });
    tx.user.update.mockResolvedValue({});
    tx.userSubscriptionTerm.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.processExpiredManually();

    expect(result).toEqual({
      customizationCount: 1,
      managerCount: 2,
    });

    expect(tx.channelCustomization.update).toHaveBeenCalledWith({
      where: { channelId: 101 },
      data: { isEnabled: false },
    });
    expect(cacheManager.del).toHaveBeenCalledWith(channelCacheKeys.byId(101));
    expect(cacheManager.del).toHaveBeenCalledWith(
      channelCacheKeys.byWebPath('owner-channel'),
    );
    expect(tx.channelManager.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: [1002, 1003] },
      },
      data: {
        isActive: false,
        revokedAt: expect.any(Date),
      },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { isProSubscriber: false, proSubscriptionEndAt: null },
    });
  });

  it('updates expired subscription terms to EXPIRED status', async () => {
    prisma.user.findMany
      .mockResolvedValueOnce([makeExpiredUser(10)])
      .mockResolvedValueOnce([]);
    tx.user.update.mockResolvedValue({});
    tx.userSubscriptionTerm.updateMany.mockResolvedValue({ count: 1 });

    await service.processExpiredManually();

    expect(tx.userSubscriptionTerm.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 10,
        status: SubscriptionTermStatus.ACTIVE,
        endAt: { lte: expect.any(Date) },
      },
      data: { status: SubscriptionTermStatus.EXPIRED },
    });
  });

  it('enqueues softcone release sync for expired users', async () => {
    prisma.user.findMany
      .mockResolvedValueOnce([makeExpiredUser(10)])
      .mockResolvedValueOnce([]);
    tx.user.update.mockResolvedValue({});
    tx.userSubscriptionTerm.updateMany.mockResolvedValue({ count: 1 });

    await service.processExpiredManually();

    expect(softconeConnectionService.enqueueReleaseSync).toHaveBeenCalledWith({
      userId: 10,
      reason: SoftconeReleaseReason.ETC,
      actor: 'INTERNAL',
      note: '구독 자연 만료에 따른 소프트콘 연동 해제',
      source: 'cron:customization-expiry:10',
    });
  });

  it('sends expiry notification for expired users', async () => {
    prisma.user.findMany
      .mockResolvedValueOnce([makeExpiredUser(10)])
      .mockResolvedValueOnce([]);
    tx.user.update.mockResolvedValue({});
    tx.userSubscriptionTerm.updateMany.mockResolvedValue({ count: 1 });

    await service.processExpiredManually();

    expect(notificationsService.sendToUser).toHaveBeenCalledWith(
      10,
      {
        type: NotificationType.SUBSCRIPTION_EXPIRED,
        title: 'PRO 구독이 만료되었습니다',
        body: 'PRO 구독 기간이 종료되어 PRO 전용 기능이 비활성화되었습니다.',
      },
      { saveInApp: true },
    );
  });

  it('continues processing even if softcone release fails', async () => {
    prisma.user.findMany
      .mockResolvedValueOnce([makeExpiredUser(10), makeExpiredUser(20)])
      .mockResolvedValueOnce([]);
    tx.user.update.mockResolvedValue({});
    tx.userSubscriptionTerm.updateMany.mockResolvedValue({ count: 1 });
    softconeConnectionService.enqueueReleaseSync
      .mockRejectedValueOnce(new Error('softcone error'))
      .mockResolvedValueOnce(undefined);

    const result = await service.processExpiredManually();

    expect(result).toEqual({
      customizationCount: 0,
      managerCount: 0,
    });

    expect(notificationsService.sendToUser).toHaveBeenCalledTimes(2);
  });

  it('continues processing even if notification fails', async () => {
    prisma.user.findMany
      .mockResolvedValueOnce([makeExpiredUser(10)])
      .mockResolvedValueOnce([]);
    tx.user.update.mockResolvedValue({});
    tx.userSubscriptionTerm.updateMany.mockResolvedValue({ count: 1 });
    notificationsService.sendToUser.mockRejectedValueOnce(
      new Error('notification error'),
    );

    const result = await service.processExpiredManually();

    expect(result).toEqual({
      customizationCount: 0,
      managerCount: 0,
    });

    expect(softconeConnectionService.enqueueReleaseSync).toHaveBeenCalledTimes(
      1,
    );
  });

  it('returns zero counts when no expired users exist', async () => {
    prisma.user.findMany.mockResolvedValueOnce([]);

    const result = await service.processExpiredManually();

    expect(result).toEqual({
      customizationCount: 0,
      managerCount: 0,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
