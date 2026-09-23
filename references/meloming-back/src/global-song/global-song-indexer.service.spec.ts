import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { GlobalSongRedisService } from './global-song-redis.service';
import { GlobalSongIndexerService } from './global-song-indexer.service';
import { CacheKeyTrackingService } from '../redis/cache-key-tracking.service';

/* -------------------------------------------------------------------------- */
/* Test helpers                                                                */
/* -------------------------------------------------------------------------- */

function createMockPrisma() {
  return {
    globalArtist: {
      upsert: jest.fn(),
      // findUnique is hit when redis returns exactly one alias candidate.
      // Default to null so the indexer falls through to upsert (which
      // individual tests mock); tests that exercise the alias path can
      // override this.
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    globalArtistAlias: { upsert: jest.fn() },
    globalSong: { upsert: jest.fn(), update: jest.fn() },
    globalSongAlias: { upsert: jest.fn() },
    song: { update: jest.fn().mockResolvedValue(undefined) },
  };
}

function createMockRedis(): jest.Mocked<GlobalSongRedisService> {
  return {
    isReady: jest.fn().mockReturnValue(true),
    addArtistAlias: jest.fn().mockResolvedValue(undefined),
    addTitleAlias: jest.fn().mockResolvedValue(undefined),
    setSongLookup: jest.fn().mockResolvedValue(undefined),
    setChannelSongMapping: jest.fn().mockResolvedValue(undefined),
    getChannelSongMapping: jest.fn().mockResolvedValue(null),
    addToChannelSongSet: jest.fn().mockResolvedValue(undefined),
    addToPrefixIndex: jest.fn().mockResolvedValue(undefined),
    incrementCategoryFrequency: jest.fn().mockResolvedValue(undefined),
    lookupArtistAlias: jest.fn().mockResolvedValue([]),
    lookupSong: jest.fn().mockResolvedValue(null),
    removeChannelSongMapping: jest.fn().mockResolvedValue(undefined),
    removeFromChannelSongSet: jest.fn().mockResolvedValue(undefined),
    removeFromPrefixIndex: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<GlobalSongRedisService>;
}

function createMockCacheTracker(): jest.Mocked<CacheKeyTrackingService> {
  return {
    clearChannelSafe: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<CacheKeyTrackingService>;
}

const baseCreatedEvent = {
  song: {
    id: 1,
    title: '밤편지',
    artistId: 7,
    channelId: 100,
    albumArt: null as string | null,
  },
  artistName: '아이유',
  channelId: 100,
  categoryNames: ['발라드', 'K-POP'],
};

/* -------------------------------------------------------------------------- */

describe('GlobalSongIndexerService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let redis: jest.Mocked<GlobalSongRedisService>;
  let svc: GlobalSongIndexerService;

  beforeEach(() => {
    prisma = createMockPrisma();
    redis = createMockRedis();
    const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
    svc = new GlobalSongIndexerService(
      prisma as unknown as PrismaService,
      redis,
      eventEmitter,
      createMockCacheTracker(),
    );
  });

  describe('handleSongCreated', () => {
    it('skips when redis is not ready (no upserts, no redis writes)', async () => {
      redis.isReady.mockReturnValue(false);
      await svc.handleSongCreated(baseCreatedEvent);
      expect(prisma.globalArtist.upsert).not.toHaveBeenCalled();
      expect(redis.setSongLookup).not.toHaveBeenCalled();
    });

    it('upserts global artist, song, bumps channelCount, writes Redis indexes (new channel mapping)', async () => {
      prisma.globalArtist.upsert.mockResolvedValue({
        id: 10,
        canonicalName: '아이유',
        normKey: '아이유',
      });
      prisma.globalSong.upsert.mockResolvedValue({
        id: 50,
        title: '밤편지',
        normTitle: '밤편지',
        globalArtistId: 10,
        albumArt: null,
        channelCount: 0,
      });
      prisma.globalSong.update.mockResolvedValue({
        id: 50,
        channelCount: 1,
      });
      // No existing mapping = new channel → channelCount should bump
      redis.getChannelSongMapping.mockResolvedValue(null);

      await svc.handleSongCreated(baseCreatedEvent);

      expect(prisma.globalArtist.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.globalSong.upsert).toHaveBeenCalledTimes(1);
      // Channel count WAS incremented
      expect(prisma.globalSong.update).toHaveBeenCalledWith({
        where: { id: 50 },
        data: { channelCount: { increment: 1 } },
        select: { channelCount: true },
      });
      expect(redis.setSongLookup).toHaveBeenCalledWith('밤편지', 10, 50);
      expect(redis.setChannelSongMapping).toHaveBeenCalledWith(50, 100, 1);
      expect(redis.addToChannelSongSet).toHaveBeenCalledWith(100, 50);
      expect(redis.addToPrefixIndex).toHaveBeenCalled();
      // Two category increments (발라드, K-POP)
      expect(redis.incrementCategoryFrequency).toHaveBeenCalledTimes(2);
      expect(redis.incrementCategoryFrequency).toHaveBeenCalledWith(
        50,
        '발라드',
        1,
      );
      expect(redis.incrementCategoryFrequency).toHaveBeenCalledWith(
        50,
        'K-POP',
        1,
      );
      // Alias frequency incremented (new channel)
      expect(prisma.globalArtistAlias.upsert).toHaveBeenCalled();
    });

    it('is idempotent: re-indexing same channel/song does NOT bump channelCount or alias freq', async () => {
      prisma.globalArtist.upsert.mockResolvedValue({
        id: 10,
        canonicalName: '아이유',
        normKey: '아이유',
      });
      prisma.globalSong.upsert.mockResolvedValue({
        id: 50,
        title: '밤편지',
        normTitle: '밤편지',
        globalArtistId: 10,
        albumArt: null,
        channelCount: 3,
      });
      // Existing mapping → replay case
      redis.getChannelSongMapping.mockResolvedValue(1);

      await svc.handleSongCreated(baseCreatedEvent);

      // channelCount update NOT called
      expect(prisma.globalSong.update).not.toHaveBeenCalled();
      // Alias frequency upserts NOT called (would double-count)
      expect(prisma.globalArtistAlias.upsert).not.toHaveBeenCalled();
      // Category frequency NOT incremented (would double-count)
      expect(redis.incrementCategoryFrequency).not.toHaveBeenCalled();
      // But Redis set-type writes STILL happen (idempotent by nature)
      expect(redis.setSongLookup).toHaveBeenCalled();
      expect(redis.setChannelSongMapping).toHaveBeenCalled();
      expect(redis.addArtistAlias).toHaveBeenCalled();
    });

    it('does NOT overwrite Redis mapping or dual-write when another song already owns the (globalSong, channel) pair', async () => {
      prisma.globalArtist.upsert.mockResolvedValue({
        id: 10,
        canonicalName: '아이유',
        normKey: '아이유',
      });
      prisma.globalSong.upsert.mockResolvedValue({
        id: 50,
        title: '밤편지',
        normTitle: '밤편지',
        globalArtistId: 10,
        albumArt: null,
        channelCount: 1,
      });
      // 다른 songId(2)가 이미 (globalSong 50, channel 100) 을 차지.
      // 현재 이벤트의 song.id 는 1 → 충돌. song 테이블 unique([channelId,
      // globalSongId]) 제약상 이 song 으로 매핑을 덮어쓰면 안 된다.
      redis.getChannelSongMapping.mockResolvedValue(2);

      await svc.handleSongCreated(baseCreatedEvent);

      // Redis 채널-곡 매핑을 덮어쓰지 않음 (기존 songId 2 유지)
      expect(redis.setChannelSongMapping).not.toHaveBeenCalled();
      // dual-write(song.update) skip — P2002 회피 + Redis/DB 정합성 보존
      expect(prisma.song.update).not.toHaveBeenCalled();
      // 기존 매핑이라 channelCount 도 안 올림 (isNewChannelMapping=false)
      expect(prisma.globalSong.update).not.toHaveBeenCalled();
      // globalSong upsert 자체는 정상 진행 (idempotent)
      expect(prisma.globalSong.upsert).toHaveBeenCalledTimes(1);
      // 충돌과 무관한 set-type Redis write 는 그대로 (idempotent)
      expect(redis.setSongLookup).toHaveBeenCalled();
      expect(redis.addToChannelSongSet).toHaveBeenCalledWith(100, 50);
    });

    it('swallows errors and does not propagate them to the caller', async () => {
      prisma.globalArtist.upsert.mockRejectedValue(new Error('DB down'));
      await expect(svc.handleSongCreated(baseCreatedEvent)).resolves.toBeUndefined();
    });

    it('gracefully handles empty artist name (normalizer throws)', async () => {
      await expect(
        svc.handleSongCreated({
          ...baseCreatedEvent,
          artistName: '',
        }),
      ).resolves.toBeUndefined();
      expect(prisma.globalArtist.upsert).not.toHaveBeenCalled();
    });
  });

  describe('handleSongDeleted', () => {
    it('removes channel mapping and decrements channelCount', async () => {
      redis.lookupArtistAlias.mockResolvedValue([10]);
      redis.lookupSong.mockResolvedValue(50);
      redis.getChannelSongMapping.mockResolvedValue(1);
      prisma.globalSong.update.mockResolvedValue({
        id: 50,
        channelCount: 5,
      });

      await svc.handleSongDeleted({
        songId: 1,
        title: '밤편지',
        artistName: '아이유',
        channelId: 100,
        categoryNames: ['발라드'],
      });

      expect(redis.removeChannelSongMapping).toHaveBeenCalledWith(50, 100);
      expect(redis.removeFromChannelSongSet).toHaveBeenCalledWith(100, 50);
      expect(prisma.globalSong.update).toHaveBeenCalledWith({
        where: { id: 50 },
        data: { channelCount: { decrement: 1 } },
      });
    });

    it('decrements category frequency using event categoryNames (not DB query)', async () => {
      redis.lookupArtistAlias.mockResolvedValue([10]);
      redis.lookupSong.mockResolvedValue(50);
      redis.getChannelSongMapping.mockResolvedValue(1);
      prisma.globalSong.update.mockResolvedValue({
        id: 50,
        channelCount: 3,
      });

      await svc.handleSongDeleted({
        songId: 1,
        title: '밤편지',
        artistName: '아이유',
        channelId: 100,
        categoryNames: ['발라드', 'K-POP'],
      });

      expect(redis.incrementCategoryFrequency).toHaveBeenCalledWith(
        50,
        '발라드',
        -1,
      );
      expect(redis.incrementCategoryFrequency).toHaveBeenCalledWith(
        50,
        'K-POP',
        -1,
      );
    });

    it('removes prefix index entry when channelCount reaches 0', async () => {
      redis.lookupArtistAlias.mockResolvedValue([10]);
      redis.lookupSong.mockResolvedValue(50);
      redis.getChannelSongMapping.mockResolvedValue(1);
      prisma.globalSong.update.mockResolvedValue({
        id: 50,
        channelCount: 0,
      });

      await svc.handleSongDeleted({
        songId: 1,
        title: '밤편지',
        artistName: '아이유',
        channelId: 100,
        categoryNames: [],
      });

      expect(redis.removeFromPrefixIndex).toHaveBeenCalled();
    });

    it('is idempotent: no-op when channel mapping does not exist', async () => {
      redis.lookupArtistAlias.mockResolvedValue([10]);
      redis.lookupSong.mockResolvedValue(50);
      redis.getChannelSongMapping.mockResolvedValue(null);

      await svc.handleSongDeleted({
        songId: 1,
        title: '밤편지',
        artistName: '아이유',
        channelId: 100,
        categoryNames: ['발라드'],
      });

      // No DB update, no category decrement, no channel removals
      expect(prisma.globalSong.update).not.toHaveBeenCalled();
      expect(redis.incrementCategoryFrequency).not.toHaveBeenCalled();
      expect(redis.removeChannelSongMapping).not.toHaveBeenCalled();
    });

    it('does nothing when artist is not in the alias index', async () => {
      redis.lookupArtistAlias.mockResolvedValue([]);
      await svc.handleSongDeleted({
        songId: 1,
        title: '밤편지',
        artistName: '아이유',
        channelId: 100,
        categoryNames: [],
      });
      expect(redis.removeChannelSongMapping).not.toHaveBeenCalled();
    });

    it('swallows errors from the underlying store', async () => {
      redis.lookupArtistAlias.mockRejectedValue(new Error('Redis down'));
      await expect(
        svc.handleSongDeleted({
          songId: 1,
          title: '밤편지',
          artistName: '아이유',
          channelId: 100,
          categoryNames: [],
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('handleSongUpdated', () => {
    it('deindexes old and indexes new when title changes', async () => {
      // deindex lookup path
      redis.lookupArtistAlias.mockResolvedValue([10]);
      redis.lookupSong.mockResolvedValue(50);
      // Existing channel mapping on deindex side
      redis.getChannelSongMapping
        .mockResolvedValueOnce(1) // deindex check - existing
        .mockResolvedValue(null); // reindex check - new after deindex
      prisma.globalSong.update.mockResolvedValue({
        id: 50,
        channelCount: 3,
      });
      prisma.globalArtist.upsert.mockResolvedValue({
        id: 10,
        canonicalName: '아이유',
        normKey: '아이유',
      });
      prisma.globalSong.upsert.mockResolvedValue({
        id: 51,
        title: 'New Title',
        normTitle: 'new title',
        globalArtistId: 10,
        albumArt: null,
        channelCount: 0,
      });

      await svc.handleSongUpdated({
        oldSong: {
          id: 1,
          title: '밤편지',
          artistId: 7,
          channelId: 100,
          albumArt: null,
        },
        oldArtistName: '아이유',
        oldCategoryNames: ['발라드'],
        newSong: {
          id: 1,
          title: 'New Title',
          artistId: 7,
          channelId: 100,
          albumArt: null,
        },
        newArtistName: '아이유',
        newCategoryNames: ['발라드'],
        channelId: 100,
      });

      // Deindex side: channel mapping removed
      expect(redis.removeChannelSongMapping).toHaveBeenCalled();
      // Reindex side: new title lookup written
      expect(redis.setSongLookup).toHaveBeenCalledWith('new title', 10, 51);
    });
  });
});
