import { Test, TestingModule } from '@nestjs/testing';
import { SongAutocompleteService } from './song-autocomplete.service';
import { PrismaService } from '../prisma/prisma.service';
import { DistributedLockService } from '../common/distributed-lock/distributed-lock.service';
import { CacheKeyTrackingService } from '../redis/cache-key-tracking.service';
import { MetricsService } from '../metrics';
import { songAutocompleteCacheKeys } from './cache/song-autocomplete.cache-keys';

const makePopularItem = (overrides: Partial<any> = {}) => ({
  id: overrides.id ?? 1,
  title: overrides.title ?? 'Hello',
  artistId: overrides.artistId ?? 10,
  artistName: overrides.artistName ?? 'Artist',
  requestCount: overrides.requestCount ?? 0,
  likeCount: overrides.likeCount ?? 0,
  normalizedTitle:
    overrides.normalizedTitle ??
    (overrides.title ?? 'Hello').toLowerCase().replace(/\s+/g, ''),
});

describe('SongAutocompleteService', () => {
  let service: SongAutocompleteService;
  let prismaService: jest.Mocked<PrismaService>;
  let cacheTracker: jest.Mocked<any>;
  let lockService: jest.Mocked<DistributedLockService>;

  const mockPrismaService = {
    $queryRaw: jest.fn(),
    song: {
      groupBy: jest.fn(),
    },
  };

  const mockCacheTracker = {
    get: jest.fn(),
    trackAndSet: jest.fn(),
    clearChannel: jest.fn(),
    clearGlobal: jest.fn(),
    clearChannelsBatch: jest.fn(),
  };

  const mockLockService = {
    acquireLock: jest.fn(),
    releaseLock: jest.fn(),
  };

  const mockMetricsService = {
    startJobTimer: jest.fn(() => () => undefined),
    recordJobRun: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SongAutocompleteService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: CacheKeyTrackingService, useValue: mockCacheTracker },
        { provide: DistributedLockService, useValue: mockLockService },
        { provide: MetricsService, useValue: mockMetricsService },
      ],
    }).compile();

    service = module.get<SongAutocompleteService>(SongAutocompleteService);
    prismaService = module.get(PrismaService);
    cacheTracker = module.get(CacheKeyTrackingService);
    lockService = module.get(DistributedLockService);

    jest.clearAllMocks();
  });

  describe('autocompleteTitles', () => {
    const channelId = 11;

    it('빈 쿼리면 인기곡 캐시에서 반환', async () => {
      const popular = [
        makePopularItem({ id: 1, title: 'Hello', artistName: 'A' }),
        makePopularItem({ id: 2, title: 'World', artistName: 'B' }),
      ];
      cacheTracker.get.mockImplementation(async (key: string) => {
        if (key === songAutocompleteCacheKeys.popular(channelId)) return popular;
        return null;
      });

      const result = await service.autocompleteTitles(channelId, '', 5);

      expect(result.suggestions).toEqual([
        { id: 1, title: 'Hello', artistId: 10, artistName: 'A' },
        { id: 2, title: 'World', artistId: 10, artistName: 'B' },
      ]);
      expect(prismaService.$queryRaw).not.toHaveBeenCalled();
    });

    it('global scope는 글로벌 인기곡 캐시에서 반환', async () => {
      const popular = [
        makePopularItem({ id: 10, title: 'Global Song', artistName: 'Z' }),
      ];
      cacheTracker.get.mockImplementation(async (key: string) => {
        if (key === songAutocompleteCacheKeys.popular()) return popular;
        return null;
      });

      const result = await service.autocompleteTitles(undefined, '', 5);

      expect(result.suggestions).toEqual([
        { id: 10, title: 'Global Song', artistId: 10, artistName: 'Z' },
      ]);
      expect(prismaService.$queryRaw).not.toHaveBeenCalled();
    });

    it('쿼리 캐시 히트면 그대로 반환', async () => {
      const cached = [
        { id: 99, title: 'Cached Song', artistId: 7, artistName: 'Cache' },
      ];
      cacheTracker.get.mockImplementation(async (key: string) => {
        if (key.startsWith(songAutocompleteCacheKeys.query(channelId, '')))
          return cached;
        return null;
      });

      const result = await service.autocompleteTitles(channelId, 'ca', 10);

      expect(result.suggestions).toEqual(cached);
      expect(prismaService.$queryRaw).not.toHaveBeenCalled();
    });

    it('인기곡에서 매칭된 순서대로 반환', async () => {
      const popular = [
        makePopularItem({
          id: 1,
          title: 'Hello',
          artistName: 'A',
          requestCount: 5,
          normalizedTitle: 'hello',
        }),
        makePopularItem({
          id: 2,
          title: 'Hello World',
          artistName: 'B',
          requestCount: 1,
          normalizedTitle: 'helloworld',
        }),
        makePopularItem({
          id: 3,
          title: 'Say Hello',
          artistName: 'C',
          requestCount: 20,
          normalizedTitle: 'sayhello',
        }),
      ];
      cacheTracker.get.mockImplementation(async (key: string) => {
        if (key === songAutocompleteCacheKeys.popular(channelId)) return popular;
        return null;
      });

      const result = await service.autocompleteTitles(channelId, 'hello', 3);

      expect(result.suggestions.map((s) => s.id)).toEqual([1, 2, 3]);
    });

    it('같은 제목은 한 번만 반환', async () => {
      const popular = [
        makePopularItem({
          id: 1,
          title: 'Hello',
          artistName: 'A',
          requestCount: 5,
          normalizedTitle: 'hello',
        }),
        makePopularItem({
          id: 2,
          title: 'Hello',
          artistName: 'B',
          requestCount: 2,
          normalizedTitle: 'hello',
        }),
        makePopularItem({
          id: 3,
          title: 'World',
          artistName: 'C',
          requestCount: 1,
          normalizedTitle: 'world',
        }),
      ];
      cacheTracker.get.mockImplementation(async (key: string) => {
        if (key === songAutocompleteCacheKeys.popular(channelId)) return popular;
        return null;
      });

      const result = await service.autocompleteTitles(channelId, '', 5);

      expect(result.suggestions.map((s) => s.title)).toEqual([
        'Hello',
        'World',
      ]);
    });

    it('인기곡 결과가 부족하면 DB 검색 결과를 병합', async () => {
      const popular = [
        makePopularItem({
          id: 1,
          title: 'Hello',
          artistName: 'A',
          requestCount: 1,
          normalizedTitle: 'hello',
        }),
      ];
      cacheTracker.get.mockImplementation(async (key: string) => {
        if (key === songAutocompleteCacheKeys.popular(channelId)) return popular;
        return null;
      });
      prismaService.$queryRaw.mockResolvedValueOnce([
        {
          id: 2,
          title: 'Hello Again',
          artistId: 20,
          artistName: 'B',
          requestCount: 0,
          likeCount: 0,
        },
      ]);

      const result = await service.autocompleteTitles(channelId, 'he', 2);

      expect(result.suggestions.map((s) => s.id)).toEqual([1, 2]);
      expect(prismaService.$queryRaw).toHaveBeenCalledTimes(1);
      expect(cacheTracker.trackAndSet).toHaveBeenCalled();
    });
  });

  describe('suggestArtists', () => {
    const channelId = 22;

    it('정확 일치 제목으로 아티스트 추천 반환', async () => {
      cacheTracker.get.mockResolvedValueOnce(null);
      prismaService.$queryRaw.mockResolvedValueOnce([
        { artistId: 1, artistName: 'Artist A', matchCount: 3 },
        { artistId: 2, artistName: 'Artist B', matchCount: 1 },
      ]);

      const result = await service.suggestArtists(channelId, 'Hello', 5);

      expect(result.suggestions).toEqual([
        {
          artistId: 1,
          artistName: 'Artist A',
          isExisting: true,
          matchCount: 3,
        },
        {
          artistId: 2,
          artistName: 'Artist B',
          isExisting: true,
          matchCount: 1,
        },
      ]);
      expect(result.canCreateNew).toBe(false);
      expect(cacheTracker.trackAndSet).toHaveBeenCalled();
    });

    it('정확 일치가 없으면 LIKE 검색으로 추천', async () => {
      cacheTracker.get.mockResolvedValueOnce(null);
      prismaService.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { artistId: 5, artistName: 'Artist C', matchCount: 2 },
        ]);

      const result = await service.suggestArtists(channelId, 'Hello', 5);

      expect(result.suggestions).toEqual([
        {
          artistId: 5,
          artistName: 'Artist C',
          isExisting: true,
          matchCount: 2,
        },
      ]);
      expect(result.canCreateNew).toBe(false);
    });

    it('추천이 없으면 canCreateNew=true', async () => {
      cacheTracker.get.mockResolvedValueOnce(null);
      prismaService.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const result = await service.suggestArtists(channelId, 'Hi', 5);

      expect(result.suggestions).toEqual([]);
      expect(result.canCreateNew).toBe(true);
    });
  });

  describe('warmPopularCache', () => {
    it('채널 목록이 있으면 인기곡 캐시를 워밍', async () => {
      lockService.acquireLock.mockResolvedValueOnce(true);
      lockService.releaseLock.mockResolvedValueOnce(undefined);
      prismaService.song.groupBy.mockResolvedValueOnce([
        { channelId: 1 },
        { channelId: 2 },
      ] as any);
      prismaService.$queryRaw.mockResolvedValue([
        {
          id: 1,
          title: 'Hello',
          artistId: 1,
          artistName: 'A',
          requestCount: 0,
          likeCount: 0,
        },
      ]);

      await service.warmPopularCache();

      expect(cacheTracker.trackAndSet).toHaveBeenCalledWith(
        songAutocompleteCacheKeys.popular(1),
        expect.any(Array),
        expect.any(Number),
      );
      expect(cacheTracker.trackAndSet).toHaveBeenCalledWith(
        songAutocompleteCacheKeys.popular(2),
        expect.any(Array),
        expect.any(Number),
      );
    });
  });
});
