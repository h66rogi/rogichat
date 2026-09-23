import { ChannelService } from './channel.service';
import { PrismaService } from '../prisma/prisma.service';
import { PointsService } from '../points/points.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cache } from 'cache-manager';
import {
  ResourceNotFoundException,
  InvalidInputException,
} from '../common/exceptions/custom.exception';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { channelCacheKeys } from './cache/channel.cache-keys';
import { ReferralCodeService } from '../referral/referral-code.service';
import { Prisma } from '@prisma/client';

describe('ChannelService', () => {
  let service: ChannelService;
  let prisma: jest.Mocked<Partial<PrismaService>>;
  let cacheManager: jest.Mocked<Partial<Cache>>;
  let pointsService: jest.Mocked<Partial<PointsService>>;
  let eventEmitter: jest.Mocked<Partial<EventEmitter2>>;
  let referralCodeService: jest.Mocked<Partial<ReferralCodeService>>;

  const mockChannel = {
    id: 1,
    name: 'Test Channel',
    webPath: 'test_channel',
    platformUrl: 'https://chzzk.naver.com/test',
    topBannerUrl: null,
    leftBannerUrl: null,
    rightBannerUrl: null,
    profileImageUrl: null,
    additionalLinks: [],
    themeColor: '#000000',
    channelDescription: 'Test description',
    createdAt: new Date(),
    updatedAt: new Date(),
    userId: 100,
    verifications: [{ status: 'PENDING' }],
    user: {
      id: 100,
      nickname: 'TestUser',
      isProSubscriber: false,
      proSubscriptionEndAt: null,
      isAmbassador: false,
    },
    customization: {
      customCss: null,
      isEnabled: false,
    },
  };

  beforeEach(() => {
    prisma = {
      channel: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      song: {
        count: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      clip: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      category: {
        count: jest.fn(),
      },
      artist: {
        count: jest.fn(),
      },
      channelManager: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      pointTransaction: {
        findFirst: jest.fn(),
      },
      channelTransferRequest: {
        findFirst: jest.fn(),
      },
      communityBoardGroup: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
        create: jest.fn(),
      },
      communityBoard: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
        create: jest.fn(),
      },
      communityCategory: {
        create: jest.fn(),
      },
      syncRoomChannel: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(),
    } as any;

    // Default $transaction passes the prisma mock itself as the tx client so
    // tests can assert against the same prisma.* mocks (channel.delete etc).
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback(prisma),
    );

    cacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    } as any;

    pointsService = {
      grant: jest.fn(),
      reverse: jest.fn(),
      reverseWithTx: jest.fn(),
    } as any;

    eventEmitter = {
      emit: jest.fn(),
    } as any;

    referralCodeService = {
      ensureForUser: jest.fn().mockResolvedValue('STREAM01'),
    } as any;

    service = new ChannelService(
      prisma as unknown as PrismaService,
      cacheManager as unknown as Cache,
      pointsService as unknown as PointsService,
      eventEmitter as unknown as EventEmitter2,
      referralCodeService as unknown as ReferralCodeService,
    );
  });

  describe('findByWebPath - 최적화된 쿼리', () => {
    it('채널을 찾고 _count를 별도 쿼리로 조회해야 함', async () => {
      const webPath = 'test_channel';

      (prisma.channel!.findFirst as jest.Mock).mockResolvedValue(mockChannel);
      (prisma.song!.count as jest.Mock).mockResolvedValue(10);
      (prisma.category!.count as jest.Mock).mockResolvedValue(5);
      (prisma.artist!.count as jest.Mock).mockResolvedValue(3);

      const result = await service.findByWebPath(webPath);

      // 채널 조회 확인
      expect(prisma.channel!.findFirst).toHaveBeenCalledWith({
        where: { webPath: webPath.toLowerCase() },
        select: expect.not.objectContaining({ _count: expect.anything() }),
      });

      // 카운트 쿼리가 병렬로 호출되었는지 확인
      expect(prisma.song!.count).toHaveBeenCalledWith({
        where: { channelId: mockChannel.id },
      });
      expect(prisma.category!.count).toHaveBeenCalledWith({
        where: { channelId: mockChannel.id },
      });
      expect(prisma.artist!.count).toHaveBeenCalledWith({
        where: { channelId: mockChannel.id },
      });

      // 결과 확인
      expect(result).toEqual({
        ...mockChannel,
        _count: { songs: 10, categories: 5, artists: 3 },
      });
    });

    it('대문자 webPath를 소문자로 변환해서 조회해야 함', async () => {
      const webPath = 'TEST_CHANNEL';

      (prisma.channel!.findFirst as jest.Mock).mockResolvedValue(mockChannel);
      (prisma.song!.count as jest.Mock).mockResolvedValue(0);
      (prisma.category!.count as jest.Mock).mockResolvedValue(0);
      (prisma.artist!.count as jest.Mock).mockResolvedValue(0);

      await service.findByWebPath(webPath);

      expect(prisma.channel!.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { webPath: 'test_channel' },
        }),
      );
    });

    it('채널이 없으면 ResourceNotFoundException을 던져야 함', async () => {
      (prisma.channel!.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.findByWebPath('nonexistent')).rejects.toThrow(
        ResourceNotFoundException,
      );

      // 채널이 없으면 count 쿼리는 호출되지 않아야 함
      expect(prisma.song!.count).not.toHaveBeenCalled();
    });
  });

  describe('findById - 최적화된 쿼리', () => {
    it('ID로 채널을 찾고 _count를 별도 쿼리로 조회해야 함', async () => {
      const channelId = 1;

      (prisma.channel!.findFirst as jest.Mock).mockResolvedValue(mockChannel);
      (prisma.song!.count as jest.Mock).mockResolvedValue(20);
      (prisma.category!.count as jest.Mock).mockResolvedValue(8);
      (prisma.artist!.count as jest.Mock).mockResolvedValue(4);

      const result = await service.findById(channelId);

      expect(prisma.channel!.findFirst).toHaveBeenCalledWith({
        where: { id: channelId },
        select: expect.not.objectContaining({ _count: expect.anything() }),
      });

      expect(result._count).toEqual({
        songs: 20,
        categories: 8,
        artists: 4,
      });
    });

    it('채널이 없으면 ResourceNotFoundException을 던져야 함', async () => {
      (prisma.channel!.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.findById(999)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });
  });

  describe('findByIdentifier', () => {
    it('숫자 문자열이면 findById를 호출해야 함', async () => {
      (prisma.channel!.findFirst as jest.Mock).mockResolvedValue(mockChannel);
      (prisma.song!.count as jest.Mock).mockResolvedValue(0);
      (prisma.category!.count as jest.Mock).mockResolvedValue(0);
      (prisma.artist!.count as jest.Mock).mockResolvedValue(0);

      await service.findByIdentifier('123');

      expect(prisma.channel!.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 123 },
        }),
      );
    });

    it('숫자가 아닌 문자열이면 findByWebPath를 호출해야 함', async () => {
      (prisma.channel!.findFirst as jest.Mock).mockResolvedValue(mockChannel);
      (prisma.song!.count as jest.Mock).mockResolvedValue(0);
      (prisma.category!.count as jest.Mock).mockResolvedValue(0);
      (prisma.artist!.count as jest.Mock).mockResolvedValue(0);

      await service.findByIdentifier('my_channel');

      expect(prisma.channel!.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { webPath: 'my_channel' },
        }),
      );
    });

    it('숫자와 문자가 섞인 경우 findByWebPath를 호출해야 함', async () => {
      (prisma.channel!.findFirst as jest.Mock).mockResolvedValue(mockChannel);
      (prisma.song!.count as jest.Mock).mockResolvedValue(0);
      (prisma.category!.count as jest.Mock).mockResolvedValue(0);
      (prisma.artist!.count as jest.Mock).mockResolvedValue(0);

      await service.findByIdentifier('channel123');

      expect(prisma.channel!.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { webPath: 'channel123' },
        }),
      );
    });
  });

  describe('findPrimaryByUserId - 최적화된 쿼리', () => {
    it('사용자의 첫 번째 채널을 찾고 _count를 별도 쿼리로 조회해야 함', async () => {
      const userId = 100;

      (prisma.channel!.findFirst as jest.Mock).mockResolvedValue(mockChannel);
      (prisma.song!.count as jest.Mock).mockResolvedValue(15);
      (prisma.category!.count as jest.Mock).mockResolvedValue(6);
      (prisma.artist!.count as jest.Mock).mockResolvedValue(2);

      const result = await service.findPrimaryByUserId(userId);

      expect(prisma.channel!.findFirst).toHaveBeenCalledWith({
        where: { userId: userId },
        orderBy: { createdAt: 'asc' },
        select: expect.not.objectContaining({ _count: expect.anything() }),
      });

      expect(result._count).toEqual({
        songs: 15,
        categories: 6,
        artists: 2,
      });
    });

    it('채널이 없으면 ResourceNotFoundException을 던져야 함', async () => {
      (prisma.channel!.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.findPrimaryByUserId(999)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });
  });

  describe('getChannelCounts (private) - 성능 테스트', () => {
    it('세 개의 count 쿼리가 병렬로 실행되어야 함', async () => {
      const channelId = 1;
      let callOrder: string[] = [];

      // 각 쿼리에 지연을 주어 병렬 실행을 확인
      (prisma.song!.count as jest.Mock).mockImplementation(async () => {
        callOrder.push('song-start');
        await new Promise((r) => setTimeout(r, 10));
        callOrder.push('song-end');
        return 10;
      });
      (prisma.category!.count as jest.Mock).mockImplementation(async () => {
        callOrder.push('category-start');
        await new Promise((r) => setTimeout(r, 10));
        callOrder.push('category-end');
        return 5;
      });
      (prisma.artist!.count as jest.Mock).mockImplementation(async () => {
        callOrder.push('artist-start');
        await new Promise((r) => setTimeout(r, 10));
        callOrder.push('artist-end');
        return 3;
      });

      (prisma.channel!.findFirst as jest.Mock).mockResolvedValue(mockChannel);

      await service.findById(channelId);

      // 병렬 실행이면 모든 start가 먼저, 그 다음 end가 와야 함
      const startIndices = ['song-start', 'category-start', 'artist-start'].map(
        (s) => callOrder.indexOf(s),
      );
      const endIndices = ['song-end', 'category-end', 'artist-end'].map((s) =>
        callOrder.indexOf(s),
      );

      // 모든 start가 모든 end보다 먼저 호출되어야 함 (병렬 실행의 증거)
      const maxStartIndex = Math.max(...startIndices);
      const minEndIndex = Math.min(...endIndices);
      expect(maxStartIndex).toBeLessThan(minEndIndex);
    });
  });

  describe('create', () => {
    let previousAppEnv: string | undefined;

    const baseCreateData = {
      user: { connect: { id: 100 } },
      name: '테스트 채널',
      webPath: 'test_channel',
      platformUrl: null as string | null,
      topBannerUrl: null,
      leftBannerUrl: null,
      rightBannerUrl: null,
      profileImageUrl: null,
      themeColor: '#ff6b35',
      channelDescription: null,
      additionalLinks: [],
    };

    beforeEach(() => {
      previousAppEnv = process.env.APP_ENV;
      process.env.APP_ENV = 'qa';
      (prisma.channel!.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.channel!.count as jest.Mock).mockResolvedValue(0);
      (prisma.channelTransferRequest!.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.channel!.create as jest.Mock).mockResolvedValue({
        ...mockChannel,
        id: 99,
      });
      (pointsService.grant as jest.Mock).mockResolvedValue({});
    });

    afterEach(() => {
      if (previousAppEnv === undefined) {
        delete process.env.APP_ENV;
      } else {
        process.env.APP_ENV = previousAppEnv;
      }
    });

    it('production에서도 사용자 채널 생성이 성공해야 함', async () => {
      process.env.APP_ENV = 'prod';

      await service.create(100, baseCreateData);

      expect(prisma.channel!.findFirst).toHaveBeenCalled();
      expect(prisma.channel!.create).toHaveBeenCalled();
    });

    it('platformUrl이 null이면 채널 생성이 성공해야 함 (기타 채널)', async () => {
      const createData = { ...baseCreateData, platformUrl: null };

      await service.create(100, createData);

      expect(prisma.channel!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ platformUrl: null }),
        }),
      );
      expect(referralCodeService.ensureForUser).toHaveBeenCalledWith(
        100,
        prisma,
      );
    });

    it('platformUrl이 유효한 URL이면 중복 확인 후 생성해야 함', async () => {
      const createData = {
        ...baseCreateData,
        platformUrl: 'https://chzzk.naver.com/test',
      };

      await service.create(100, createData);

      // platformUrl 중복 확인 호출
      expect(prisma.channel!.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { platformUrl: 'https://chzzk.naver.com/test' },
        }),
      );
      expect(prisma.channel!.create).toHaveBeenCalled();
    });

    it('platformUrl이 빈 문자열이면 중복 확인을 건너뛰어야 함', async () => {
      const createData = { ...baseCreateData, platformUrl: '' };

      await service.create(100, createData);

      // 빈 문자열은 falsy이므로 platformUrl 중복 확인이 호출되지 않아야 함
      const findFirstCalls = (prisma.channel!.findFirst as jest.Mock).mock.calls;
      const platformUrlCheck = findFirstCalls.find(
        (call: any) => call[0]?.where?.platformUrl !== undefined,
      );
      expect(platformUrlCheck).toBeUndefined();
    });

    it('platformUrl이 중복이면 InvalidInputException을 던져야 함', async () => {
      const createData = {
        ...baseCreateData,
        platformUrl: 'https://chzzk.naver.com/duplicate',
      };

      // webPath 중복 확인은 통과, platformUrl 중복 확인에서 기존 채널 반환
      (prisma.channel!.findFirst as jest.Mock)
        .mockResolvedValueOnce(null) // webPath 중복 확인
        .mockResolvedValueOnce({ id: 50 }); // platformUrl 중복

      await expect(service.create(100, createData)).rejects.toThrow(
        InvalidInputException,
      );
      expect(prisma.channel!.create).not.toHaveBeenCalled();
    });

    it('이미 채널을 보유한 사용자는 생성할 수 없어야 함', async () => {
      (prisma.channel!.count as jest.Mock).mockResolvedValue(1);

      await expect(service.create(100, baseCreateData)).rejects.toThrow(
        InvalidInputException,
      );
      expect(prisma.channel!.create).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('채널이 없으면 ResourceNotFoundException을 던져야 함', async () => {
      (prisma.channel!.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.delete(999, 100)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('소유자는 채널을 삭제할 수 있어야 함', async () => {
      const deletableChannel = {
        id: 1,
        userId: 100,
        webPath: 'test_channel',
      };

      (prisma.channel!.findFirst as jest.Mock).mockResolvedValue(deletableChannel);
      (prisma.pointTransaction!.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.channel!.delete as jest.Mock).mockResolvedValue({ id: 1 });

      const result = await service.delete(1, 100);

      expect(prisma.channel!.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(cacheManager.del).toHaveBeenCalledWith(
        channelCacheKeys.byUser(deletableChannel.userId),
      );
      expect(cacheManager.del).toHaveBeenCalledWith(
        channelCacheKeys.byWebPath(deletableChannel.webPath),
      );
      expect(result).toEqual({ message: '뮤직북이 성공적으로 삭제되었습니다.' });
    });

    it('매니저 권한이 있어도 소유자가 아니면 삭제할 수 없어야 함', async () => {
      const deletableChannel = {
        id: 1,
        userId: 100,
        webPath: 'test_channel',
      };

      (prisma.channel!.findFirst as jest.Mock).mockResolvedValue(deletableChannel);

      await expect(service.delete(1, 200)).rejects.toThrow(UnauthorizedException);
      expect(prisma.channel!.delete).not.toHaveBeenCalled();
    });

    it('관리자는 소유자가 아니어도 삭제할 수 있어야 함', async () => {
      const deletableChannel = {
        id: 1,
        userId: 100,
        webPath: 'test_channel',
      };

      (prisma.channel!.findFirst as jest.Mock).mockResolvedValue(deletableChannel);
      (prisma.pointTransaction!.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.channel!.delete as jest.Mock).mockResolvedValue({ id: 1 });

      await service.delete(1, 200, { actorIsAdmin: true });

      expect(prisma.channel!.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(cacheManager.del).toHaveBeenCalledWith(
        channelCacheKeys.byUser(deletableChannel.userId),
      );
    });

    it('생성 보너스 거래가 있으면 채널 삭제와 같은 트랜잭션에서 reverse해야 함', async () => {
      const deletableChannel = {
        id: 1,
        userId: 100,
        webPath: 'test_channel',
      };

      (prisma.channel!.findFirst as jest.Mock).mockResolvedValue(deletableChannel);
      (prisma.pointTransaction!.findFirst as jest.Mock).mockResolvedValue({
        id: 77,
      });
      (pointsService.reverseWithTx as jest.Mock).mockResolvedValue({ id: 88 });
      (prisma.channel!.delete as jest.Mock).mockResolvedValue({ id: 1 });

      await service.delete(1, 100);

      expect(pointsService.reverseWithTx).toHaveBeenCalledWith(
        prisma,
        100,
        '77',
        { allowNegative: true },
      );
      expect(pointsService.reverse).not.toHaveBeenCalled();
    });

    it('예상하지 못한 FK 차단은 500 대신 ConflictException으로 변환해야 함', async () => {
      const deletableChannel = {
        id: 1,
        userId: 100,
        webPath: 'test_channel',
      };
      const fkError = new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint violated',
        {
          code: 'P2003',
          clientVersion: '6.12.0',
          meta: { field_name: 'future_channel_id_fkey' },
        },
      );

      (prisma.channel!.findFirst as jest.Mock).mockResolvedValue(deletableChannel);
      (prisma.pointTransaction!.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.channel!.delete as jest.Mock).mockRejectedValue(fkError);

      await expect(service.delete(1, 100)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(cacheManager.del).not.toHaveBeenCalled();
    });
  });

  describe('hasChannelContentPermission', () => {
    it('소유자면 true 반환', async () => {
      jest.spyOn(service, 'validateChannelOwnership').mockResolvedValue(true);
      const result = await service.hasChannelContentPermission(1, 10);
      expect(result).toBe(true);
    });

    it('active + canManageContent 매니저면 true', async () => {
      jest.spyOn(service, 'validateChannelOwnership').mockResolvedValue(false);
      jest.spyOn(service, 'getManagerPermissions').mockResolvedValue({
        isActive: true,
        canManageContent: true,
        canManageSettings: false,
        canManageProfile: false,
        canManageGuestbook: false,
        canManageCustomization: false,
        canManageEmoticons: false,
      } as any);
      const result = await service.hasChannelContentPermission(2, 10);
      expect(result).toBe(true);
    });

    it('canManageContent 없는 매니저면 false', async () => {
      jest.spyOn(service, 'validateChannelOwnership').mockResolvedValue(false);
      jest.spyOn(service, 'getManagerPermissions').mockResolvedValue({
        isActive: true,
        canManageContent: false,
        canManageSettings: true,
        canManageProfile: false,
        canManageGuestbook: false,
        canManageCustomization: false,
        canManageEmoticons: false,
      } as any);
      const result = await service.hasChannelContentPermission(3, 10);
      expect(result).toBe(false);
    });

    it('매니저 아니고 소유자 아니면 false', async () => {
      jest.spyOn(service, 'validateChannelOwnership').mockResolvedValue(false);
      jest.spyOn(service, 'getManagerPermissions').mockResolvedValue(null);
      const result = await service.hasChannelContentPermission(4, 10);
      expect(result).toBe(false);
    });
  });
});
