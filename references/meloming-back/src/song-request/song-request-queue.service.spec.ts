import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChannelUserBlockFeature, PriceSource } from '@prisma/client';
import { SongRequestQueueService } from './song-request-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { SongMatcherService } from './song-matcher.service';
import { SongPricingService } from '../song-pricing/song-pricing.service';
import { MetricsService } from '../metrics';
import { SongRequestUserBlockService } from './song-request-user-block.service';

describe('SongRequestQueueService', () => {
  let service: SongRequestQueueService;
  let mockPrisma: any;
  let mockEventEmitter: EventEmitter2;
  let mockSongMatcher: any;
  let mockSongPricing: any;
  let mockMetrics: any;
  let mockUserBlockService: any;
  let mockChannelSongRequestSettingsService: any;

  const buildSessionWithSettings = (
    overrides: {
      enforceDonationMinimumPrice?: boolean;
      preventDuplicateSongs?: boolean;
    } = {},
  ) => ({
    id: 1,
    channelId: 10,
    platform: 'CHZZK',
    status: 'ACTIVE',
    settings: {
      requestEnabled: true,
      paused: false,
      requestCommand: '!신청',
      maxQueueSize: 50,
      donationPriorityEnabled: true,
      donationOnlyEnabled: false,
      enforceDonationMinimumPrice:
        overrides.enforceDonationMinimumPrice ?? true,
      requestMode: 'EVERYONE',
      chatRequestEnabled: true,
      donationRequestEnabled: true,
      requireSongMatch: false,
      preventDuplicateSongs: overrides.preventDuplicateSongs ?? false,
      blockedCategoryIds: [],
      maxRequestsPerUser: 0,
      maxTotalRequests: 50,
    },
  });

  beforeEach(() => {
    mockPrisma = {
      liveSession: {
        findUnique: jest.fn().mockResolvedValue(buildSessionWithSettings()),
        // GATE 0: addToQueue bumps playbackRevision inside the create transaction.
        update: jest.fn().mockResolvedValue({ id: 1, playbackRevision: 1 }),
      },
      songRequest: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({
          id: 999,
          liveSessionId: 1,
          songId: 42,
          donationAmount: 0,
          calculatedPrice: null,
          priceSource: PriceSource.FREE,
        }),
      },
      songCategory: { findMany: jest.fn().mockResolvedValue([]) },
      song: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      category: { findMany: jest.fn().mockResolvedValue([]) },
      user: {
        findUnique: jest.fn().mockResolvedValue({ isIdentityVerified: true }),
      },
      userPlatformVerification: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    // GATE 0: addToQueue now wraps create + revision bump in a $transaction.
    // Run the callback against the same mock client so create/updateMany/update resolve.
    mockPrisma.$transaction = jest.fn(async (cb: any) => cb(mockPrisma));
    mockEventEmitter = { emit: jest.fn() } as any;
    mockSongMatcher = {
      matchSong: jest.fn(),
      matchByKeyword: jest.fn(),
    };
    mockSongPricing = {
      calculatePrice: jest.fn().mockResolvedValue({
        price: 1000,
        source: PriceSource.SONG,
        formattedPrice: '1,000원',
      }),
    };
    mockMetrics = {
      songRequestsCreatedTotal: { inc: jest.fn() },
      songRequestDonationAmountKrw: { inc: jest.fn() },
      melomingChatUnknownCurrencyTotal: { inc: jest.fn() },
    };
    mockUserBlockService = {
      assertRequesterAllowed: jest.fn().mockResolvedValue(undefined),
    };
    mockChannelSongRequestSettingsService = {
      getByChannelId: jest.fn().mockResolvedValue(null),
    };

    service = new SongRequestQueueService(
      mockPrisma as unknown as PrismaService,
      mockEventEmitter,
      mockSongMatcher as unknown as SongMatcherService,
      mockSongPricing as unknown as SongPricingService,
      mockMetrics as unknown as MetricsService,
      mockUserBlockService as unknown as SongRequestUserBlockService,
      mockChannelSongRequestSettingsService,
    );
  });

  const buildRequestData = (opts: {
    donationAmount?: number;
    allowManualBypass?: boolean;
    source?: string;
  }) => ({
    songId: 42,
    rawArtist: '아티스트',
    rawTitle: '제목',
    requesterPlatformId: 'p1',
    requesterNickname: 'nick',
    source: opts.source ?? 'DONATION',
    donationAmount: opts.donationAmount,
    allowManualBypass: opts.allowManualBypass,
  });

  const setPrice = (price: number | null) => {
    if (price === null) {
      mockSongPricing.calculatePrice.mockResolvedValue({
        price: 0,
        source: PriceSource.FREE,
        formattedPrice: null,
      });
    } else {
      mockSongPricing.calculatePrice.mockResolvedValue({
        price,
        source: price === 0 ? PriceSource.FREE : PriceSource.SONG,
        formattedPrice: price === 0 ? null : `${price.toLocaleString()}원`,
      });
    }
  };

  describe('addToQueue - enforceDonationMinimumPrice', () => {
    it('rejects when donation 500 < calculatedPrice 1000 and setting ON', async () => {
      setPrice(1000);
      await expect(
        service.addToQueue(1, buildRequestData({ donationAmount: 500 })),
      ).rejects.toThrow(/최소 후원 금액/);
    });

    it('accepts when donation equals price (1000 == 1000)', async () => {
      setPrice(1000);
      await expect(
        service.addToQueue(1, buildRequestData({ donationAmount: 1000 })),
      ).resolves.toBeDefined();
    });

    it('accepts when donation exceeds price', async () => {
      setPrice(1000);
      await expect(
        service.addToQueue(1, buildRequestData({ donationAmount: 1500 })),
      ).resolves.toBeDefined();
    });

    it('accepts when donationAmount is 0 even with priced song (MANUAL path)', async () => {
      setPrice(1000);
      await expect(
        service.addToQueue(1, buildRequestData({ donationAmount: 0 })),
      ).resolves.toBeDefined();
    });

    it('accepts when donationAmount is undefined even with priced song', async () => {
      setPrice(1000);
      await expect(
        service.addToQueue(1, buildRequestData({ donationAmount: undefined })),
      ).resolves.toBeDefined();
    });

    it('accepts when calculatedPrice is null (unmatched / FREE song)', async () => {
      setPrice(null);
      await expect(
        service.addToQueue(1, buildRequestData({ donationAmount: 500 })),
      ).resolves.toBeDefined();
    });

    it('accepts when calculatedPrice is 0 (free pricing)', async () => {
      setPrice(0);
      await expect(
        service.addToQueue(1, buildRequestData({ donationAmount: 500 })),
      ).resolves.toBeDefined();
    });

    it('accepts underpayment when setting is OFF (bypass)', async () => {
      mockPrisma.liveSession.findUnique.mockResolvedValue(
        buildSessionWithSettings({ enforceDonationMinimumPrice: false }),
      );
      setPrice(1000);
      await expect(
        service.addToQueue(1, buildRequestData({ donationAmount: 500 })),
      ).resolves.toBeDefined();
    });

    it('accepts underpayment when allowManualBypass=true AND source=MANUAL (operator override)', async () => {
      setPrice(1000);
      await expect(
        service.addToQueue(
          1,
          buildRequestData({
            donationAmount: 500,
            allowManualBypass: true,
            source: 'MANUAL',
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('rejects CHAT source donation under price (source-agnostic enforcement per Q1=B)', async () => {
      setPrice(1000);
      await expect(
        service.addToQueue(
          1,
          buildRequestData({ donationAmount: 500, source: 'CHAT' }),
        ),
      ).rejects.toThrow(/최소 후원 금액/);
    });

    it('defaults to ENFORCE when settings has no enforceDonationMinimumPrice field (null-fallback via ?? true)', async () => {
      const session = buildSessionWithSettings();
      delete (session.settings as any).enforceDonationMinimumPrice;
      mockPrisma.liveSession.findUnique.mockResolvedValue(session);
      setPrice(1000);
      await expect(
        service.addToQueue(1, buildRequestData({ donationAmount: 500 })),
      ).rejects.toThrow(/최소 후원 금액/);
    });

    it('regression: duplicate-song error wins over donation-underpayment (existing check order preserved)', async () => {
      mockPrisma.liveSession.findUnique.mockResolvedValue(
        buildSessionWithSettings({ preventDuplicateSongs: true }),
      );
      mockPrisma.songRequest.findFirst.mockResolvedValueOnce({ id: 1 });
      setPrice(1000);
      await expect(
        service.addToQueue(1, buildRequestData({ donationAmount: 500 })),
      ).rejects.toThrow(/이미 신청된 곡/);
    });

    it('uses formattedPrice in error message when available (non-KRW safe)', async () => {
      mockSongPricing.calculatePrice.mockResolvedValue({
        price: 10,
        source: PriceSource.SONG,
        formattedPrice: '10 치즈',
      });
      await expect(
        service.addToQueue(1, buildRequestData({ donationAmount: 5 })),
      ).rejects.toThrow(/10 치즈/);
    });
  });

  describe('enforceDonationMinimumPrice — native-first', () => {
    const buildNativeRequestData = (opts: {
      donationNativeAmount?: number;
      donationCurrency?: string;
      donationAmount?: number;
      allowManualBypass?: boolean;
      source?: string;
    }) => ({
      songId: 42,
      rawArtist: '아티스트',
      rawTitle: '제목',
      requesterPlatformId: 'p1',
      requesterNickname: 'nick',
      source: opts.source ?? 'DONATION',
      donationNativeAmount: opts.donationNativeAmount,
      donationCurrency: opts.donationCurrency,
      donationAmount: opts.donationAmount,
      allowManualBypass: opts.allowManualBypass,
    });

    it('SOOP_BALLOON price=2 + 별풍선 1개 후원 → reject', async () => {
      mockSongPricing.calculatePrice.mockResolvedValue({
        price: 2,
        source: PriceSource.SONG,
        formattedPrice: '2 별풍선',
        currencyKey: 'SOOP_BALLOON',
      });
      await expect(
        service.addToQueue(
          1,
          buildNativeRequestData({
            donationNativeAmount: 1,
            donationCurrency: 'SOOP_BALLOON',
          }),
        ),
      ).rejects.toThrow(/최소 후원 금액/);
    });

    it('SOOP_BALLOON price=2 + 별풍선 2개 후원 → accept', async () => {
      mockSongPricing.calculatePrice.mockResolvedValue({
        price: 2,
        source: PriceSource.SONG,
        formattedPrice: '2 별풍선',
        currencyKey: 'SOOP_BALLOON',
      });
      await expect(
        service.addToQueue(
          1,
          buildNativeRequestData({
            donationNativeAmount: 2,
            donationCurrency: 'SOOP_BALLOON',
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('CHZZK_CHEESE price=5 + 치즈 3개 후원 → reject', async () => {
      mockSongPricing.calculatePrice.mockResolvedValue({
        price: 5,
        source: PriceSource.SONG,
        formattedPrice: '5 치즈',
        currencyKey: 'CHZZK_CHEESE',
      });
      await expect(
        service.addToQueue(
          1,
          buildNativeRequestData({
            donationNativeAmount: 3,
            donationCurrency: 'CHZZK_CHEESE',
          }),
        ),
      ).rejects.toThrow(/최소 후원 금액/);
    });

    it('CHZZK_CHEESE price=5 + 치즈 10개 후원 → accept', async () => {
      mockSongPricing.calculatePrice.mockResolvedValue({
        price: 5,
        source: PriceSource.SONG,
        formattedPrice: '5 치즈',
        currencyKey: 'CHZZK_CHEESE',
      });
      await expect(
        service.addToQueue(
          1,
          buildNativeRequestData({
            donationNativeAmount: 10,
            donationCurrency: 'CHZZK_CHEESE',
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('Cross-currency: CHZZK_CHEESE price=5 + SOOP_BALLOON 1개 후원 → accept (100 KRW >= 5 KRW)', async () => {
      // CHZZK_CHEESE: 1 KRW per unit → price=5 = 5 KRW
      // SOOP_BALLOON: 100 KRW per unit → donation=1 = 100 KRW
      // 100 KRW >= 5 KRW → accept
      mockSongPricing.calculatePrice.mockResolvedValue({
        price: 5,
        source: PriceSource.SONG,
        formattedPrice: '5 치즈',
        currencyKey: 'CHZZK_CHEESE',
      });
      await expect(
        service.addToQueue(
          1,
          buildNativeRequestData({
            donationNativeAmount: 1,
            donationCurrency: 'SOOP_BALLOON',
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('Legacy path: donationAmount(KRW)=1000 + KRW pricing → accept', async () => {
      // priceResult.currencyKey is null/undefined → KRW_LEGACY
      // resolveDonationPair → {1000, KRW_LEGACY}
      // compareAmounts({1000, KRW_LEGACY}, {1000, KRW_LEGACY}) === 0 → accept
      mockSongPricing.calculatePrice.mockResolvedValue({
        price: 1000,
        source: PriceSource.SONG,
        formattedPrice: '1,000원',
        currencyKey: null,
      });
      await expect(
        service.addToQueue(1, buildNativeRequestData({ donationAmount: 1000 })),
      ).resolves.toBeDefined();
    });

    it('Legacy donationAmount=50 + SOOP_BALLOON price=2 (=200원) → reject', async () => {
      // {50, KRW_LEGACY} vs {2, SOOP_BALLOON}: 50 KRW < 200 KRW → reject
      mockSongPricing.calculatePrice.mockResolvedValue({
        price: 2,
        source: PriceSource.SONG,
        formattedPrice: '2 별풍선',
        currencyKey: 'SOOP_BALLOON',
      });
      await expect(
        service.addToQueue(1, buildNativeRequestData({ donationAmount: 50 })),
      ).rejects.toThrow(/최소 후원 금액/);
    });

    it('Unknown currency → BadRequestException "지원하지 않는 후원 재화입니다: FOO"', async () => {
      mockSongPricing.calculatePrice.mockResolvedValue({
        price: 2,
        source: PriceSource.SONG,
        formattedPrice: '2 별풍선',
        currencyKey: 'SOOP_BALLOON',
      });
      await expect(
        service.addToQueue(
          1,
          buildNativeRequestData({
            donationNativeAmount: 1,
            donationCurrency: 'FOO',
          }),
        ),
      ).rejects.toThrow(/지원하지 않는 후원 재화입니다: FOO/);
      expect(
        mockMetrics.melomingChatUnknownCurrencyTotal.inc,
      ).toHaveBeenCalledWith({ source: 'queue' });
    });

    it('allowManualBypass=true + 부족 후원 → accept (bypass 유지)', async () => {
      mockSongPricing.calculatePrice.mockResolvedValue({
        price: 2,
        source: PriceSource.SONG,
        formattedPrice: '2 별풍선',
        currencyKey: 'SOOP_BALLOON',
      });
      await expect(
        service.addToQueue(
          1,
          buildNativeRequestData({
            donationNativeAmount: 1,
            donationCurrency: 'SOOP_BALLOON',
            allowManualBypass: true,
            source: 'MANUAL',
          }),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('DB 저장 - 3개 native-first 필드 + KRW snapshot', () => {
    const buildNativeRequestData = (opts: {
      donationNativeAmount?: number;
      donationCurrency?: string;
      donationAmount?: number;
    }) => ({
      songId: 42,
      rawArtist: '아티스트',
      rawTitle: '제목',
      requesterPlatformId: 'p1',
      requesterNickname: 'nick',
      source: 'DONATION',
      donationNativeAmount: opts.donationNativeAmount,
      donationCurrency: opts.donationCurrency,
      donationAmount: opts.donationAmount,
    });

    beforeEach(() => {
      // 가격 검증 우회: price=0 (FREE)
      mockSongPricing.calculatePrice.mockResolvedValue({
        price: 0,
        source: PriceSource.FREE,
        formattedPrice: null,
        currencyKey: null,
      });
    });

    it('Native 별풍선 50개 → donationAmount=5000, donationNativeAmount=50, donationCurrency=SOOP_BALLOON, donationRateVersion=1', async () => {
      let capturedData: any;
      mockPrisma.songRequest.create.mockImplementation(({ data }: any) => {
        capturedData = data;
        return Promise.resolve({
          id: 999,
          liveSessionId: 1,
          songId: 42,
          donationAmount: 5000,
          calculatedPrice: null,
          priceSource: PriceSource.FREE,
        });
      });
      await service.addToQueue(
        1,
        buildNativeRequestData({
          donationNativeAmount: 50,
          donationCurrency: 'SOOP_BALLOON',
        }),
      );
      expect(capturedData.donationAmount).toBe(5000);
      expect(capturedData.donationNativeAmount).toBe(50);
      expect(capturedData.donationCurrency).toBe('SOOP_BALLOON');
      expect(capturedData.donationRateVersion).toBe(1);
    });

    it('Native 치즈 3000개 → donationAmount=3000, donationNativeAmount=3000, donationCurrency=CHZZK_CHEESE, donationRateVersion=1', async () => {
      let capturedData: any;
      mockPrisma.songRequest.create.mockImplementation(({ data }: any) => {
        capturedData = data;
        return Promise.resolve({
          id: 999,
          liveSessionId: 1,
          songId: 42,
          donationAmount: 3000,
          calculatedPrice: null,
          priceSource: PriceSource.FREE,
        });
      });
      await service.addToQueue(
        1,
        buildNativeRequestData({
          donationNativeAmount: 3000,
          donationCurrency: 'CHZZK_CHEESE',
        }),
      );
      expect(capturedData.donationAmount).toBe(3000);
      expect(capturedData.donationNativeAmount).toBe(3000);
      expect(capturedData.donationCurrency).toBe('CHZZK_CHEESE');
      expect(capturedData.donationRateVersion).toBe(1);
    });

    it('Legacy donationAmount=5000만 → donationAmount=5000, donationCurrency=KRW_LEGACY, native/rateVersion=null', async () => {
      let capturedData: any;
      mockPrisma.songRequest.create.mockImplementation(({ data }: any) => {
        capturedData = data;
        return Promise.resolve({
          id: 999,
          liveSessionId: 1,
          songId: 42,
          donationAmount: 5000,
          calculatedPrice: null,
          priceSource: PriceSource.FREE,
        });
      });
      await service.addToQueue(
        1,
        buildNativeRequestData({ donationAmount: 5000 }),
      );
      expect(capturedData.donationAmount).toBe(5000);
      expect(capturedData.donationNativeAmount).toBeNull();
      expect(capturedData.donationCurrency).toBe('KRW_LEGACY');
      expect(capturedData.donationRateVersion).toBeNull();
    });

    it('Backfill idempotency: KRW-legacy 신규 row의 donationCurrency=KRW_LEGACY → backfill WHERE 절 재처리 없음', async () => {
      // backfill: donationAmount IS NOT NULL AND donationCurrency IS NULL
      // 신규 row는 donationCurrency='KRW_LEGACY'이므로 해당 조건에 매칭되지 않아야 함
      let capturedData: any;
      mockPrisma.songRequest.create.mockImplementation(({ data }: any) => {
        capturedData = data;
        return Promise.resolve({
          id: 999,
          liveSessionId: 1,
          songId: 42,
          donationAmount: 5000,
          calculatedPrice: null,
          priceSource: PriceSource.FREE,
        });
      });
      await service.addToQueue(
        1,
        buildNativeRequestData({ donationAmount: 5000 }),
      );
      // donationCurrency가 null이 아니므로 backfill 대상에서 제외됨
      expect(capturedData.donationCurrency).not.toBeNull();
      expect(capturedData.donationCurrency).toBe('KRW_LEGACY');
    });

    it('후원 없음 → donationAmount=null (spec §4.1), native/currency/rateVersion=null', async () => {
      let capturedData: any;
      mockPrisma.songRequest.create.mockImplementation(({ data }: any) => {
        capturedData = data;
        return Promise.resolve({
          id: 999,
          liveSessionId: 1,
          songId: 42,
          donationAmount: null,
          calculatedPrice: null,
          priceSource: PriceSource.FREE,
        });
      });
      await service.addToQueue(1, buildNativeRequestData({}));
      expect(capturedData.donationAmount).toBeNull();
      expect(capturedData.donationNativeAmount).toBeNull();
      expect(capturedData.donationCurrency).toBeNull();
      expect(capturedData.donationRateVersion).toBeNull();
    });

    it('Metric: Native 별풍선 50개 → songRequestDonationAmountKrw.inc에 5000(KRW) 전달', async () => {
      await service.addToQueue(
        1,
        buildNativeRequestData({
          donationNativeAmount: 50,
          donationCurrency: 'SOOP_BALLOON',
        }),
      );
      expect(mockMetrics.songRequestDonationAmountKrw.inc).toHaveBeenCalledWith(
        { platform: 'CHZZK' },
        5000,
      );
    });
  });

  describe('pickRandomEligibleSong - randomFilter', () => {
    it('limits RANDOM candidate pool by matching artist or category filter', async () => {
      let countWhere: any;
      mockPrisma.category.findMany.mockResolvedValue([
        { id: 11, name: '발라드' },
        { id: 12, name: '댄스' },
      ]);
      mockPrisma.song.count.mockImplementation(({ where }: any) => {
        countWhere = where;
        return Promise.resolve(1);
      });
      mockPrisma.song.findMany
        .mockResolvedValueOnce([{ id: 42 }])
        .mockResolvedValueOnce([
          {
            id: 42,
            title: '밤편지',
            albumArt: null,
            artist: { name: '아이유' },
          },
        ]);

      const picked = await (service as any).pickRandomEligibleSong({
        channelIds: [10],
        liveSessionId: 1,
        blockedCategoryIds: [],
        preventDuplicates: false,
        randomFilter: '발 라 드',
      });

      expect(picked?.winner.id).toBe(42);
      expect(mockPrisma.category.findMany).toHaveBeenCalledWith({
        where: { channelId: { in: [10] } },
        select: { id: true, name: true },
      });
      expect(countWhere.OR).toEqual([
        { artist: { nameSearchable: { contains: '발라드' } } },
        { songCategories: { some: { categoryId: { in: [11] } } } },
      ]);
    });

    it('keeps blocked-category and duplicate filters when a random filter is present', async () => {
      let countWhere: any;
      mockPrisma.category.findMany.mockResolvedValue([]);
      mockPrisma.songRequest.findMany.mockResolvedValue([{ songId: 99 }]);
      mockPrisma.song.count.mockImplementation(({ where }: any) => {
        countWhere = where;
        return Promise.resolve(0);
      });

      const picked = await (service as any).pickRandomEligibleSong({
        channelIds: [10],
        liveSessionId: 1,
        blockedCategoryIds: [7],
        preventDuplicates: true,
        randomFilter: '아이유',
      });

      expect(picked).toBeNull();
      expect(countWhere).toMatchObject({
        channelId: { in: [10] },
        OR: [{ artist: { nameSearchable: { contains: '아이유' } } }],
        NOT: { songCategories: { some: { categoryId: { in: [7] } } } },
        id: { notIn: [99] },
      });
    });
  });

  describe('enforceDonationMinimumPrice + native-first — spec §6.1/§6.3 end-to-end', () => {
    const buildNativeE2ERequestData = (opts: {
      donationNativeAmount?: number;
      donationCurrency?: string;
      donationAmount?: number;
      allowManualBypass?: boolean;
      source?: string;
    }) => ({
      songId: 42,
      rawArtist: '아티스트',
      rawTitle: '제목',
      requesterPlatformId: 'p1',
      requesterNickname: 'nick',
      source: opts.source ?? 'DONATION',
      donationNativeAmount: opts.donationNativeAmount,
      donationCurrency: opts.donationCurrency,
      donationAmount: opts.donationAmount,
      allowManualBypass: opts.allowManualBypass,
    });

    it('Scenario 1: SOOP_BALLOON price=2 + 1개 후원 → reject (원 버그 재현 및 해결 확인)', async () => {
      mockSongPricing.calculatePrice.mockResolvedValue({
        price: 2,
        source: PriceSource.SONG,
        formattedPrice: '2 별풍선',
        currencyKey: 'SOOP_BALLOON',
      });
      await expect(
        service.addToQueue(
          1,
          buildNativeE2ERequestData({
            donationNativeAmount: 1,
            donationCurrency: 'SOOP_BALLOON',
          }),
        ),
      ).rejects.toThrow(/최소 후원 금액.*이상 필요합니다/);
      expect(mockPrisma.songRequest.create).not.toHaveBeenCalled();
    });

    it('Scenario 2: SOOP_BALLOON price=2 + 2개 후원 → accept, priority=0, 4 fields persisted', async () => {
      mockSongPricing.calculatePrice.mockResolvedValue({
        price: 2,
        source: PriceSource.SONG,
        formattedPrice: '2 별풍선',
        currencyKey: 'SOOP_BALLOON',
      });
      let capturedData: any;
      mockPrisma.songRequest.create.mockImplementation(({ data }: any) => {
        capturedData = data;
        return Promise.resolve({
          id: 999,
          liveSessionId: 1,
          songId: 42,
          donationAmount: 200,
          calculatedPrice: 2,
          priceSource: PriceSource.SONG,
        });
      });
      await expect(
        service.addToQueue(
          1,
          buildNativeE2ERequestData({
            donationNativeAmount: 2,
            donationCurrency: 'SOOP_BALLOON',
          }),
        ),
      ).resolves.toBeDefined();
      // priority: 2 × 100 = 200 KRW → floor(200/1000)=0
      expect(capturedData.priority).toBe(0);
      // DB: 4 donation fields
      expect(capturedData.donationAmount).toBe(200);
      expect(capturedData.donationNativeAmount).toBe(2);
      expect(capturedData.donationCurrency).toBe('SOOP_BALLOON');
      expect(capturedData.donationRateVersion).toBe(1);
    });

    it('Scenario 3: Cross-currency CHZZK_CHEESE price=5 + 1 SOOP_BALLOON (100 KRW) → accept, priority=0, 4 fields', async () => {
      // CHZZK_CHEESE price=5 → 5 KRW, SOOP_BALLOON 1개 → 100 KRW → accept
      mockSongPricing.calculatePrice.mockResolvedValue({
        price: 5,
        source: PriceSource.SONG,
        formattedPrice: '5 치즈',
        currencyKey: 'CHZZK_CHEESE',
      });
      let capturedData: any;
      mockPrisma.songRequest.create.mockImplementation(({ data }: any) => {
        capturedData = data;
        return Promise.resolve({
          id: 999,
          liveSessionId: 1,
          songId: 42,
          donationAmount: 100,
          calculatedPrice: 5,
          priceSource: PriceSource.SONG,
        });
      });
      await expect(
        service.addToQueue(
          1,
          buildNativeE2ERequestData({
            donationNativeAmount: 1,
            donationCurrency: 'SOOP_BALLOON',
          }),
        ),
      ).resolves.toBeDefined();
      // priority: 1 × 100 = 100 KRW → floor(100/1000)=0
      expect(capturedData.priority).toBe(0);
      expect(capturedData.donationAmount).toBe(100);
      expect(capturedData.donationNativeAmount).toBe(1);
      expect(capturedData.donationCurrency).toBe('SOOP_BALLOON');
      expect(capturedData.donationRateVersion).toBe(1);
    });

    it('Scenario 4: Legacy KRW 경로 backward compat — donationAmount=1000, song price=500 → accept, priority=1', async () => {
      mockSongPricing.calculatePrice.mockResolvedValue({
        price: 500,
        source: PriceSource.SONG,
        formattedPrice: '500원',
        currencyKey: null,
      });
      let capturedData: any;
      mockPrisma.songRequest.create.mockImplementation(({ data }: any) => {
        capturedData = data;
        return Promise.resolve({
          id: 999,
          liveSessionId: 1,
          songId: 42,
          donationAmount: 1000,
          calculatedPrice: 500,
          priceSource: PriceSource.SONG,
        });
      });
      await expect(
        service.addToQueue(
          1,
          buildNativeE2ERequestData({ donationAmount: 1000 }),
        ),
      ).resolves.toBeDefined();
      // priority: 1000 KRW → floor(1000/1000)=1
      expect(capturedData.priority).toBe(1);
      expect(capturedData.donationAmount).toBe(1000);
      expect(capturedData.donationNativeAmount).toBeNull();
      expect(capturedData.donationCurrency).toBe('KRW_LEGACY');
      expect(capturedData.donationRateVersion).toBeNull();
    });

    it('Scenario 5: Unknown currency FOO_COIN → BadRequestException + metric inc, create 미호출', async () => {
      mockSongPricing.calculatePrice.mockResolvedValue({
        price: 0,
        source: PriceSource.FREE,
        formattedPrice: null,
        currencyKey: null,
      });
      await expect(
        service.addToQueue(
          1,
          buildNativeE2ERequestData({
            donationNativeAmount: 5,
            donationCurrency: 'FOO_COIN',
          }),
        ),
      ).rejects.toThrow(/지원하지 않는 후원 재화입니다: FOO_COIN/);
      expect(
        mockMetrics.melomingChatUnknownCurrencyTotal.inc,
      ).toHaveBeenCalledWith({ source: 'queue' });
      expect(mockPrisma.songRequest.create).not.toHaveBeenCalled();
    });

    it('Scenario 6: allowManualBypass → 부족한 후원도 통과, priority=0, native fields persisted', async () => {
      // SOOP_BALLOON price=10, donation=1 SOOP_BALLOON → 100 KRW < 1000 KRW, but bypassed
      mockSongPricing.calculatePrice.mockResolvedValue({
        price: 10,
        source: PriceSource.SONG,
        formattedPrice: '10 별풍선',
        currencyKey: 'SOOP_BALLOON',
      });
      let capturedData: any;
      mockPrisma.songRequest.create.mockImplementation(({ data }: any) => {
        capturedData = data;
        return Promise.resolve({
          id: 999,
          liveSessionId: 1,
          songId: 42,
          donationAmount: 100,
          calculatedPrice: 10,
          priceSource: PriceSource.SONG,
        });
      });
      await expect(
        service.addToQueue(
          1,
          buildNativeE2ERequestData({
            donationNativeAmount: 1,
            donationCurrency: 'SOOP_BALLOON',
            allowManualBypass: true,
            source: 'MANUAL',
          }),
        ),
      ).resolves.toBeDefined();
      // priority: 1 × 100 = 100 KRW → floor(100/1000)=0
      expect(capturedData.priority).toBe(0);
      expect(capturedData.donationNativeAmount).toBe(1);
      expect(capturedData.donationCurrency).toBe('SOOP_BALLOON');
      expect(capturedData.donationRateVersion).toBe(1);
    });

    it('Scenario 7: 고액 네이티브 후원 SOOP_BALLOON 100개 (10000 KRW) → priority 10 (cap)', async () => {
      mockSongPricing.calculatePrice.mockResolvedValue({
        price: 0,
        source: PriceSource.FREE,
        formattedPrice: null,
        currencyKey: null,
      });
      let capturedData: any;
      mockPrisma.songRequest.create.mockImplementation(({ data }: any) => {
        capturedData = data;
        return Promise.resolve({
          id: 999,
          liveSessionId: 1,
          songId: 42,
          donationAmount: 10000,
          calculatedPrice: null,
          priceSource: PriceSource.FREE,
        });
      });
      await service.addToQueue(
        1,
        buildNativeE2ERequestData({
          donationNativeAmount: 100,
          donationCurrency: 'SOOP_BALLOON',
        }),
      );
      // 100 × 100 = 10000 KRW → Math.min(10, floor(10000/1000)) = Math.min(10,10) = 10
      expect(capturedData.priority).toBe(10);
    });

    it('Scenario 8: 최상위 구간 SOOP_BALLOON 600개 (60000 KRW) → priority 21', async () => {
      mockSongPricing.calculatePrice.mockResolvedValue({
        price: 0,
        source: PriceSource.FREE,
        formattedPrice: null,
        currencyKey: null,
      });
      let capturedData: any;
      mockPrisma.songRequest.create.mockImplementation(({ data }: any) => {
        capturedData = data;
        return Promise.resolve({
          id: 999,
          liveSessionId: 1,
          songId: 42,
          donationAmount: 60000,
          calculatedPrice: null,
          priceSource: PriceSource.FREE,
        });
      });
      await service.addToQueue(
        1,
        buildNativeE2ERequestData({
          donationNativeAmount: 600,
          donationCurrency: 'SOOP_BALLOON',
        }),
      );
      // 600 × 100 = 60000 KRW → else branch: 20 + floor((60000-50000)/10000) = 20+1 = 21
      expect(capturedData.priority).toBe(21);
    });
  });

  describe('calculatePriority — currency-aware input', () => {
    const buildNativeRequestData = (opts: {
      donationNativeAmount?: number;
      donationCurrency?: string;
      donationAmount?: number;
      allowManualBypass?: boolean;
    }) => ({
      songId: 42,
      rawArtist: '아티스트',
      rawTitle: '제목',
      requesterPlatformId: 'p1',
      requesterNickname: 'nick',
      source: 'DONATION',
      donationNativeAmount: opts.donationNativeAmount,
      donationCurrency: opts.donationCurrency,
      donationAmount: opts.donationAmount,
      allowManualBypass: opts.allowManualBypass,
    });

    beforeEach(() => {
      // 가격 검증 우회: price=0 (FREE) 으로 설정
      mockSongPricing.calculatePrice.mockResolvedValue({
        price: 0,
        source: PriceSource.FREE,
        formattedPrice: null,
        currencyKey: null,
      });
    });

    it('별풍선 50개 → priority 5 (50 × 100 = 5000 KRW → floor(5000/1000)=5)', async () => {
      let capturedData: any;
      mockPrisma.songRequest.create.mockImplementation(({ data }: any) => {
        capturedData = data;
        return Promise.resolve({
          id: 999,
          liveSessionId: 1,
          songId: 42,
          donationAmount: 0,
          calculatedPrice: null,
          priceSource: PriceSource.FREE,
        });
      });
      await service.addToQueue(
        1,
        buildNativeRequestData({
          donationNativeAmount: 50,
          donationCurrency: 'SOOP_BALLOON',
        }),
      );
      expect(capturedData.priority).toBe(5);
    });

    it('치즈 10000개 → priority 10 (10000 × 1 = 10000 KRW → floor(10000/1000)=10, capped at 10)', async () => {
      let capturedData: any;
      mockPrisma.songRequest.create.mockImplementation(({ data }: any) => {
        capturedData = data;
        return Promise.resolve({
          id: 999,
          liveSessionId: 1,
          songId: 42,
          donationAmount: 0,
          calculatedPrice: null,
          priceSource: PriceSource.FREE,
        });
      });
      await service.addToQueue(
        1,
        buildNativeRequestData({
          donationNativeAmount: 10000,
          donationCurrency: 'CHZZK_CHEESE',
        }),
      );
      expect(capturedData.priority).toBe(10);
    });

    it('치즈 1000개 → priority 1 (1000 KRW → floor(1000/1000)=1)', async () => {
      let capturedData: any;
      mockPrisma.songRequest.create.mockImplementation(({ data }: any) => {
        capturedData = data;
        return Promise.resolve({
          id: 999,
          liveSessionId: 1,
          songId: 42,
          donationAmount: 0,
          calculatedPrice: null,
          priceSource: PriceSource.FREE,
        });
      });
      await service.addToQueue(
        1,
        buildNativeRequestData({
          donationNativeAmount: 1000,
          donationCurrency: 'CHZZK_CHEESE',
        }),
      );
      expect(capturedData.priority).toBe(1);
    });

    it('Legacy donationAmount=5000 → priority 5 (기존 동작 유지)', async () => {
      let capturedData: any;
      mockPrisma.songRequest.create.mockImplementation(({ data }: any) => {
        capturedData = data;
        return Promise.resolve({
          id: 999,
          liveSessionId: 1,
          songId: 42,
          donationAmount: 5000,
          calculatedPrice: null,
          priceSource: PriceSource.FREE,
        });
      });
      await service.addToQueue(
        1,
        buildNativeRequestData({ donationAmount: 5000 }),
      );
      expect(capturedData.priority).toBe(5);
    });

    it('donationPriorityEnabled=false + 별풍선 5000개 (=500000 KRW) → priority 0', async () => {
      mockPrisma.liveSession.findUnique.mockResolvedValue({
        ...buildSessionWithSettings(),
        settings: {
          ...buildSessionWithSettings().settings,
          donationPriorityEnabled: false,
        },
      });
      let capturedData: any;
      mockPrisma.songRequest.create.mockImplementation(({ data }: any) => {
        capturedData = data;
        return Promise.resolve({
          id: 999,
          liveSessionId: 1,
          songId: 42,
          donationAmount: 0,
          calculatedPrice: null,
          priceSource: PriceSource.FREE,
        });
      });
      await service.addToQueue(
        1,
        buildNativeRequestData({
          donationNativeAmount: 5000,
          donationCurrency: 'SOOP_BALLOON',
        }),
      );
      expect(capturedData.priority).toBe(0);
    });
  });

  describe('addToQueue — operator bypass matrix', () => {
    const buildManualBypass = (
      overrides: Partial<{
        source: string;
        donationAmount: number;
        requesterPlatformId: string;
      }> = {},
    ) => ({
      songId: 42,
      rawArtist: '아티스트',
      rawTitle: '제목',
      requesterPlatformId: overrides.requesterPlatformId ?? 'op',
      requesterNickname: '운영자',
      source: overrides.source ?? 'MANUAL',
      donationAmount: overrides.donationAmount,
      allowManualBypass: true,
    });

    const overrideSettings = (settings: Record<string, unknown>) => {
      const base = buildSessionWithSettings();
      mockPrisma.liveSession.findUnique.mockResolvedValue({
        ...base,
        settings: { ...base.settings, ...settings },
      });
    };

    it('requestEnabled=false → bypass 무시하고 차단 (정책: 신청곡 OFF는 운영자도 못 넣음)', async () => {
      overrideSettings({ requestEnabled: false });
      await expect(service.addToQueue(1, buildManualBypass())).rejects.toThrow(
        /비활성화/,
      );
    });

    it('paused=true → bypass=true면 통과', async () => {
      overrideSettings({ paused: true });
      await expect(
        service.addToQueue(1, buildManualBypass()),
      ).resolves.toBeDefined();
    });

    it('paused=true + bypass=false → 차단', async () => {
      overrideSettings({ paused: true });
      await expect(
        service.addToQueue(1, {
          ...buildManualBypass(),
          allowManualBypass: false,
        }),
      ).rejects.toThrow(/일시정지/);
    });

    it('maxQueueSize 가득 + bypass=true → 통과 (운영자 우회)', async () => {
      overrideSettings({ maxQueueSize: 1 });
      mockPrisma.songRequest.count.mockResolvedValueOnce(5);
      await expect(
        service.addToQueue(1, buildManualBypass()),
      ).resolves.toBeDefined();
    });

    it('maxQueueSize 가득 + bypass=false → 차단', async () => {
      overrideSettings({ maxQueueSize: 1 });
      mockPrisma.songRequest.count.mockResolvedValueOnce(5);
      await expect(
        service.addToQueue(1, {
          ...buildManualBypass(),
          allowManualBypass: false,
          source: 'CHAT',
        }),
      ).rejects.toThrow(/대기열이 가득/);
    });

    it('requestMode=CHAT_ONLY + MANUAL + bypass=true → 통과', async () => {
      overrideSettings({ requestMode: 'CHAT_ONLY' });
      await expect(
        service.addToQueue(1, buildManualBypass()),
      ).resolves.toBeDefined();
    });

    it('donationOnlyEnabled=true + MANUAL + bypass=true → 통과', async () => {
      overrideSettings({ donationOnlyEnabled: true });
      await expect(
        service.addToQueue(1, buildManualBypass()),
      ).resolves.toBeDefined();
    });

    it('preventDuplicateSongs + 중복 + bypass=true → 통과', async () => {
      overrideSettings({ preventDuplicateSongs: true });
      mockPrisma.songRequest.findFirst.mockResolvedValueOnce({ id: 1 });
      await expect(
        service.addToQueue(1, buildManualBypass()),
      ).resolves.toBeDefined();
    });

    it('maxRequestsPerUser=1 + 동일 신청자 1건 + bypass=true → 통과', async () => {
      overrideSettings({ maxRequestsPerUser: 1 });
      // 첫 count = 큐 사이즈 (안전한 0), 두번째 count = 사용자별
      mockPrisma.songRequest.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(5);
      await expect(
        service.addToQueue(1, buildManualBypass()),
      ).resolves.toBeDefined();
    });
  });

  describe('addToQueue — anonymous request matrix', () => {
    const overrideSettings = (settings: Record<string, unknown>) => {
      const base = buildSessionWithSettings();
      mockPrisma.liveSession.findUnique.mockResolvedValue({
        ...base,
        settings: { ...base.settings, ...settings },
      });
    };

    const buildAnonymousRequest = (
      overrides: Partial<{ isAnonymous: boolean; requestUserId: number }> = {},
    ) => ({
      songId: 42,
      rawArtist: '아티스트',
      rawTitle: '제목',
      requesterPlatformId: 'anon_abcdef',
      requesterNickname: '익명 (웹신청) 테스터',
      source: 'MANUAL',
      isAnonymous: overrides.isAnonymous ?? true,
      requestUserId: overrides.requestUserId,
    });

    it('EVERYONE + allowAnonymous=true + isAnonymous=true → 통과 + is_anonymous DB 저장', async () => {
      overrideSettings({ requestMode: 'EVERYONE', allowAnonymous: true });
      let capturedData: any;
      mockPrisma.songRequest.create.mockImplementation(({ data }: any) => {
        capturedData = data;
        return Promise.resolve({
          id: 1,
          liveSessionId: 1,
          songId: 42,
          donationAmount: 0,
          calculatedPrice: null,
          priceSource: PriceSource.FREE,
        });
      });
      await expect(
        service.addToQueue(1, buildAnonymousRequest()),
      ).resolves.toBeDefined();
      expect(capturedData.isAnonymous).toBe(true);
      expect(capturedData.requesterPlatformId).toBe('anon_abcdef');
    });

    it('EVERYONE + allowAnonymous=false + isAnonymous=true → "익명 신청을 허용하지 않습니다"', async () => {
      overrideSettings({ requestMode: 'EVERYONE', allowAnonymous: false });
      await expect(
        service.addToQueue(1, buildAnonymousRequest()),
      ).rejects.toThrow(/익명 신청을 허용하지 않습니다/);
    });

    it('VERIFIED_ONLY + isAnonymous=true → "본인인증 회원만 신청 가능합니다"', async () => {
      overrideSettings({ requestMode: 'VERIFIED_ONLY', allowAnonymous: true });
      await expect(
        service.addToQueue(1, buildAnonymousRequest()),
      ).rejects.toThrow(/본인인증 회원만 신청 가능합니다/);
    });

    it('CHAT_ONLY + isAnonymous=true → "채팅에서만 신청 가능합니다"', async () => {
      overrideSettings({ requestMode: 'CHAT_ONLY', allowAnonymous: true });
      await expect(
        service.addToQueue(1, buildAnonymousRequest()),
      ).rejects.toThrow(/채팅에서만 신청 가능합니다/);
    });

    it('로그인 유저 (requestUserId=5) + isAnonymous=false → 통과 + is_anonymous=false 저장', async () => {
      overrideSettings({ requestMode: 'EVERYONE', allowAnonymous: false });
      let capturedData: any;
      mockPrisma.songRequest.create.mockImplementation(({ data }: any) => {
        capturedData = data;
        return Promise.resolve({
          id: 2,
          liveSessionId: 1,
          songId: 42,
          donationAmount: 0,
          calculatedPrice: null,
          priceSource: PriceSource.FREE,
        });
      });
      await expect(
        service.addToQueue(
          1,
          buildAnonymousRequest({ isAnonymous: false, requestUserId: 5 }),
        ),
      ).resolves.toBeDefined();
      expect(capturedData.isAnonymous).toBe(false);
    });
  });

  describe('addToQueue — requester block guard', () => {
    it('checks channel/global requester blocks before creating request', async () => {
      await expect(
        service.addToQueue(1, buildRequestData({ donationAmount: 1000 })),
      ).resolves.toBeDefined();

      expect(mockUserBlockService.assertRequesterAllowed).toHaveBeenCalledWith({
        channelId: 10,
        feature: ChannelUserBlockFeature.SONG_REQUEST,
        platform: 'CHZZK',
        requesterPlatformId: 'p1',
        requestUserId: null,
      });
    });

    it('rejects blocked requester and does not create request', async () => {
      mockUserBlockService.assertRequesterAllowed.mockRejectedValueOnce(
        new BadRequestException('차단된 신청자입니다.'),
      );

      await expect(
        service.addToQueue(1, buildRequestData({ donationAmount: 1000 })),
      ).rejects.toThrow(/차단된 신청자/);
      expect(mockPrisma.songRequest.create).not.toHaveBeenCalled();
    });

    it('resolves verified platform request to meloming user before block check', async () => {
      mockPrisma.userPlatformVerification.findFirst.mockResolvedValueOnce({
        userId: 77,
      });

      await service.addToQueue(1, buildRequestData({ donationAmount: 1000 }));

      expect(
        mockPrisma.userPlatformVerification.findFirst,
      ).toHaveBeenCalledWith({
        where: {
          platform: 'CHZZK',
          platformUserId: 'p1',
          isVerified: true,
        },
        select: { userId: true },
      });
      expect(mockUserBlockService.assertRequesterAllowed).toHaveBeenCalledWith({
        channelId: 10,
        feature: ChannelUserBlockFeature.SONG_REQUEST,
        platform: 'CHZZK',
        requesterPlatformId: 'p1',
        requestUserId: 77,
      });
    });

    it('does not run block guard for operator manual bypass', async () => {
      await expect(
        service.addToQueue(
          1,
          buildRequestData({
            source: 'MANUAL',
            allowManualBypass: true,
          }),
        ),
      ).resolves.toBeDefined();

      expect(
        mockUserBlockService.assertRequesterAllowed,
      ).not.toHaveBeenCalled();
    });
  });
});
