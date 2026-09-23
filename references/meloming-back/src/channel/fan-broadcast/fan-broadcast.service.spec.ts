import { HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FavoritesService } from '../../favorites/favorites.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '../../notifications/constants/notification-types';
import { FanBroadcastService } from './fan-broadcast.service';
import { FanBroadcastQuotaService } from './fan-broadcast-quota.service';
import * as proUtil from '../customization/utils/pro-subscription.util';

describe('FanBroadcastService', () => {
  let service: FanBroadcastService;
  let prisma: { channel: { findUnique: jest.Mock } };
  let favoritesService: { getChannelFavoritedUsers: jest.Mock };
  let notificationsService: { sendCustomNotificationToUsers: jest.Mock };
  let quotaService: jest.Mocked<
    Pick<
      FanBroadcastQuotaService,
      'getLimit' | 'incrementAndGetCount' | 'rollback' | 'getUsed' | 'getResetAt'
    >
  >;
  let isProSpy: jest.SpyInstance;

  const CHANNEL = {
    id: 10,
    webPath: 'test_channel',
    name: '테스트 채널',
  };
  const OWNER_ID = 100;

  beforeEach(() => {
    prisma = {
      channel: { findUnique: jest.fn().mockResolvedValue(CHANNEL) },
    };
    favoritesService = {
      getChannelFavoritedUsers: jest.fn().mockResolvedValue({
        users: [],
        total: 0,
        page: 1,
        limit: 500,
        totalPages: 0,
      }),
    };
    notificationsService = {
      sendCustomNotificationToUsers: jest.fn().mockResolvedValue({
        processedUserIds: [],
        skippedUserIds: [],
      }),
    };
    quotaService = {
      getLimit: jest.fn(),
      incrementAndGetCount: jest.fn(),
      rollback: jest.fn().mockResolvedValue(undefined),
      getUsed: jest.fn(),
      getResetAt: jest.fn().mockReturnValue(new Date('2026-04-24T15:00:00.000Z')),
    };
    isProSpy = jest.spyOn(proUtil, 'isProSubscriberActive');

    service = new FanBroadcastService(
      prisma as unknown as PrismaService,
      favoritesService as unknown as FavoritesService,
      notificationsService as unknown as NotificationsService,
      quotaService as unknown as FanBroadcastQuotaService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sendBroadcast', () => {
    it('rejects with 429 and rolls back quota when free-tier limit exceeded', async () => {
      isProSpy.mockResolvedValueOnce(false);
      quotaService.getLimit.mockReturnValueOnce(1);
      quotaService.incrementAndGetCount.mockResolvedValueOnce(2);

      await expect(
        service.sendBroadcast({
          channelId: CHANNEL.id,
          ownerUserId: OWNER_ID,
          title: 't',
          body: 'b',
        }),
      ).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });

      expect(quotaService.rollback).toHaveBeenCalledWith(OWNER_ID, expect.any(Date));
      expect(notificationsService.sendCustomNotificationToUsers).not.toHaveBeenCalled();
    });

    it('allows PRO users up to 5 sends per day', async () => {
      isProSpy.mockResolvedValue(true);
      quotaService.getLimit.mockReturnValue(5);
      quotaService.incrementAndGetCount.mockResolvedValueOnce(5);

      await service.sendBroadcast({
        channelId: CHANNEL.id,
        ownerUserId: OWNER_ID,
        title: 'title',
        body: 'body',
      });

      expect(quotaService.rollback).not.toHaveBeenCalled();
      expect(notificationsService.sendCustomNotificationToUsers).toHaveBeenCalled();
    });

    it('rejects PRO users when count exceeds 5', async () => {
      isProSpy.mockResolvedValue(true);
      quotaService.getLimit.mockReturnValue(5);
      quotaService.incrementAndGetCount.mockResolvedValueOnce(6);

      const err = await service
        .sendBroadcast({
          channelId: CHANNEL.id,
          ownerUserId: OWNER_ID,
          title: 't',
          body: 'b',
        })
        .catch((e) => e);

      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getResponse()).toMatchObject({
        code: 'FAN_BROADCAST_QUOTA_EXCEEDED',
        limit: 5,
        isPro: true,
      });
      expect(quotaService.rollback).toHaveBeenCalled();
    });

    it('excludes the owner from recipients', async () => {
      isProSpy.mockResolvedValue(false);
      quotaService.getLimit.mockReturnValue(1);
      quotaService.incrementAndGetCount.mockResolvedValueOnce(1);
      favoritesService.getChannelFavoritedUsers.mockResolvedValueOnce({
        users: [
          { userId: 1, nickname: 'a', profileImageUrl: null, createdAt: new Date() },
          { userId: OWNER_ID, nickname: 'me', profileImageUrl: null, createdAt: new Date() },
          { userId: 2, nickname: 'b', profileImageUrl: null, createdAt: new Date() },
        ],
        total: 3,
        page: 1,
        limit: 500,
        totalPages: 1,
      });
      notificationsService.sendCustomNotificationToUsers.mockResolvedValueOnce({
        processedUserIds: [1, 2],
        skippedUserIds: [],
      });

      const result = await service.sendBroadcast({
        channelId: CHANNEL.id,
        ownerUserId: OWNER_ID,
        title: 't',
        body: 'b',
      });

      const [userIds] = notificationsService.sendCustomNotificationToUsers.mock.calls[0];
      expect(userIds).toEqual([1, 2]);
      expect(userIds).not.toContain(OWNER_ID);
      expect(result.enqueuedCount).toBe(2);
    });

    it('collects favoriters across all pages', async () => {
      isProSpy.mockResolvedValue(false);
      quotaService.getLimit.mockReturnValue(1);
      quotaService.incrementAndGetCount.mockResolvedValueOnce(1);
      favoritesService.getChannelFavoritedUsers
        .mockResolvedValueOnce({
          users: [
            { userId: 1, nickname: 'a', profileImageUrl: null, createdAt: new Date() },
            { userId: 2, nickname: 'b', profileImageUrl: null, createdAt: new Date() },
          ],
          total: 3,
          page: 1,
          limit: 500,
          totalPages: 2,
        })
        .mockResolvedValueOnce({
          users: [
            { userId: 3, nickname: 'c', profileImageUrl: null, createdAt: new Date() },
          ],
          total: 3,
          page: 2,
          limit: 500,
          totalPages: 2,
        });
      notificationsService.sendCustomNotificationToUsers.mockResolvedValueOnce({
        processedUserIds: [1, 2, 3],
        skippedUserIds: [],
      });

      await service.sendBroadcast({
        channelId: CHANNEL.id,
        ownerUserId: OWNER_ID,
        title: 't',
        body: 'b',
      });

      expect(favoritesService.getChannelFavoritedUsers).toHaveBeenCalledTimes(2);
      const [userIds] = notificationsService.sendCustomNotificationToUsers.mock.calls[0];
      expect(new Set(userIds)).toEqual(new Set([1, 2, 3]));
    });

    it('uses channel webPath as default deep-link when url omitted', async () => {
      isProSpy.mockResolvedValue(false);
      quotaService.getLimit.mockReturnValue(1);
      quotaService.incrementAndGetCount.mockResolvedValueOnce(1);
      favoritesService.getChannelFavoritedUsers.mockResolvedValueOnce({
        users: [{ userId: 1, nickname: 'a', profileImageUrl: null, createdAt: new Date() }],
        total: 1,
        page: 1,
        limit: 500,
        totalPages: 1,
      });
      notificationsService.sendCustomNotificationToUsers.mockResolvedValueOnce({
        processedUserIds: [1],
        skippedUserIds: [],
      });

      await service.sendBroadcast({
        channelId: CHANNEL.id,
        ownerUserId: OWNER_ID,
        title: 't',
        body: 'b',
      });

      const [, payload] = notificationsService.sendCustomNotificationToUsers.mock.calls[0];
      expect(payload.url).toBe('/channel/test_channel');
      expect(payload.type).toBe(NotificationType.STREAMER_FAN_BROADCAST);
    });

    it('honours custom url when provided', async () => {
      isProSpy.mockResolvedValue(true);
      quotaService.getLimit.mockReturnValue(5);
      quotaService.incrementAndGetCount.mockResolvedValueOnce(1);
      favoritesService.getChannelFavoritedUsers.mockResolvedValueOnce({
        users: [{ userId: 1, nickname: 'a', profileImageUrl: null, createdAt: new Date() }],
        total: 1,
        page: 1,
        limit: 500,
        totalPages: 1,
      });
      notificationsService.sendCustomNotificationToUsers.mockResolvedValueOnce({
        processedUserIds: [1],
        skippedUserIds: [],
      });

      await service.sendBroadcast({
        channelId: CHANNEL.id,
        ownerUserId: OWNER_ID,
        title: 't',
        body: 'b',
        url: 'https://chzzk.naver.com/live/abc',
      });

      const [, payload] = notificationsService.sendCustomNotificationToUsers.mock.calls[0];
      expect(payload.url).toBe('https://chzzk.naver.com/live/abc');
    });

    it('consumes a quota slot even when the channel has no favoriters (anti-spam)', async () => {
      isProSpy.mockResolvedValue(false);
      quotaService.getLimit.mockReturnValue(1);
      quotaService.incrementAndGetCount.mockResolvedValueOnce(1);
      // default mock: users: []

      const result = await service.sendBroadcast({
        channelId: CHANNEL.id,
        ownerUserId: OWNER_ID,
        title: 't',
        body: 'b',
      });

      expect(quotaService.rollback).not.toHaveBeenCalled();
      const [userIds] = notificationsService.sendCustomNotificationToUsers.mock.calls[0];
      expect(userIds).toEqual([]);
      expect(result.enqueuedCount).toBe(0);
      expect(result.usedQuotaToday).toBe(1);
    });

    it('rolls back quota and rethrows when recipient collection fails', async () => {
      isProSpy.mockResolvedValue(false);
      quotaService.getLimit.mockReturnValue(1);
      quotaService.incrementAndGetCount.mockResolvedValueOnce(1);
      favoritesService.getChannelFavoritedUsers.mockRejectedValueOnce(
        new Error('DB down'),
      );

      await expect(
        service.sendBroadcast({
          channelId: CHANNEL.id,
          ownerUserId: OWNER_ID,
          title: 't',
          body: 'b',
        }),
      ).rejects.toThrow('DB down');

      expect(quotaService.rollback).toHaveBeenCalledWith(OWNER_ID, expect.any(Date));
      expect(notificationsService.sendCustomNotificationToUsers).not.toHaveBeenCalled();
    });

    it('rolls back quota and rethrows when notification enqueue fails', async () => {
      isProSpy.mockResolvedValue(true);
      quotaService.getLimit.mockReturnValue(5);
      quotaService.incrementAndGetCount.mockResolvedValueOnce(1);
      favoritesService.getChannelFavoritedUsers.mockResolvedValueOnce({
        users: [{ userId: 1, nickname: 'a', profileImageUrl: null, createdAt: new Date() }],
        total: 1,
        page: 1,
        limit: 500,
        totalPages: 1,
      });
      notificationsService.sendCustomNotificationToUsers.mockRejectedValueOnce(
        new Error('BullMQ unavailable'),
      );

      await expect(
        service.sendBroadcast({
          channelId: CHANNEL.id,
          ownerUserId: OWNER_ID,
          title: 't',
          body: 'b',
        }),
      ).rejects.toThrow('BullMQ unavailable');

      expect(quotaService.rollback).toHaveBeenCalledWith(OWNER_ID, expect.any(Date));
    });

    it('passes saveInApp:true and an idempotency key to notifications', async () => {
      isProSpy.mockResolvedValue(false);
      quotaService.getLimit.mockReturnValue(1);
      quotaService.incrementAndGetCount.mockResolvedValueOnce(1);
      favoritesService.getChannelFavoritedUsers.mockResolvedValueOnce({
        users: [{ userId: 1, nickname: 'a', profileImageUrl: null, createdAt: new Date() }],
        total: 1,
        page: 1,
        limit: 500,
        totalPages: 1,
      });
      notificationsService.sendCustomNotificationToUsers.mockResolvedValueOnce({
        processedUserIds: [1],
        skippedUserIds: [],
      });

      await service.sendBroadcast({
        channelId: CHANNEL.id,
        ownerUserId: OWNER_ID,
        title: 't',
        body: 'b',
      });

      const [, , options] = notificationsService.sendCustomNotificationToUsers.mock.calls[0];
      expect(options.saveInApp).toBe(true);
      expect(options.idempotencyKey).toMatch(/^fanbroadcast_10_100_\d+$/);
    });
  });

  describe('getQuota', () => {
    it('returns current usage for a non-PRO user', async () => {
      isProSpy.mockResolvedValue(false);
      quotaService.getUsed.mockResolvedValueOnce(0);
      quotaService.getLimit.mockReturnValue(1);

      const q = await service.getQuota(OWNER_ID);

      expect(q).toEqual({
        used: 0,
        limit: 1,
        isPro: false,
        resetAt: '2026-04-24T15:00:00.000Z',
      });
    });

    it('returns PRO limit for PRO user', async () => {
      isProSpy.mockResolvedValue(true);
      quotaService.getUsed.mockResolvedValueOnce(3);
      quotaService.getLimit.mockReturnValue(5);

      const q = await service.getQuota(OWNER_ID);

      expect(q).toEqual({
        used: 3,
        limit: 5,
        isPro: true,
        resetAt: '2026-04-24T15:00:00.000Z',
      });
    });
  });
});
