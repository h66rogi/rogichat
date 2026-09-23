import { SongQueryService } from './song-query.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Regression tests for the Song query service response shape.
 *
 * The fan-facing /song/[id] page and channel song book rely on
 * Song.globalSongId being present in the JSON response so the frontend
 * can link a channel-scoped Song to its cross-channel GlobalSong.
 *
 * The current implementation uses Prisma `include` (which returns every
 * scalar column automatically), so globalSongId is surfaced via the
 * `...rest` spread in the response mapper. This spec locks in that
 * behavior so a future refactor to an explicit `select` doesn't silently
 * drop the field.
 */

function makeCacheTracker() {
  const store = new Map<string, unknown>();
  return {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    trackAndSet: jest.fn(
      async (key: string, value: unknown, _ttl: number, _scope: unknown) => {
        store.set(key, value);
      },
    ),
    clearChannel: jest.fn(async () => 0),
    clearGlobal: jest.fn(async () => 0),
    clearChannelsBatch: jest.fn(async () => 0),
  } as any;
}

describe('SongQueryService — Song response includes globalSongId', () => {
  it('preserves Song.globalSongId in the getSongsByChannelId response (Phase 4.1)', async () => {
    const song = {
      id: 101,
      title: '밤편지',
      artistId: 7,
      channelId: 42,
      globalSongId: 1234, // MUST survive into the response
      albumArt: null,
      karaokeUrl: null,
      coverUrl: null,
      originalUrl: null,
      difficulty: null,
      proficiency: null,
      songKey: null,
      bpm: null,
      lyricsLink: null,
      lyricsText: '이건 숨겨야 함', // stripped — author-only memo
      description: null,
      price: null,
      currencyPrices: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      artist: { id: 7, name: '아이유' },
      songCategories: [],
      channel: {
        id: 42,
        name: 'ch',
        webPath: 'ch',
        themeColor: '#000',
        profileImageUrl: null,
        user: { id: 1, nickname: 'u' },
      },
      _count: { userLikes: 0 },
    };
    const prisma = {
      song: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([song]),
      },
      userSongLike: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;

    const svc = new SongQueryService(prisma, makeCacheTracker());

    const result = await svc.getSongsByChannelId(42, { page: 1, limit: 20 });

    expect(result.songs).toHaveLength(1);
    const returned = result.songs[0] as Record<string, unknown>;
    expect(returned.globalSongId).toBe(1234);
    // lyricsText must still be stripped (security / author-only memo).
    expect(returned.lyricsText).toBeUndefined();
  });

  it('allows globalSongId to be null when the Song has no cross-channel mapping', async () => {
    const song = {
      id: 200,
      title: 'Unmapped',
      artistId: 1,
      channelId: 1,
      globalSongId: null,
      albumArt: null,
      karaokeUrl: null,
      coverUrl: null,
      originalUrl: null,
      difficulty: null,
      proficiency: null,
      songKey: null,
      bpm: null,
      lyricsLink: null,
      lyricsText: null,
      description: null,
      price: null,
      currencyPrices: null,
      createdAt: new Date(),
      artist: { id: 1, name: 'a' },
      songCategories: [],
      channel: {
        id: 1,
        name: 'ch',
        webPath: 'ch',
        themeColor: '#000',
        profileImageUrl: null,
        user: { id: 1, nickname: 'u' },
      },
      _count: { userLikes: 0 },
    };
    const prisma = {
      song: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([song]),
      },
      userSongLike: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;

    const svc = new SongQueryService(prisma, makeCacheTracker());

    const result = await svc.getSongsByChannelId(1, { page: 1, limit: 20 });
    const returned = result.songs[0] as Record<string, unknown>;
    // null must still be surfaced (not omitted) so the frontend can branch
    // on it.
    expect(returned).toHaveProperty('globalSongId', null);
  });
});

describe('SongQueryService — cache key role separation (Phase 5.2)', () => {
  // Without _role_ in the cache key, a manager response (containing
  // sheetMusicUrl in Phase 5.3) would be served back to a non-manager who
  // hits the same key. This locks in that manager and viewer keys are
  // distinct.

  function makeSong(id: number, channelId: number) {
    return {
      id,
      title: `song-${id}`,
      artistId: 1,
      channelId,
      globalSongId: null,
      albumArt: null,
      karaokeUrl: null,
      coverUrl: null,
      originalUrl: null,
      difficulty: null,
      proficiency: null,
      songKey: null,
      bpm: null,
      lyricsLink: null,
      lyricsText: null,
      description: null,
      price: null,
      currencyPrices: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      artist: { id: 1, name: 'a' },
      songCategories: [],
      channel: {
        id: channelId,
        name: 'ch',
        webPath: 'ch',
        themeColor: '#000',
        profileImageUrl: null,
        user: { id: 1, nickname: 'u' },
      },
      _count: { userLikes: 0 },
    };
  }

  it('manager and viewer get different cache keys for same query params (getSongsByChannelId)', async () => {
    const prisma = {
      song: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([makeSong(1, 42)]),
      },
      userSongLike: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;

    const cache = makeCacheTracker();
    const svc = new SongQueryService(prisma, cache);

    await svc.getSongsByChannelId(
      42,
      { page: 1, limit: 20 },
      { userId: 1, isManager: true },
    );
    const managerKey = (cache.trackAndSet as jest.Mock).mock.calls[0]?.[0] as string;

    (cache.trackAndSet as jest.Mock).mockClear();

    await svc.getSongsByChannelId(
      42,
      { page: 1, limit: 20 },
      { userId: 2, isManager: false },
    );
    const viewerKey = (cache.trackAndSet as jest.Mock).mock.calls[0]?.[0] as string;

    expect(managerKey).toContain('role_manager');
    expect(viewerKey).toContain('role_viewer');
    expect(managerKey).not.toBe(viewerKey);
  });

  it('manager and viewer get different cache keys (getSongsByChannelIdV2)', async () => {
    const prisma = {
      song: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([makeSong(1, 42)]),
      },
      userSongLike: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;

    const cache = makeCacheTracker();
    const svc = new SongQueryService(prisma, cache);

    await svc.getSongsByChannelIdV2(
      42,
      { page: 1, limit: 20 },
      { userId: 1, isManager: true },
    );
    const managerKey = (cache.trackAndSet as jest.Mock).mock.calls[0]?.[0] as string;

    (cache.trackAndSet as jest.Mock).mockClear();

    await svc.getSongsByChannelIdV2(
      42,
      { page: 1, limit: 20 },
      { userId: 2, isManager: false },
    );
    const viewerKey = (cache.trackAndSet as jest.Mock).mock.calls[0]?.[0] as string;

    expect(managerKey).toContain('role_manager');
    expect(viewerKey).toContain('role_viewer');
    expect(managerKey).not.toBe(viewerKey);
  });

  it('manager and viewer get different cache keys (searchSongs)', async () => {
    const prisma = {
      song: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([makeSong(1, 42)]),
      },
      userSongLike: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;

    const cache = makeCacheTracker();
    const svc = new SongQueryService(prisma, cache);

    await svc.searchSongs(
      { page: 1, limit: 20, search: 'foo' },
      { userId: 1, isManager: true },
    );
    const managerKey = (cache.trackAndSet as jest.Mock).mock.calls[0]?.[0] as string;

    (cache.trackAndSet as jest.Mock).mockClear();

    await svc.searchSongs(
      { page: 1, limit: 20, search: 'foo' },
      { userId: 2, isManager: false },
    );
    const viewerKey = (cache.trackAndSet as jest.Mock).mock.calls[0]?.[0] as string;

    expect(managerKey).toContain('role_manager');
    expect(viewerKey).toContain('role_viewer');
    expect(managerKey).not.toBe(viewerKey);
  });

  it('manager and viewer get different cache keys (getRandomSongsByChannelId)', async () => {
    const prisma = {
      song: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest
          .fn()
          // 1st call: select id list for cache priming
          .mockResolvedValueOnce([{ id: 1 }])
          // 2nd call: hydrated detail
          .mockResolvedValueOnce([makeSong(1, 42)]),
      },
      userSongLike: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;

    const cache = makeCacheTracker();
    const svc = new SongQueryService(prisma, cache);

    await svc.getRandomSongsByChannelId(42, 1, [], {
      userId: 1,
      isManager: true,
    });
    const managerKey = (cache.trackAndSet as jest.Mock).mock.calls[0]?.[0] as string;

    (cache.trackAndSet as jest.Mock).mockClear();

    // Reset Prisma findMany mock for the viewer call sequence
    (prisma.song.findMany as jest.Mock)
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([makeSong(1, 42)]);

    await svc.getRandomSongsByChannelId(42, 1, [], {
      userId: 2,
      isManager: false,
    });
    const viewerKey = (cache.trackAndSet as jest.Mock).mock.calls[0]?.[0] as string;

    expect(managerKey).toContain('role_manager');
    expect(viewerKey).toContain('role_viewer');
    expect(managerKey).not.toBe(viewerKey);
  });
});

describe('SongQueryService — Phase 5.3 sheet music permission-aware response', () => {
  // Sheet music URLs are author-only (sales/PDF assets). Managers receive a
  // flattened { sheetMusicUrl, sheetMusicType } convenience pair derived from
  // the isPrimary=true row; non-managers receive neither field nor the raw
  // sheetMusics relation. lyricsText remains stripped for ALL viewers in these
  // list/search endpoints — the established policy is to surface lyricsText
  // only via the single-song endpoints in song.service.ts.

  function makeSongWithSheet(
    id: number,
    channelId: number,
    sheetMusics: Array<{ url: string; type: string; isPrimary: boolean }>,
  ) {
    return {
      id,
      title: `song-${id}`,
      artistId: 1,
      channelId,
      globalSongId: null,
      albumArt: null,
      karaokeUrl: null,
      coverUrl: null,
      originalUrl: null,
      difficulty: null,
      proficiency: null,
      songKey: null,
      bpm: null,
      lyricsLink: null,
      lyricsText: 'private memo',
      description: null,
      price: null,
      currencyPrices: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      artist: { id: 1, name: 'a' },
      songCategories: [],
      channel: {
        id: channelId,
        name: 'ch',
        webPath: 'ch',
        themeColor: '#000',
        profileImageUrl: null,
        user: { id: 1, nickname: 'u' },
      },
      sheetMusics,
      _count: { userLikes: 0 },
    };
  }

  describe('getSongsByChannelId (primary coverage)', () => {
    it('manager response flattens sheetMusicUrl/Type and strips raw sheetMusics + lyricsText', async () => {
      const song = makeSongWithSheet(1, 42, [
        { url: 'https://cdn/x.pdf', type: 'PDF', isPrimary: true },
      ]);
      const prisma = {
        song: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockResolvedValue([song]),
        },
        userSongLike: { findMany: jest.fn().mockResolvedValue([]) },
      } as unknown as PrismaService;

      const svc = new SongQueryService(prisma, makeCacheTracker());

      const result = await svc.getSongsByChannelId(
        42,
        { page: 1, limit: 20 },
        { userId: 1, isManager: true },
      );

      const item = result.songs[0] as Record<string, unknown>;
      expect(item.sheetMusicUrl).toBe('https://cdn/x.pdf');
      expect(item.sheetMusicType).toBe('PDF');
      // Raw 1:N relation must never leak into the response
      expect(item.sheetMusics).toBeUndefined();
      // lyricsText policy: stripped for ALL viewers in list endpoints
      expect(item.lyricsText).toBeUndefined();
    });

    it('non-manager response excludes sheetMusicUrl/Type AND raw sheetMusics relation', async () => {
      const song = makeSongWithSheet(1, 42, [
        { url: 'https://cdn/x.pdf', type: 'PDF', isPrimary: true },
      ]);
      const prisma = {
        song: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockResolvedValue([song]),
        },
        userSongLike: { findMany: jest.fn().mockResolvedValue([]) },
      } as unknown as PrismaService;

      const svc = new SongQueryService(prisma, makeCacheTracker());

      const result = await svc.getSongsByChannelId(
        42,
        { page: 1, limit: 20 },
        { userId: 2, isManager: false },
      );

      const item = result.songs[0] as Record<string, unknown>;
      expect(item.sheetMusicUrl).toBeUndefined();
      expect(item.sheetMusicType).toBeUndefined();
      expect(item.sheetMusics).toBeUndefined();
      expect(item.lyricsText).toBeUndefined();
    });

    it('manager response with no sheet music returns null (not undefined) for both fields', async () => {
      const song = makeSongWithSheet(1, 42, []);
      const prisma = {
        song: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockResolvedValue([song]),
        },
        userSongLike: { findMany: jest.fn().mockResolvedValue([]) },
      } as unknown as PrismaService;

      const svc = new SongQueryService(prisma, makeCacheTracker());

      const result = await svc.getSongsByChannelId(
        42,
        { page: 1, limit: 20 },
        { userId: 1, isManager: true },
      );

      const item = result.songs[0] as Record<string, unknown>;
      expect(item).toHaveProperty('sheetMusicUrl', null);
      expect(item).toHaveProperty('sheetMusicType', null);
      expect(item.sheetMusics).toBeUndefined();
    });

    it('manager response prefers an isPrimary=true row when relation contains multiple rows', async () => {
      // Defensive: Prisma include filter (where: { isPrimary: true }) should
      // already filter to primaries, but the helper must still .find() to be
      // resilient if invariants drift.
      const song = makeSongWithSheet(1, 42, [
        { url: 'https://cdn/secondary.pdf', type: 'IMAGE', isPrimary: false },
        { url: 'https://cdn/primary.pdf', type: 'PDF', isPrimary: true },
      ]);
      const prisma = {
        song: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockResolvedValue([song]),
        },
        userSongLike: { findMany: jest.fn().mockResolvedValue([]) },
      } as unknown as PrismaService;

      const svc = new SongQueryService(prisma, makeCacheTracker());

      const result = await svc.getSongsByChannelId(
        42,
        { page: 1, limit: 20 },
        { userId: 1, isManager: true },
      );

      const item = result.songs[0] as Record<string, unknown>;
      expect(item.sheetMusicUrl).toBe('https://cdn/primary.pdf');
      expect(item.sheetMusicType).toBe('PDF');
    });
  });

  describe('sanity coverage for the other 4 query functions', () => {
    it('getSongsByChannelIdV2 — manager flatten, viewer strip', async () => {
      const song = makeSongWithSheet(1, 42, [
        { url: 'https://cdn/v2.pdf', type: 'PDF', isPrimary: true },
      ]);
      const prisma = {
        song: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockResolvedValue([song]),
        },
        userSongLike: { findMany: jest.fn().mockResolvedValue([]) },
      } as unknown as PrismaService;

      const svc = new SongQueryService(prisma, makeCacheTracker());

      const mgr = await svc.getSongsByChannelIdV2(
        42,
        { page: 1, limit: 20 },
        { userId: 1, isManager: true },
      );
      const mgrItem = mgr.songs[0] as Record<string, unknown>;
      expect(mgrItem.sheetMusicUrl).toBe('https://cdn/v2.pdf');
      expect(mgrItem.sheetMusicType).toBe('PDF');
      expect(mgrItem.sheetMusics).toBeUndefined();

      // Reset findMany for the viewer call (cache should not interfere because
      // role-suffixed key separates buckets).
      (prisma.song.findMany as jest.Mock).mockResolvedValue([song]);
      const viewer = await svc.getSongsByChannelIdV2(
        42,
        { page: 1, limit: 20 },
        { userId: 2, isManager: false },
      );
      const viewerItem = viewer.songs[0] as Record<string, unknown>;
      expect(viewerItem.sheetMusicUrl).toBeUndefined();
      expect(viewerItem.sheetMusicType).toBeUndefined();
      expect(viewerItem.sheetMusics).toBeUndefined();
    });

    it('searchSongs — manager flatten, viewer strip', async () => {
      const song = makeSongWithSheet(1, 42, [
        { url: 'https://cdn/search.pdf', type: 'MUSICXML', isPrimary: true },
      ]);
      const prisma = {
        song: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockResolvedValue([song]),
        },
        userSongLike: { findMany: jest.fn().mockResolvedValue([]) },
      } as unknown as PrismaService;

      const svc = new SongQueryService(prisma, makeCacheTracker());

      const mgr = await svc.searchSongs(
        { page: 1, limit: 20, search: 'foo' },
        { userId: 1, isManager: true },
      );
      const mgrItem = mgr.songs[0] as Record<string, unknown>;
      expect(mgrItem.sheetMusicUrl).toBe('https://cdn/search.pdf');
      expect(mgrItem.sheetMusicType).toBe('MUSICXML');

      (prisma.song.findMany as jest.Mock).mockResolvedValue([song]);
      const viewer = await svc.searchSongs(
        { page: 1, limit: 20, search: 'foo' },
        { userId: 2, isManager: false },
      );
      const viewerItem = viewer.songs[0] as Record<string, unknown>;
      expect(viewerItem.sheetMusicUrl).toBeUndefined();
      expect(viewerItem.sheetMusics).toBeUndefined();
    });

    it('getRandomSongsByChannelId — manager flatten, viewer strip', async () => {
      const song = makeSongWithSheet(1, 42, [
        { url: 'https://cdn/random.pdf', type: 'PDF', isPrimary: true },
      ]);
      const prisma = {
        song: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest
            .fn()
            // 1st call: id list for cache priming
            .mockResolvedValueOnce([{ id: 1 }])
            // 2nd call: hydrated detail
            .mockResolvedValueOnce([song]),
        },
        userSongLike: { findMany: jest.fn().mockResolvedValue([]) },
      } as unknown as PrismaService;

      const svc = new SongQueryService(prisma, makeCacheTracker());

      const mgr = await svc.getRandomSongsByChannelId(42, 1, [], {
        userId: 1,
        isManager: true,
      });
      const mgrItem = mgr.songs[0] as Record<string, unknown>;
      expect(mgrItem.sheetMusicUrl).toBe('https://cdn/random.pdf');
      expect(mgrItem.sheetMusicType).toBe('PDF');
      expect(mgrItem.sheetMusics).toBeUndefined();

      // Reset for viewer call (different id-list cache bucket due to role suffix)
      (prisma.song.findMany as jest.Mock)
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce([song]);

      const viewer = await svc.getRandomSongsByChannelId(42, 1, [], {
        userId: 2,
        isManager: false,
      });
      const viewerItem = viewer.songs[0] as Record<string, unknown>;
      expect(viewerItem.sheetMusicUrl).toBeUndefined();
      expect(viewerItem.sheetMusics).toBeUndefined();
    });

    it('getMyFavoriteSongsByChannel — manager flatten, viewer strip', async () => {
      const song = {
        ...makeSongWithSheet(1, 42, [
          { url: 'https://cdn/fav.pdf', type: 'PDF', isPrimary: true },
        ]),
        userLikes: [{ createdAt: new Date('2026-01-02T00:00:00Z') }],
      };
      const prisma = {
        song: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockResolvedValue([song]),
        },
        userSongLike: { findMany: jest.fn().mockResolvedValue([]) },
      } as unknown as PrismaService;

      const svc = new SongQueryService(prisma, makeCacheTracker());

      const mgr = await svc.getMyFavoriteSongsByChannel(
        7,
        42,
        { page: 1, limit: 20 },
        { userId: 7, isManager: true },
      );
      const mgrItem = mgr.songs[0] as Record<string, unknown>;
      expect(mgrItem.sheetMusicUrl).toBe('https://cdn/fav.pdf');
      expect(mgrItem.sheetMusicType).toBe('PDF');
      expect(mgrItem.sheetMusics).toBeUndefined();

      const viewer = await svc.getMyFavoriteSongsByChannel(
        7,
        42,
        { page: 1, limit: 20 },
        { userId: 7, isManager: false },
      );
      const viewerItem = viewer.songs[0] as Record<string, unknown>;
      expect(viewerItem.sheetMusicUrl).toBeUndefined();
      expect(viewerItem.sheetMusicType).toBeUndefined();
      expect(viewerItem.sheetMusics).toBeUndefined();
    });
  });
});
