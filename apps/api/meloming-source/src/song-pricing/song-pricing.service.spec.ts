import { Test, TestingModule } from '@nestjs/testing';
import { PriceSource, StreamPlatform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SongPricingService } from './song-pricing.service';
import {
  CURRENCY_CONFIG_META_KEY,
  DEFAULT_PRICES_META_KEY,
  DIFFICULTY_BY_CURRENCY_META_KEY,
} from './utils/currency-unit.util';

describe('SongPricingService', () => {
  let service: SongPricingService;
  let prismaService: {
    channelPricingSettings: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
    song: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    category: {
      update: jest.Mock;
    };
    channel: {
      findUnique: jest.Mock;
    };
  };

  const mockPrismaService = {
    channelPricingSettings: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    song: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    category: {
      update: jest.fn(),
    },
    channel: {
      findUnique: jest.fn(),
    },
  };

  const channelId = 1;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SongPricingService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<SongPricingService>(SongPricingService);
    prismaService = module.get(PrismaService);

    jest.clearAllMocks();

    prismaService.channel.findUnique.mockResolvedValue({
      id: channelId,
      verification: { platform: StreamPlatform.SOOP },
    });
  });

  describe('calculatePrice', () => {
    it('returns FREE when pricing is disabled', async () => {
      prismaService.channelPricingSettings.findUnique.mockResolvedValue({
        channelId,
        pricingEnabled: false,
        defaultPrice: 100,
        difficultyPrices: null,
      });

      const result = await service.calculatePrice(100, channelId);

      expect(result).toEqual({
        price: null,
        source: PriceSource.FREE,
        currencyKey: 'SOOP_BALLOON',
        currencyUnit: '별풍선',
        formattedPrice: '',
      });
      expect(prismaService.song.findUnique).not.toHaveBeenCalled();
    });

    it('uses song currency price first', async () => {
      prismaService.channelPricingSettings.findUnique.mockResolvedValue({
        channelId,
        pricingEnabled: true,
        defaultPrice: 100,
        difficultyPrices: {
          [CURRENCY_CONFIG_META_KEY]: [
            { key: 'SOOP_BALLOON', unit: '별풍선' },
            { key: 'CHZZK_CHEESE', unit: '치즈' },
          ],
          [DEFAULT_PRICES_META_KEY]: { SOOP_BALLOON: 300 },
          [DIFFICULTY_BY_CURRENCY_META_KEY]: {
            SOOP_BALLOON: { '3': 200 },
          },
        },
      });

      prismaService.song.findUnique.mockResolvedValue({
        id: 100,
        price: null,
        currencyPrices: { SOOP_BALLOON: 500 },
        difficulty: 3,
        songCategories: [{ category: { id: 1, price: 700, currencyPrices: null } }],
      });

      const result = await service.calculatePrice(100, channelId);

      expect(result.price).toBe(500);
      expect(result.source).toBe(PriceSource.SONG);
      expect(result.currencyKey).toBe('SOOP_BALLOON');
      expect(result.currencyUnit).toBe('별풍선');
      expect(result.formattedPrice).toBe('500별풍선');
    });

    it('uses higher price between difficulty and category by currency', async () => {
      prismaService.channelPricingSettings.findUnique.mockResolvedValue({
        channelId,
        pricingEnabled: true,
        defaultPrice: null,
        difficultyPrices: {
          [CURRENCY_CONFIG_META_KEY]: [{ key: 'SOOP_BALLOON', unit: '별풍선' }],
          [DIFFICULTY_BY_CURRENCY_META_KEY]: {
            SOOP_BALLOON: { '3': 200 },
          },
        },
      });

      prismaService.song.findUnique.mockResolvedValue({
        id: 100,
        price: null,
        currencyPrices: null,
        difficulty: 3,
        songCategories: [
          {
            category: {
              id: 1,
              price: null,
              currencyPrices: { SOOP_BALLOON: 250 },
            },
          },
        ],
      });

      const result = await service.calculatePrice(100, channelId);

      expect(result.price).toBe(250);
      expect(result.source).toBe(PriceSource.CATEGORY);
      expect(result.formattedPrice).toBe('250별풍선');
    });

    it('falls back to defaultPrices when no song/category/difficulty price exists', async () => {
      prismaService.channelPricingSettings.findUnique.mockResolvedValue({
        channelId,
        pricingEnabled: true,
        defaultPrice: null,
        difficultyPrices: {
          [CURRENCY_CONFIG_META_KEY]: [{ key: 'SOOP_BALLOON', unit: '별풍선' }],
          [DEFAULT_PRICES_META_KEY]: { SOOP_BALLOON: 150 },
        },
      });

      prismaService.song.findUnique.mockResolvedValue({
        id: 100,
        price: null,
        currencyPrices: null,
        difficulty: null,
        songCategories: [],
      });

      const result = await service.calculatePrice(100, channelId);

      expect(result.price).toBe(150);
      expect(result.source).toBe(PriceSource.DEFAULT);
      expect(result.formattedPrice).toBe('150별풍선');
    });
  });

  describe('calculatePricesForSongs', () => {
    it('returns map for existing songs and FREE for missing ids', async () => {
      prismaService.channelPricingSettings.findUnique.mockResolvedValue({
        channelId,
        pricingEnabled: true,
        defaultPrice: null,
        difficultyPrices: {
          [CURRENCY_CONFIG_META_KEY]: [{ key: 'SOOP_BALLOON', unit: '별풍선' }],
          [DEFAULT_PRICES_META_KEY]: { SOOP_BALLOON: 120 },
        },
      });

      prismaService.song.findMany.mockResolvedValue([
        {
          id: 1,
          price: null,
          currencyPrices: null,
          difficulty: null,
          songCategories: [],
        },
      ]);

      const result = await service.calculatePricesForSongs([1, 2], channelId);

      expect(result.size).toBe(2);
      expect(result.get(1)?.price).toBe(120);
      expect(result.get(1)?.source).toBe(PriceSource.DEFAULT);
      expect(result.get(2)?.price).toBeNull();
      expect(result.get(2)?.source).toBe(PriceSource.FREE);
    });
  });

  describe('updatePricingSettings', () => {
    it('serializes multi-currency pricing payload into difficultyPrices JSON', async () => {
      prismaService.channelPricingSettings.findUnique.mockResolvedValue(null);
      prismaService.channelPricingSettings.upsert.mockResolvedValue({
        channelId,
        pricingEnabled: true,
        defaultPrice: 300,
        difficultyPrices: {},
      });

      await service.updatePricingSettings(channelId, {
        pricingEnabled: true,
        defaultPrices: { SOOP_BALLOON: 300 },
        difficultyPricesByCurrency: {
          SOOP_BALLOON: { '2': 120 },
        },
        currencyConfigs: [{ key: 'SOOP_BALLOON', unit: '별풍선' }],
      });

      expect(prismaService.channelPricingSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { channelId },
          create: expect.objectContaining({
            channelId,
            pricingEnabled: true,
            defaultPrice: 300,
            difficultyPrices: {
              [CURRENCY_CONFIG_META_KEY]: [
                { key: 'SOOP_BALLOON', unit: '별풍선' },
              ],
              [DEFAULT_PRICES_META_KEY]: { SOOP_BALLOON: 300 },
              [DIFFICULTY_BY_CURRENCY_META_KEY]: {
                SOOP_BALLOON: { '2': 120 },
              },
            },
          }),
          update: expect.objectContaining({
            difficultyPrices: {
              [CURRENCY_CONFIG_META_KEY]: [
                { key: 'SOOP_BALLOON', unit: '별풍선' },
              ],
              [DEFAULT_PRICES_META_KEY]: { SOOP_BALLOON: 300 },
              [DIFFICULTY_BY_CURRENCY_META_KEY]: {
                SOOP_BALLOON: { '2': 120 },
              },
            },
          }),
        }),
      );
    });
  });

  describe('updateSongPrice/updateCategoryPrice', () => {
    it('updateSongPrice updates currencyPrices without forcing price', async () => {
      prismaService.song.update.mockResolvedValue({
        id: 1,
        price: null,
        currencyPrices: { SOOP_BALLOON: 500 },
      });

      await service.updateSongPrice(1, undefined, { SOOP_BALLOON: 500 });

      const call = prismaService.song.update.mock.calls[0]?.[0];
      expect(call.where).toEqual({ id: 1 });
      expect(call.data.currencyPrices).toEqual({ SOOP_BALLOON: 500 });
      expect(call.data.price).toBeUndefined();
    });

    it('updateCategoryPrice supports both legacy price and currencyPrices', async () => {
      prismaService.category.update.mockResolvedValue({
        id: 2,
        price: null,
        currencyPrices: { SOOP_BALLOON: null },
      });

      await service.updateCategoryPrice(2, null, { SOOP_BALLOON: null });

      expect(prismaService.category.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: { price: null, currencyPrices: { SOOP_BALLOON: null } },
        select: { id: true, price: true, currencyPrices: true },
      });
    });
  });
});
