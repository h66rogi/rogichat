import { EventEmitter2 } from '@nestjs/event-emitter';
import { SongRequestStatus } from '@prisma/client';
import { SongRequestService } from './song-request.service';
import { SongRequestQueueService } from './song-request-queue.service';
import { SongPricingService } from '../song-pricing/song-pricing.service';
import { MetricsService } from '../metrics';
import { ChannelService } from '../channel/channel.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SongRequestService', () => {
  let service: SongRequestService;
  let mockPrisma: any;
  let mockQueue: any;
  let mockEventEmitter: EventEmitter2;
  let mockSongPricing: any;
  let mockMetrics: any;
  let mockRedis: any;
  let mockChannelService: {
    validateChannelOwnership: jest.Mock;
    getManagerPermissions: jest.Mock;
  };

  beforeEach(() => {
    mockPrisma = {
      liveSession: { findUnique: jest.fn() },
      liveSessionSettings: {
        findUnique: jest.fn().mockResolvedValue({
          allowAnonymous: false,
          requestMode: 'EVERYONE',
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ nickname: '테스터닉' }),
      },
    };
    mockQueue = { addToQueue: jest.fn() };
    mockEventEmitter = { emit: jest.fn() } as any;
    mockSongPricing = {};
    mockMetrics = {
      songRequestUntrustedPayloadStrippedTotal: { inc: jest.fn() },
    };
    mockRedis = {
      set: jest.fn().mockResolvedValue('OK'),
    };
    mockChannelService = {
      validateChannelOwnership: jest.fn(),
      getManagerPermissions: jest.fn(),
    };

    service = new SongRequestService(
      mockPrisma as unknown as PrismaService,
      mockQueue as unknown as SongRequestQueueService,
      mockEventEmitter,
      mockSongPricing as unknown as SongPricingService,
      mockMetrics as unknown as MetricsService,
      mockChannelService as unknown as ChannelService,
      mockRedis,
    );
  });

  describe('isChannelOperator', () => {
    it('returns true immediately for site admin (skips owner/manager lookup)', async () => {
      const result = await service.isChannelOperator(1, 100, true);
      expect(result).toBe(true);
      expect(mockChannelService.validateChannelOwnership).not.toHaveBeenCalled();
      expect(mockChannelService.getManagerPermissions).not.toHaveBeenCalled();
    });

    it('returns true for channel owner', async () => {
      mockChannelService.validateChannelOwnership.mockResolvedValue(true);
      const result = await service.isChannelOperator(1, 100, false);
      expect(result).toBe(true);
      expect(mockChannelService.getManagerPermissions).not.toHaveBeenCalled();
    });

    it('returns true for active manager (regardless of specific permission)', async () => {
      mockChannelService.validateChannelOwnership.mockResolvedValue(false);
      mockChannelService.getManagerPermissions.mockResolvedValue({
        isActive: true,
        canManageContent: false,
        canManageSettings: false,
        canManageProfile: false,
        canManageGuestbook: false,
        canManageCustomization: false,
        canManageEmoticons: false,
      });
      const result = await service.isChannelOperator(1, 100, false);
      expect(result).toBe(true);
    });

    it('returns false for inactive manager', async () => {
      mockChannelService.validateChannelOwnership.mockResolvedValue(false);
      mockChannelService.getManagerPermissions.mockResolvedValue({
        isActive: false,
        canManageContent: true,
        canManageSettings: true,
        canManageProfile: true,
        canManageGuestbook: true,
        canManageCustomization: true,
        canManageEmoticons: true,
      });
      const result = await service.isChannelOperator(1, 100, false);
      expect(result).toBe(false);
    });

    it('returns false when no manager record exists', async () => {
      mockChannelService.validateChannelOwnership.mockResolvedValue(false);
      mockChannelService.getManagerPermissions.mockResolvedValue(null);
      const result = await service.isChannelOperator(1, 100, false);
      expect(result).toBe(false);
    });
  });

  describe('getChannelIdByLiveSessionId', () => {
    it('returns channelId when session exists', async () => {
      mockPrisma.liveSession.findUnique.mockResolvedValue({ channelId: 42 });
      const result = await service.getChannelIdByLiveSessionId(1);
      expect(result).toBe(42);
    });

    it('returns null when session not found', async () => {
      mockPrisma.liveSession.findUnique.mockResolvedValue(null);
      const result = await service.getChannelIdByLiveSessionId(1);
      expect(result).toBeNull();
    });
  });

  describe('createRequest forwards allowManualBypass to queue', () => {
    beforeEach(() => {
      mockQueue.addToQueue.mockResolvedValue({
        id: 1,
        liveSessionId: 1,
        formattedPrice: '1,000원',
      });
    });

    const dto = {
      liveSessionId: 1,
      songId: 42,
      rawArtist: 'a',
      rawTitle: 't',
      requesterPlatformId: 'p',
      requesterNickname: 'n',
    } as any;

    it('passes allowManualBypass=true through to queue', async () => {
      await service.createRequest(dto, 100, false, true);
      expect(mockQueue.addToQueue).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ allowManualBypass: true, requestUserId: 100 }),
      );
    });

    it('defaults allowManualBypass to undefined when not specified', async () => {
      await service.createRequest(dto, 100, false);
      expect(mockQueue.addToQueue).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ allowManualBypass: undefined }),
      );
    });

    it('strips client-provided source/donation fields when not internal (trust boundary)', async () => {
      const maliciousDto = {
        ...dto,
        source: 'DONATION',
        donationAmount: 10000,
        donationNativeAmount: 100,
        donationCurrency: 'SOOP_BALLOON',
      } as any;
      await service.createRequest(maliciousDto, 100, false, false);
      expect(mockQueue.addToQueue).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          source: 'MANUAL',
          donationAmount: undefined,
          donationNativeAmount: undefined,
          donationCurrency: undefined,
        }),
      );
    });

    it('preserves source/donation fields when internal (trusted dispatcher path)', async () => {
      const internalDto = {
        ...dto,
        source: 'DONATION',
        donationAmount: 10000,
        donationNativeAmount: 100,
        donationCurrency: 'SOOP_BALLOON',
      } as any;
      await service.createRequest(internalDto, 100, true, false);
      expect(mockQueue.addToQueue).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          source: 'DONATION',
          donationAmount: 10000,
          donationNativeAmount: 100,
          donationCurrency: 'SOOP_BALLOON',
        }),
      );
    });

    it('콘솔 경로(isConsoleRequest=true) → DTO identity 신뢰하여 통과', async () => {
      const consoleDto = {
        ...dto,
        requesterPlatformId: 'operator-manual-token',
        requesterNickname: '시청자A',
      } as any;
      mockPrisma.liveSessionSettings.findUnique.mockResolvedValue({
        allowAnonymous: false,
        requestMode: 'EVERYONE',
      });
      await service.createRequest(
        consoleDto,
        undefined,
        false,
        true,
        undefined,
        true, // isConsoleRequest
      );
      expect(mockQueue.addToQueue).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          allowManualBypass: true,
          requesterPlatformId: 'operator-manual-token',
          requesterNickname: '시청자A',
          isAnonymous: false,
        }),
      );
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.liveSessionSettings.findUnique).not.toHaveBeenCalled();
    });

    it('콘솔 경로에서 DTO source=DONATION이어도 MANUAL로 강제 (donation trust는 internal만)', async () => {
      const consoleDto = {
        ...dto,
        requesterPlatformId: 'operator-manual',
        requesterNickname: '시청자B',
        source: 'DONATION',
        donationAmount: 99999,
      } as any;
      await service.createRequest(
        consoleDto,
        undefined,
        false,
        true,
        undefined,
        true,
      );
      expect(mockQueue.addToQueue).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          source: 'MANUAL',
          donationAmount: undefined,
        }),
      );
    });

    it('콘솔 경로 + DTO identity 누락 → 400', async () => {
      const invalidDto = { ...dto } as any;
      delete invalidDto.requesterPlatformId;
      await expect(
        service.createRequest(
          invalidDto,
          undefined,
          false,
          true,
          undefined,
          true,
        ),
      ).rejects.toThrow(/requesterPlatformId/);
    });

    it('비신뢰 경로에서 source/donation 위조 시도 → untrusted_payload_stripped_total 메트릭 inc (entrypoint=public)', async () => {
      const maliciousDto = {
        ...dto,
        source: 'DONATION',
        donationAmount: 10000,
        donationNativeAmount: 100,
        donationCurrency: 'SOOP_BALLOON',
      } as any;
      await service.createRequest(maliciousDto, 100, false, false);
      const incMock =
        mockMetrics.songRequestUntrustedPayloadStrippedTotal.inc as jest.Mock;
      expect(incMock).toHaveBeenCalledWith({ field: 'source', entrypoint: 'public' });
      expect(incMock).toHaveBeenCalledWith({ field: 'donationAmount', entrypoint: 'public' });
      expect(incMock).toHaveBeenCalledWith({ field: 'donationNativeAmount', entrypoint: 'public' });
      expect(incMock).toHaveBeenCalledWith({ field: 'donationCurrency', entrypoint: 'public' });
    });

    it('콘솔 경로에서 위조 시도 → entrypoint=console로 inc', async () => {
      const maliciousDto = {
        ...dto,
        source: 'DONATION',
        donationAmount: 5000,
      } as any;
      await service.createRequest(
        maliciousDto,
        undefined,
        false,
        true,
        undefined,
        true, // isConsoleRequest
      );
      const incMock =
        mockMetrics.songRequestUntrustedPayloadStrippedTotal.inc as jest.Mock;
      expect(incMock).toHaveBeenCalledWith({ field: 'source', entrypoint: 'console' });
      expect(incMock).toHaveBeenCalledWith({ field: 'donationAmount', entrypoint: 'console' });
    });

    it('internal dispatcher(isInternalRequest=true) → strip 안 함, 메트릭 inc 없음', async () => {
      const internalDto = {
        ...dto,
        source: 'DONATION',
        donationAmount: 10000,
      } as any;
      await service.createRequest(internalDto, 100, true, false);
      expect(
        mockMetrics.songRequestUntrustedPayloadStrippedTotal.inc,
      ).not.toHaveBeenCalled();
    });

    it('비신뢰 경로 + 위조 필드 없음(MANUAL/donation 미지정) → 메트릭 inc 없음', async () => {
      const cleanDto = { ...dto } as any;
      await service.createRequest(cleanDto, 100, false, false);
      expect(
        mockMetrics.songRequestUntrustedPayloadStrippedTotal.inc,
      ).not.toHaveBeenCalled();
    });

    it('공개 경로 운영자(allowManualBypass=true + isConsoleRequest=false) → DTO identity 무시, userId 기반 재구성 (P2 사칭 방어)', async () => {
      // 운영자가 공개 /song-requests에 DTO로 requesterPlatformId='web_999', nickname='타인닉'을
      // 쏴도 서버가 userId=100 기반으로 재구성해야 함
      const maliciousDto = {
        ...dto,
        requesterPlatformId: 'web_999', // 다른 유저 사칭 시도
        requesterNickname: '타인닉',
      } as any;
      await service.createRequest(
        maliciousDto,
        100, // 로그인 운영자
        false,
        true, // allowManualBypass (operator)
        undefined,
        false, // isConsoleRequest=false (공개 경로)
      );
      expect(mockQueue.addToQueue).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          requesterPlatformId: 'web_100', // userId 기반 재구성
          requesterNickname: '테스터닉', // user.findUnique 결과
          allowManualBypass: true,
          isAnonymous: false,
        }),
      );
      expect(mockPrisma.user.findUnique).toHaveBeenCalled();
    });
  });

  describe('getSongRequestHistory', () => {
    beforeEach(() => {
      mockPrisma.songRequest = {
        findMany: jest.fn(),
        count: jest.fn(),
      };
    });

    it('songId/channelId 필터 + REJECTED 제외 + createdAt DESC + 페이지네이션 + 익명/탈퇴 마스킹', async () => {
      mockPrisma.songRequest.findMany.mockResolvedValue([
        {
          id: 1,
          requesterNickname: '치무',
          isAnonymous: false,
          status: 'COMPLETED',
          source: 'CHAT',
          donationAmount: null,
          donationCurrency: null,
          createdAt: new Date('2026-05-10T00:00:00.000Z'),
          requestUser: { deletedAt: null },
        },
        {
          id: 2,
          requesterNickname: 'secretUser',
          isAnonymous: true,
          status: 'COMPLETED',
          source: 'DONATION',
          donationAmount: 5000,
          donationCurrency: 'KRW',
          createdAt: new Date('2026-05-09T00:00:00.000Z'),
          requestUser: { deletedAt: null },
        },
        {
          id: 3,
          requesterNickname: '오래된닉',
          isAnonymous: false,
          status: 'COMPLETED',
          source: 'CHAT',
          donationAmount: null,
          donationCurrency: null,
          createdAt: new Date('2026-05-08T00:00:00.000Z'),
          requestUser: { deletedAt: new Date('2026-05-09T00:00:00.000Z') },
        },
      ]);
      mockPrisma.songRequest.count.mockResolvedValue(3);

      const result = await service.getSongRequestHistory({
        songId: 10,
        channelId: 20,
        page: 1,
        limit: 20,
      });

      expect(mockPrisma.songRequest.findMany).toHaveBeenCalledWith({
        where: {
          songId: 10,
          song: { channelId: 20 },
          status: { not: 'REJECTED' },
        },
        select: {
          id: true,
          requesterNickname: true,
          isAnonymous: true,
          status: true,
          source: true,
          donationAmount: true,
          donationCurrency: true,
          createdAt: true,
          requestUser: { select: { deletedAt: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });

      expect(result.requests).toEqual([
        {
          id: 1,
          requesterNickname: '치무',
          isAnonymous: false,
          status: 'COMPLETED',
          source: 'CHAT',
          donationAmount: null,
          donationCurrency: null,
          createdAt: '2026-05-10T00:00:00.000Z',
        },
        {
          id: 2,
          requesterNickname: '익명',
          isAnonymous: true,
          status: 'COMPLETED',
          source: 'DONATION',
          donationAmount: 5000,
          donationCurrency: 'KRW',
          createdAt: '2026-05-09T00:00:00.000Z',
        },
        {
          id: 3,
          requesterNickname: '(탈퇴한 사용자)',
          isAnonymous: false,
          status: 'COMPLETED',
          source: 'CHAT',
          donationAmount: null,
          donationCurrency: null,
          createdAt: '2026-05-08T00:00:00.000Z',
        },
      ]);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 3,
        totalPages: 1,
      });
    });

    it('page=2, limit=10 → skip=10, take=10', async () => {
      mockPrisma.songRequest.findMany.mockResolvedValue([]);
      mockPrisma.songRequest.count.mockResolvedValue(15);

      const result = await service.getSongRequestHistory({
        songId: 1,
        channelId: 2,
        page: 2,
        limit: 10,
      });

      expect(mockPrisma.songRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
      expect(result.pagination).toEqual({
        page: 2,
        limit: 10,
        total: 15,
        totalPages: 2,
      });
    });

    it('page/limit 미지정 시 default (1/20)', async () => {
      mockPrisma.songRequest.findMany.mockResolvedValue([]);
      mockPrisma.songRequest.count.mockResolvedValue(0);

      const result = await service.getSongRequestHistory({
        songId: 1,
        channelId: 2,
      });

      expect(mockPrisma.songRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      });
    });
  });

  describe('playNext', () => {
    beforeEach(() => {
      mockSongPricing.getPricingSettings = jest.fn().mockResolvedValue({});
      mockSongPricing.extractPricingData = jest
        .fn()
        .mockReturnValue({ currencyConfigs: [] });
      mockSongPricing.formatCalculatedPrice = jest.fn().mockReturnValue('무료');
      mockPrisma.liveSession.findUnique.mockResolvedValue({
        channelId: 7,
        platform: 'CHZZK',
      });
    });

    it('다음 곡 후보로 PENDING/ACCEPTED를 모두 조회하고 ACCEPTED도 PLAYING으로 승격한다', async () => {
      const tx = {
        liveSession: {
          findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
          // GATE 0: playNext bumps playbackRevision inside the transaction.
          update: jest.fn().mockResolvedValue({ id: 1, playbackRevision: 1 }),
        },
        songRequest: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({
              id: 10,
              status: SongRequestStatus.PLAYING,
              playedAt: new Date('2026-06-20T01:00:00.000Z'),
            })
            .mockResolvedValueOnce({
              id: 11,
              status: SongRequestStatus.ACCEPTED,
              playedAt: null,
            }),
          update: jest
            .fn()
            .mockResolvedValueOnce({
              id: 10,
              liveSessionId: 1,
              status: SongRequestStatus.COMPLETED,
              playedAt: new Date('2026-06-20T01:00:00.000Z'),
              calculatedPrice: null,
            })
            .mockResolvedValueOnce({
              id: 11,
              liveSessionId: 1,
              status: SongRequestStatus.PLAYING,
              playedAt: new Date('2026-06-20T01:00:01.000Z'),
              calculatedPrice: null,
            }),
        },
      };
      mockPrisma.$transaction = jest.fn((callback) => callback(tx));

      await service.playNext(1);

      expect(tx.songRequest.findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            status: {
              in: [SongRequestStatus.PENDING, SongRequestStatus.ACCEPTED],
            },
          }),
        }),
      );
      expect(tx.songRequest.update).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { id: 11 },
          data: expect.objectContaining({ status: SongRequestStatus.PLAYING }),
        }),
      );
    });
  });
});
