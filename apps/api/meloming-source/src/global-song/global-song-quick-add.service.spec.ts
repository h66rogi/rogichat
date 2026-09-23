import { ConflictException } from '@nestjs/common';
import { GlobalSongQuickAddService } from './global-song-quick-add.service';

function buildService(overrides: {
  redis?: Record<string, unknown>;
  prisma?: Record<string, unknown>;
  songMutation?: Record<string, unknown>;
  recommendations?: Record<string, unknown>;
  merge?: Record<string, unknown>;
} = {}) {
  const redis = {
    isReady: jest.fn().mockReturnValue(true),
    getChannelSongMapping: jest.fn().mockResolvedValue(null),
    ...overrides.redis,
  };
  const prisma = {
    song: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    globalSong: {
      findUnique: jest.fn().mockResolvedValue({
        id: 100,
        title: '좋은 날',
        albumArt: 'https://cdn.test/cover.jpg',
        globalArtist: { canonicalName: '아이유' },
      }),
    },
    ...overrides.prisma,
  };
  const songMutation = {
    createSongByChannelId: jest.fn().mockResolvedValue({
      id: 77,
      title: '좋은 날',
      globalSongId: 100,
    }),
    ...overrides.songMutation,
  };
  const recommendations = {
    getPostAddRecommendations: jest.fn().mockResolvedValue([]),
    ...overrides.recommendations,
  };
  const merge = {
    resolveMerged: jest.fn().mockResolvedValue({
      canonicalId: 100,
      mergedFrom: null,
    }),
    ...overrides.merge,
  };

  const service = new GlobalSongQuickAddService(
    prisma as any,
    redis as any,
    songMutation as any,
    recommendations as any,
    merge as any,
  );

  return { service, redis, prisma, songMutation, recommendations, merge };
}

describe('GlobalSongQuickAddService', () => {
  it('creates the channel song with a synchronous globalSongId mapping', async () => {
    const { service, songMutation } = buildService();

    await service.quickAdd(10, {
      globalSongId: 100,
      categoryNames: ['발라드'],
      difficulty: 3,
    });

    expect(songMutation.createSongByChannelId).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '좋은 날',
        artistName: '아이유',
        categoryNames: ['발라드'],
        difficulty: 3,
      }),
      10,
      undefined,
      { globalSongId: 100 },
    );
  });

  it('checks the DB mapping as well as Redis before creating', async () => {
    const existingSong = {
      id: 55,
      title: '좋은 날',
      artist: { name: '아이유' },
      songCategories: [],
    };
    const { service, prisma, songMutation } = buildService({
      prisma: {
        song: {
          findFirst: jest.fn().mockResolvedValue(existingSong),
        },
        globalSong: {
          findUnique: jest.fn(),
        },
      },
    });

    await expect(
      service.quickAdd(10, { globalSongId: 100, categoryNames: ['발라드'] }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.song.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { channelId: 10, globalSongId: 100 },
      }),
    );
    expect(songMutation.createSongByChannelId).not.toHaveBeenCalled();
  });
});
