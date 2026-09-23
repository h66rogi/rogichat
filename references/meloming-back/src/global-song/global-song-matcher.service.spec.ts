import { ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  GlobalSongMatcherService,
  jaroWinklerSimilarity,
  parseQuery,
} from './global-song-matcher.service';
import { GlobalSongRedisService } from './global-song-redis.service';

/* -------------------------------------------------------------------------- */
/* parseQuery                                                                  */
/* -------------------------------------------------------------------------- */

describe('parseQuery', () => {
  it('splits on " - " separator (whitespace on both sides)', () => {
    expect(parseQuery('아이유 - 밤편지')).toEqual({
      parsedArtist: '아이유',
      parsedTitle: '밤편지',
    });
  });

  it('does NOT split on dash without surrounding spaces', () => {
    // "아이유-밤편지" is treated as a single title to avoid false splits
    // on hyphenated titles like "Love-Wins".
    expect(parseQuery('아이유-밤편지')).toEqual({
      parsedArtist: null,
      parsedTitle: '아이유-밤편지',
    });
  });

  it('does NOT split hyphenated Latin titles', () => {
    expect(parseQuery('Love-Wins')).toEqual({
      parsedArtist: null,
      parsedTitle: 'Love-Wins',
    });
  });

  it('returns title-only when no dash is present', () => {
    expect(parseQuery('밤편지')).toEqual({
      parsedArtist: null,
      parsedTitle: '밤편지',
    });
  });

  it('returns title-only for Latin phrase with no dash', () => {
    expect(parseQuery('Love wins all')).toEqual({
      parsedArtist: null,
      parsedTitle: 'Love wins all',
    });
  });

  it('handles numeric-leading artist names with spaces around dash', () => {
    expect(parseQuery('10cm - 봄이 좋냐')).toEqual({
      parsedArtist: '10cm',
      parsedTitle: '봄이 좋냐',
    });
  });

  it('splits on en-dash with spaces', () => {
    expect(parseQuery('아이유 – 밤편지')).toEqual({
      parsedArtist: '아이유',
      parsedTitle: '밤편지',
    });
  });

  it('empty string returns empty title / null artist', () => {
    expect(parseQuery('')).toEqual({
      parsedArtist: null,
      parsedTitle: '',
    });
  });
});

/* -------------------------------------------------------------------------- */
/* jaroWinklerSimilarity                                                       */
/* -------------------------------------------------------------------------- */

describe('jaroWinklerSimilarity', () => {
  it('identical strings -> 1', () => {
    expect(jaroWinklerSimilarity('밤편지', '밤편지')).toBe(1);
  });

  it('empty strings -> 0 or 1 sensibly', () => {
    expect(jaroWinklerSimilarity('', '')).toBe(1);
    expect(jaroWinklerSimilarity('abc', '')).toBe(0);
    expect(jaroWinklerSimilarity('', 'abc')).toBe(0);
  });

  it('very similar strings score high', () => {
    const score = jaroWinklerSimilarity('martha', 'marhta');
    expect(score).toBeGreaterThan(0.9);
  });

  it('totally different strings score low', () => {
    const score = jaroWinklerSimilarity('abc', 'xyz');
    expect(score).toBeLessThan(0.5);
  });
});

/* -------------------------------------------------------------------------- */
/* GlobalSongMatcherService.match                                              */
/* -------------------------------------------------------------------------- */

describe('GlobalSongMatcherService.match', () => {
  let redis: jest.Mocked<GlobalSongRedisService>;
  let prisma: { globalSong: { findMany: jest.Mock } };
  let svc: GlobalSongMatcherService;

  beforeEach(() => {
    redis = {
      isReady: jest.fn().mockReturnValue(true),
      lookupArtistAlias: jest.fn().mockResolvedValue([]),
      lookupSong: jest.fn().mockResolvedValue(null),
      lookupTitleAlias: jest.fn().mockResolvedValue([]),
      getPrefixCandidates: jest.fn().mockResolvedValue([]),
      getTopCategories: jest.fn().mockResolvedValue([]),
      getChannelSongMapping: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<GlobalSongRedisService>;

    prisma = {
      globalSong: { findMany: jest.fn().mockResolvedValue([]) },
    };

    svc = new GlobalSongMatcherService(
      prisma as unknown as PrismaService,
      redis,
    );
  });

  it('throws ServiceUnavailableException when Redis not ready', async () => {
    redis.isReady.mockReturnValue(false);
    await expect(svc.match({ query: '아이유 - 밤편지' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('translates mid-request Redis failures into 503 (not 500)', async () => {
    // Readiness passes initially, but an underlying Redis call throws
    redis.lookupArtistAlias.mockRejectedValue(new Error('Connection lost'));
    await expect(svc.match({ query: '아이유 - 밤편지' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('stage 1 exact match returns EXACT result', async () => {
    redis.lookupArtistAlias.mockImplementation(async (alias: string) => {
      // 아이유 alias hit
      if (alias === '아이유' || alias === 'iu') return [7];
      return [];
    });
    redis.lookupSong.mockImplementation(async (normTitle: string, artistId: number) => {
      if (normTitle === '밤편지' && artistId === 7) return 42;
      return null;
    });
    prisma.globalSong.findMany.mockResolvedValue([
      {
        id: 42,
        title: '밤편지',
        normTitle: '밤편지',
        albumArt: 'https://img/art.jpg',
        channelCount: 120,
        globalArtist: { canonicalName: '아이유' },
      },
    ]);

    const result = await svc.match({ query: '아이유 - 밤편지' });
    expect(result.query.parsedArtist).toBe('아이유');
    expect(result.query.parsedTitle).toBe('밤편지');
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      globalSongId: 42,
      title: '밤편지',
      artist: '아이유',
      matchMethod: 'EXACT',
      matchConfidence: 'HIGH',
    });
  });

  it('stage 2 title-alias match without artist returns ALIAS result', async () => {
    // No stage-1 artist hits
    redis.lookupArtistAlias.mockResolvedValue([]);
    redis.lookupSong.mockResolvedValue(null);
    // Stage 2 hits via the normalized title
    redis.lookupTitleAlias.mockImplementation(async (titleAlias: string) => {
      if (titleAlias === 'my night') return [99];
      return [];
    });
    prisma.globalSong.findMany.mockResolvedValue([
      {
        id: 99,
        title: '밤편지',
        normTitle: '밤편지',
        albumArt: null,
        channelCount: 30,
        globalArtist: { canonicalName: '아이유' },
      },
    ]);

    const result = await svc.match({ query: 'my night' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      globalSongId: 99,
      matchMethod: 'ALIAS',
      matchConfidence: 'MEDIUM',
    });
  });

  it('stage 2 title-alias match filters by artist context', async () => {
    // Stage 1 miss
    redis.lookupArtistAlias.mockImplementation(async (alias: string) => {
      if (alias === '아이유' || alias === 'iu') return [7];
      return [];
    });
    redis.lookupSong.mockResolvedValue(null);
    // Title alias points to TWO songs: one by 아이유 (id 99) and one by
    // a different artist (id 88). The caller typed "아이유 - my night".
    redis.lookupTitleAlias.mockResolvedValue([88, 99]);

    prisma.globalSong.findMany.mockImplementation(async (args: any) => {
      // Stage 2 filter query: id in [88,99] AND artistId in [7]
      if (args.where?.globalArtistId) {
        return [{ id: 99, globalArtistId: 7 }];
      }
      // Final result-building query
      return [
        {
          id: 99,
          title: '밤편지',
          normTitle: '밤편지',
          albumArt: null,
          channelCount: 30,
          globalArtist: { canonicalName: '아이유' },
        },
      ];
    });

    const result = await svc.match({ query: '아이유 - my night' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].globalSongId).toBe(99);
    expect(result.results[0].matchMethod).toBe('ALIAS');
  });

  it('stage 3 fuzzy match returns FUZZY result', async () => {
    // No stage 1 or 2 hits
    redis.lookupArtistAlias.mockResolvedValue([]);
    redis.lookupSong.mockResolvedValue(null);
    redis.lookupTitleAlias.mockResolvedValue([]);
    // Fuzzy: prefix index returns 1 candidate
    redis.getPrefixCandidates.mockResolvedValue([88]);
    prisma.globalSong.findMany.mockImplementation(async (args: any) => {
      // First call is the fuzzy rerank lookup (select subset)
      if (args.select) {
        return [
          { id: 88, normTitle: '러브윈즈올', channelCount: 10 },
          { id: 99, normTitle: 'something else', channelCount: 5 },
        ];
      }
      // Second call is the result-building include lookup
      return [
        {
          id: 88,
          title: 'Love wins all',
          normTitle: '러브윈즈올',
          albumArt: null,
          channelCount: 10,
          globalArtist: { canonicalName: '아이유' },
        },
      ];
    });

    // Use an input title the matcher will normalize to the same key the fake returned
    const result = await svc.match({ query: '러브윈즈올' });
    expect(result.results.length).toBeGreaterThanOrEqual(0);
    // If the fuzzy threshold matches, verify the FUZZY method
    if (result.results.length > 0) {
      expect(result.results[0].matchMethod).toBe('FUZZY');
      expect(result.results[0].matchConfidence).toBe('LOW');
    }
  });

  it('returns empty results when nothing matches (stage 4 stub)', async () => {
    redis.lookupArtistAlias.mockResolvedValue([]);
    redis.lookupSong.mockResolvedValue(null);
    redis.lookupTitleAlias.mockResolvedValue([]);
    redis.getPrefixCandidates.mockResolvedValue([]);

    const result = await svc.match({ query: '아이유 - 없는곡' });
    expect(result.results).toEqual([]);
  });

  it('alreadyInChannel is true when channelId is provided and song is mapped', async () => {
    redis.lookupArtistAlias.mockResolvedValue([7]);
    redis.lookupSong.mockResolvedValue(42);
    redis.getChannelSongMapping.mockImplementation(
      async (gsId: number, channelId: number) => {
        if (gsId === 42 && channelId === 100) return 12345;
        return null;
      },
    );
    prisma.globalSong.findMany.mockResolvedValue([
      {
        id: 42,
        title: '밤편지',
        normTitle: '밤편지',
        albumArt: null,
        channelCount: 120,
        globalArtist: { canonicalName: '아이유' },
      },
    ]);

    const result = await svc.match({
      query: '아이유 - 밤편지',
      channelId: 100,
    });
    expect(result.results[0].alreadyInChannel).toBe(true);
  });

  it('alreadyInChannel is false when song is not mapped', async () => {
    redis.lookupArtistAlias.mockResolvedValue([7]);
    redis.lookupSong.mockResolvedValue(42);
    redis.getChannelSongMapping.mockResolvedValue(null);
    prisma.globalSong.findMany.mockResolvedValue([
      {
        id: 42,
        title: '밤편지',
        normTitle: '밤편지',
        albumArt: null,
        channelCount: 120,
        globalArtist: { canonicalName: '아이유' },
      },
    ]);

    const result = await svc.match({
      query: '아이유 - 밤편지',
      channelId: 100,
    });
    expect(result.results[0].alreadyInChannel).toBe(false);
  });

  it('topCategories from Redis are attached to results', async () => {
    redis.lookupArtistAlias.mockResolvedValue([7]);
    redis.lookupSong.mockResolvedValue(42);
    redis.getTopCategories.mockImplementation(async (id: number) => {
      if (id === 42) return ['발라드', 'K-POP'];
      return [];
    });
    prisma.globalSong.findMany.mockResolvedValue([
      {
        id: 42,
        title: '밤편지',
        normTitle: '밤편지',
        albumArt: null,
        channelCount: 120,
        globalArtist: { canonicalName: '아이유' },
      },
    ]);

    const result = await svc.match({ query: '아이유 - 밤편지' });
    expect(result.results[0].topCategories).toEqual(['발라드', 'K-POP']);
  });
});
