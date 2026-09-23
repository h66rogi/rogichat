import { ConfigService } from '@nestjs/config';
import { GlobalSongRedisService } from './global-song-redis.service';

/**
 * GlobalSongRedisService tests.
 *
 * We build a lightweight in-memory fake of the node-redis v5 client that
 * exercises every method the service touches. This avoids depending on a
 * live Redis during unit tests while still catching key-name bugs and
 * wrong command usage.
 */

type FakeRedis = {
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  sAdd: jest.Mock;
  sRem: jest.Mock;
  sMembers: jest.Mock;
  hSet: jest.Mock;
  hGet: jest.Mock;
  hDel: jest.Mock;
  hLen: jest.Mock;
  zAdd: jest.Mock;
  zRem: jest.Mock;
  zRange: jest.Mock;
  zIncrBy: jest.Mock;
  scanIterator: jest.Mock;
  quit: jest.Mock;
  connect: jest.Mock;
  on: jest.Mock;
};

function createFakeRedis(): FakeRedis {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    sAdd: jest.fn().mockResolvedValue(1),
    sRem: jest.fn().mockResolvedValue(1),
    sMembers: jest.fn().mockResolvedValue([]),
    hSet: jest.fn().mockResolvedValue(1),
    hGet: jest.fn().mockResolvedValue(null),
    hDel: jest.fn().mockResolvedValue(1),
    hLen: jest.fn().mockResolvedValue(0),
    zAdd: jest.fn().mockResolvedValue(1),
    zRem: jest.fn().mockResolvedValue(1),
    zRange: jest.fn().mockResolvedValue([]),
    zIncrBy: jest.fn().mockResolvedValue(1),
    scanIterator: jest.fn().mockReturnValue((async function* () {})()),
    quit: jest.fn().mockResolvedValue('OK'),
    connect: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
  };
}

/**
 * Helper: build a service with a fake client already attached and marked
 * ready, bypassing onModuleInit (which wants real network).
 */
function buildService(fake: FakeRedis): GlobalSongRedisService {
  const config = {
    get: jest.fn().mockReturnValue('localhost'),
  } as unknown as ConfigService;
  const svc = new GlobalSongRedisService(config);
  // Cast to any to poke the private fields for test setup
  (svc as any).client = fake;
  (svc as any)._ready = true;
  return svc;
}

describe('GlobalSongRedisService', () => {
  let fake: FakeRedis;
  let svc: GlobalSongRedisService;

  beforeEach(() => {
    fake = createFakeRedis();
    svc = buildService(fake);
  });

  describe('readiness gate', () => {
    it('returns true when client is set and _ready', () => {
      expect(svc.isReady()).toBe(true);
    });

    it('returns false when not ready', () => {
      (svc as any)._ready = false;
      expect(svc.isReady()).toBe(false);
    });

    it('lookupSong returns null when not ready (no call to redis)', async () => {
      (svc as any)._ready = false;
      const result = await svc.lookupSong('title', 1);
      expect(result).toBeNull();
      expect(fake.get).not.toHaveBeenCalled();
    });

    it('setSongLookup is a no-op when not ready', async () => {
      (svc as any)._ready = false;
      await svc.setSongLookup('title', 1, 100);
      expect(fake.set).not.toHaveBeenCalled();
    });
  });

  describe('song lookup', () => {
    it('reads the correct key pattern', async () => {
      fake.get.mockResolvedValue('42');
      const result = await svc.lookupSong('밤편지', 7);
      expect(fake.get).toHaveBeenCalledWith('gs:lookup:밤편지:7');
      expect(result).toBe(42);
    });

    it('returns null when missing', async () => {
      fake.get.mockResolvedValue(null);
      const result = await svc.lookupSong('missing', 1);
      expect(result).toBeNull();
    });

    it('writes with the correct key and stringifies the id', async () => {
      await svc.setSongLookup('love', 3, 99);
      expect(fake.set).toHaveBeenCalledWith('gs:lookup:love:3', '99');
    });

    it('deletes the correct key', async () => {
      await svc.deleteSongLookup('love', 3);
      expect(fake.del).toHaveBeenCalledWith('gs:lookup:love:3');
    });
  });

  describe('artist alias set', () => {
    it('sMembers returns numeric ids', async () => {
      fake.sMembers.mockResolvedValue(['1', '2', '3']);
      const result = await svc.lookupArtistAlias('iu');
      expect(fake.sMembers).toHaveBeenCalledWith('ga:alias:iu');
      expect(result).toEqual([1, 2, 3]);
    });

    it('addArtistAlias sAdds the stringified id', async () => {
      await svc.addArtistAlias('iu', 42);
      expect(fake.sAdd).toHaveBeenCalledWith('ga:alias:iu', '42');
    });

    it('removeArtistAlias sRems the stringified id', async () => {
      await svc.removeArtistAlias('iu', 42);
      expect(fake.sRem).toHaveBeenCalledWith('ga:alias:iu', '42');
    });
  });

  describe('title alias set', () => {
    it('sMembers returns numeric ids', async () => {
      fake.sMembers.mockResolvedValue(['10', '20']);
      const result = await svc.lookupTitleAlias('my night');
      expect(fake.sMembers).toHaveBeenCalledWith('gs:title_alias:my night');
      expect(result).toEqual([10, 20]);
    });

    it('addTitleAlias sAdds the stringified id', async () => {
      await svc.addTitleAlias('my night', 10);
      expect(fake.sAdd).toHaveBeenCalledWith('gs:title_alias:my night', '10');
    });
  });

  describe('channel song mapping hash', () => {
    it('setChannelSongMapping hSets the right keys', async () => {
      await svc.setChannelSongMapping(5, 100, 999);
      expect(fake.hSet).toHaveBeenCalledWith('gs:5:channels', '100', '999');
    });

    it('getChannelSongMapping parses numeric result', async () => {
      fake.hGet.mockResolvedValue('999');
      const result = await svc.getChannelSongMapping(5, 100);
      expect(fake.hGet).toHaveBeenCalledWith('gs:5:channels', '100');
      expect(result).toBe(999);
    });

    it('getChannelSongMapping returns null when missing', async () => {
      fake.hGet.mockResolvedValue(null);
      const result = await svc.getChannelSongMapping(5, 100);
      expect(result).toBeNull();
    });

    it('removeChannelSongMapping hDels the right keys', async () => {
      await svc.removeChannelSongMapping(5, 100);
      expect(fake.hDel).toHaveBeenCalledWith('gs:5:channels', '100');
    });

    it('getChannelSongMappingCount returns hLen', async () => {
      fake.hLen.mockResolvedValue(3);
      const result = await svc.getChannelSongMappingCount(5);
      expect(fake.hLen).toHaveBeenCalledWith('gs:5:channels');
      expect(result).toBe(3);
    });
  });

  describe('channel global-song set', () => {
    it('addToChannelSongSet sAdds', async () => {
      await svc.addToChannelSongSet(100, 5);
      expect(fake.sAdd).toHaveBeenCalledWith('ch:100:gsongs', '5');
    });

    it('removeFromChannelSongSet sRems', async () => {
      await svc.removeFromChannelSongSet(100, 5);
      expect(fake.sRem).toHaveBeenCalledWith('ch:100:gsongs', '5');
    });

    it('getChannelSongSet returns numeric ids', async () => {
      fake.sMembers.mockResolvedValue(['1', '2', '3']);
      const result = await svc.getChannelSongSet(100);
      expect(fake.sMembers).toHaveBeenCalledWith('ch:100:gsongs');
      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe('prefix sorted set', () => {
    it('addToPrefixIndex zAdds with score = channelCount', async () => {
      await svc.addToPrefixIndex('밤', 42, 500);
      expect(fake.zAdd).toHaveBeenCalledWith('gs:prefix:밤', {
        score: 500,
        value: '42',
      });
    });

    it('getPrefixCandidates zRanges in reverse order', async () => {
      fake.zRange.mockResolvedValue(['1', '2', '3']);
      const result = await svc.getPrefixCandidates('밤', 10);
      expect(fake.zRange).toHaveBeenCalledWith(
        'gs:prefix:밤',
        0,
        9,
        { REV: true },
      );
      expect(result).toEqual([1, 2, 3]);
    });

    it('removeFromPrefixIndex zRems', async () => {
      await svc.removeFromPrefixIndex('밤', 42);
      expect(fake.zRem).toHaveBeenCalledWith('gs:prefix:밤', '42');
    });
  });

  describe('category frequency sorted set', () => {
    it('incrementCategoryFrequency zIncrBy with +1 default', async () => {
      await svc.incrementCategoryFrequency(5, 'K-POP');
      expect(fake.zIncrBy).toHaveBeenCalledWith(
        'gs:5:categories',
        1,
        'K-POP',
      );
    });

    it('incrementCategoryFrequency can use custom delta', async () => {
      await svc.incrementCategoryFrequency(5, 'K-POP', -1);
      expect(fake.zIncrBy).toHaveBeenCalledWith(
        'gs:5:categories',
        -1,
        'K-POP',
      );
    });

    it('getTopCategories zRanges in reverse order', async () => {
      fake.zRange.mockResolvedValue(['발라드', 'K-POP']);
      const result = await svc.getTopCategories(5, 5);
      expect(fake.zRange).toHaveBeenCalledWith(
        'gs:5:categories',
        0,
        4,
        { REV: true },
      );
      expect(result).toEqual(['발라드', 'K-POP']);
    });
  });

  describe('flushGlobalSongKeys', () => {
    it('scans and deletes every key family', async () => {
      // Return a few keys for every pattern
      fake.scanIterator.mockReturnValue(
        (async function* () {
          yield 'gs:lookup:밤편지:1';
        })(),
      );
      await svc.flushGlobalSongKeys();

      // 7 patterns total: lookup, title_alias, prefix, ga:alias, ch:*:gsongs,
      // gs:*:channels, gs:*:categories
      expect(fake.scanIterator).toHaveBeenCalledTimes(7);
      // At least one del call per pattern
      expect(fake.del).toHaveBeenCalled();
    });
  });
});
