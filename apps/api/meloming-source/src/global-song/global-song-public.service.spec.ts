import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  GlobalSongPublicService,
  encodeCursor,
} from './global-song-public.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { GlobalSongRedisService } from './global-song-redis.service';
import type { LiveStatusService } from '../live-status/live-status.service';
import type { GlobalSongMergeService } from './global-song-merge.service';
import type { GlobalSongClipCursorPayload } from './dto/global-song-clips.dto';

/* -------------------------------------------------------------------------- */
/*  Test doubles                                                               */
/* -------------------------------------------------------------------------- */

type RawRow = { id: number; viewCount: number; createdAt: Date };

function createService(overrides: {
  globalSong?: Partial<{
    findUnique: jest.Mock;
    findMany: jest.Mock;
  }>;
  channel?: Partial<{ findMany: jest.Mock }>;
  song?: Partial<{ findMany: jest.Mock }>;
  clip?: Partial<{ findMany: jest.Mock }>;
  $queryRaw?: jest.Mock;
  redis?: Partial<GlobalSongRedisService>;
  live?: Partial<LiveStatusService>;
  mergeService?: Partial<GlobalSongMergeService>;
}) {
  const prisma = {
    globalSong: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      ...(overrides.globalSong ?? {}),
    },
    channel: {
      findMany: jest.fn().mockResolvedValue([]),
      ...(overrides.channel ?? {}),
    },
    song: {
      findMany: jest.fn().mockResolvedValue([]),
      ...(overrides.song ?? {}),
    },
    clip: {
      findMany: jest.fn().mockResolvedValue([]),
      ...(overrides.clip ?? {}),
    },
    $queryRaw: overrides.$queryRaw ?? jest.fn().mockResolvedValue([]),
  } as unknown as PrismaService;

  const redis = {
    isReady: jest.fn().mockReturnValue(false),
    getChannelSongMappingAll: jest.fn().mockResolvedValue(null),
    ...(overrides.redis ?? {}),
  } as unknown as GlobalSongRedisService;

  const live = {
    getLiveStatuses: jest.fn().mockResolvedValue([]),
    ...(overrides.live ?? {}),
  } as unknown as LiveStatusService;

  const mergeService = {
    resolveMerged: jest
      .fn()
      .mockImplementation(async (id: number) => ({
        canonicalId: id,
        mergedFrom: null,
      })),
    ...(overrides.mergeService ?? {}),
  } as unknown as GlobalSongMergeService;

  return {
    svc: new GlobalSongPublicService(prisma, redis, live, mergeService),
    prisma,
    redis,
    live,
    mergeService,
  };
}

/* -------------------------------------------------------------------------- */
/*  getDetail                                                                  */
/* -------------------------------------------------------------------------- */

describe('GlobalSongPublicService.getDetail', () => {
  it('throws NotFoundException when the global song does not exist', async () => {
    const { svc } = createService({
      globalSong: { findUnique: jest.fn().mockResolvedValue(null) },
    });

    await expect(svc.getDetail(999)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('filters inactive channels + computes channelCount from filtered list', async () => {
    const globalSongFindUnique = jest.fn().mockResolvedValue({
      id: 42,
      title: '밤편지',
      albumArt: 'https://img/art.jpg',
      channelCount: 99, // stale DB counter — should NOT leak into response
      globalArtist: { id: 7, canonicalName: '아이유' },
    });
    // Redis returns 3 channels — Channel.findMany will drop one (inactive).
    const redis = {
      isReady: jest.fn().mockReturnValue(true),
      getChannelSongMappingAll: jest
        .fn()
        .mockResolvedValue({ '1': '10', '2': '20', '3': '30' }),
    };
    const channelFindMany = jest.fn().mockResolvedValue([
      {
        id: 1,
        name: 'A',
        profileImageUrl: 'a.png',
        verifications: [{ platform: 'CHZZK' }],
        _count: { userFavorites: 1000 },
      },
      {
        id: 2,
        name: 'B',
        profileImageUrl: null,
        verifications: [],
        _count: { userFavorites: 500 },
      },
      // Channel 3 dropped because it's not PUBLIC
    ]);
    const clipCountQuery = jest.fn().mockResolvedValue([{ cnt: 7 }]);

    const { svc } = createService({
      globalSong: { findUnique: globalSongFindUnique },
      channel: { findMany: channelFindMany },
      $queryRaw: clipCountQuery,
      redis,
    });

    const result = await svc.getDetail(42);

    expect(result.id).toBe(42);
    expect(result.title).toBe('밤편지');
    expect(result.artist).toEqual({ id: 7, name: '아이유' });
    expect(result.albumArt).toBe('https://img/art.jpg');
    // channelCount comes from the filtered active list, NOT the stale DB counter.
    expect(result.channelCount).toBe(2);
    expect(result.clipCount).toBe(7);
    expect(result.channels).toHaveLength(2);
    expect(result.channels[0].platform).toBe('CHZZK');
    expect(result.channels[1].platform).toBe('OTHER'); // no verification → OTHER
  });

  it('orders channels: isLive DESC → followerCount DESC → id ASC', async () => {
    const redis = {
      isReady: jest.fn().mockReturnValue(true),
      getChannelSongMappingAll: jest
        .fn()
        .mockResolvedValue({ '1': '10', '2': '20', '3': '30', '4': '40' }),
    };
    const channelFindMany = jest.fn().mockResolvedValue([
      {
        id: 1,
        name: 'Offline-low',
        profileImageUrl: null,
        verifications: [{ platform: 'CHZZK' }],
        _count: { userFavorites: 100 },
      },
      {
        id: 2,
        name: 'Live-low',
        profileImageUrl: null,
        verifications: [{ platform: 'SOOP' }],
        _count: { userFavorites: 50 },
      },
      {
        id: 3,
        name: 'Offline-high',
        profileImageUrl: null,
        verifications: [{ platform: 'CHZZK' }],
        _count: { userFavorites: 999 },
      },
      {
        id: 4,
        name: 'Live-high',
        profileImageUrl: null,
        verifications: [{ platform: 'SOOP' }],
        _count: { userFavorites: 800 },
      },
    ]);
    const live = {
      // Channels 2 and 4 are live.
      getLiveStatuses: jest.fn().mockResolvedValue([
        { channelId: 2, liveStatuses: [{ title: 'stream' }] },
        { channelId: 4, liveStatuses: [{ title: 'stream' }] },
      ]),
    };
    const { svc } = createService({
      globalSong: {
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          title: 'T',
          albumArt: null,
          channelCount: 4,
          globalArtist: { id: 1, canonicalName: 'A' },
        }),
      },
      channel: { findMany: channelFindMany },
      $queryRaw: jest.fn().mockResolvedValue([{ cnt: 0 }]),
      redis,
      live,
    });

    const result = await svc.getDetail(1);

    const orderIds = result.channels.map((c) => c.id);
    // Expected: Live-high (4), Live-low (2), Offline-high (3), Offline-low (1)
    expect(orderIds).toEqual([4, 2, 3, 1]);
    expect(result.channels[0].isLive).toBe(true);
    expect(result.channels[1].isLive).toBe(true);
    expect(result.channels[2].isLive).toBe(false);
    expect(result.channels[3].isLive).toBe(false);
  });

  it('treats all channels as offline when live-status gRPC fails', async () => {
    const { svc } = createService({
      globalSong: {
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          title: 'T',
          albumArt: null,
          channelCount: 1,
          globalArtist: { id: 1, canonicalName: 'A' },
        }),
      },
      channel: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            name: 'C',
            profileImageUrl: null,
            verifications: [],
            _count: { userFavorites: 0 },
          },
        ]),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ cnt: 0 }]),
      redis: {
        isReady: jest.fn().mockReturnValue(true),
        getChannelSongMappingAll: jest.fn().mockResolvedValue({ '1': '10' }),
      },
      live: {
        getLiveStatuses: jest.fn().mockRejectedValue(new Error('gRPC down')),
      },
    });

    const result = await svc.getDetail(1);
    expect(result.channels[0].isLive).toBe(false);
  });

  it('clip count raw SQL filters by ch.visibility = PUBLIC (Codex final review fix)', async () => {
    // countClipsForGlobalSong must only count clips with at least one PUBLIC
    // ClipChannel — otherwise Stage A in getClips would exclude clips but the
    // count would still include them (visibility leak via count delta).
    const clipCountQuery = jest.fn().mockResolvedValue([{ cnt: 0 }]);
    const { svc } = createService({
      globalSong: {
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          title: 'T',
          albumArt: null,
          channelCount: 0,
          globalArtist: { id: 1, canonicalName: 'A' },
        }),
      },
      channel: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: clipCountQuery,
      redis: {
        isReady: jest.fn().mockReturnValue(true),
        getChannelSongMappingAll: jest.fn().mockResolvedValue({}),
      },
    });

    await svc.getDetail(1);

    expect(clipCountQuery).toHaveBeenCalled();
    const templateStrings = clipCountQuery.mock.calls[0][0] as ReadonlyArray<string>;
    const reconstructed = templateStrings.join(' ');
    expect(reconstructed).toMatch(/JOIN channels ch ON cc\.channel_id = ch\.id/);
    expect(reconstructed).toMatch(/ch\.visibility = 'PUBLIC'/);
  });

  it('surfaces spotifyTrackId from the GlobalSong row', async () => {
    const { svc } = createService({
      globalSong: {
        findUnique: jest.fn().mockResolvedValue({
          id: 42,
          title: 'T',
          albumArt: null,
          channelCount: 0,
          spotifyTrackId: '3P3UA61WRQqwCXaoFOTENd',
          globalArtist: { id: 7, canonicalName: '아이유' },
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ cnt: 0 }]),
      redis: {
        isReady: jest.fn().mockReturnValue(true),
        getChannelSongMappingAll: jest.fn().mockResolvedValue({}),
      },
    });

    const result = await svc.getDetail(42);

    expect(result.spotifyTrackId).toBe('3P3UA61WRQqwCXaoFOTENd');
  });

  it('passes null spotifyTrackId through unchanged when the matcher has no entry', async () => {
    const { svc } = createService({
      globalSong: {
        findUnique: jest.fn().mockResolvedValue({
          id: 42,
          title: 'T',
          albumArt: null,
          channelCount: 0,
          spotifyTrackId: null,
          globalArtist: { id: 7, canonicalName: '아이유' },
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ cnt: 0 }]),
      redis: {
        isReady: jest.fn().mockReturnValue(true),
        getChannelSongMappingAll: jest.fn().mockResolvedValue({}),
      },
    });

    const result = await svc.getDetail(42);

    expect(result.spotifyTrackId).toBeNull();
  });

  it('falls back to Song.globalSongId when Redis is not ready', async () => {
    const songFindMany = jest
      .fn()
      .mockResolvedValue([{ channelId: 11 }, { channelId: 22 }]);
    const { svc, prisma } = createService({
      globalSong: {
        findUnique: jest.fn().mockResolvedValue({
          id: 5,
          title: 'T',
          albumArt: null,
          channelCount: 2,
          globalArtist: { id: 1, canonicalName: 'A' },
        }),
      },
      song: { findMany: songFindMany },
      channel: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 11,
            name: 'A',
            profileImageUrl: null,
            verifications: [],
            _count: { userFavorites: 0 },
          },
        ]),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ cnt: 0 }]),
      redis: {
        isReady: jest.fn().mockReturnValue(false),
      },
    });

    const result = await svc.getDetail(5);
    expect(songFindMany).toHaveBeenCalledWith({
      where: { globalSongId: 5 },
      select: { channelId: true },
      distinct: ['channelId'],
    });
    expect(result.channels).toHaveLength(1);
    // Channel table is queried with the IDs pulled from Song fallback.
    const channelCall = (prisma.channel.findMany as jest.Mock).mock.calls[0][0];
    expect(channelCall.where.id).toEqual({ in: [11, 22] });
  });
});

/* -------------------------------------------------------------------------- */
/*  getClips                                                                   */
/* -------------------------------------------------------------------------- */

describe('GlobalSongPublicService.getClips', () => {
  it('throws NotFoundException for unknown globalSongId', async () => {
    const { svc } = createService({
      globalSong: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      svc.getClips(99, { sort: 'popular', limit: 20 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns empty page + null nextCursor when there are no clips', async () => {
    const { svc } = createService({
      globalSong: {
        findUnique: jest.fn().mockResolvedValue({ id: 1 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      clip: { findMany: jest.fn().mockResolvedValue([]) },
    });

    const result = await svc.getClips(1, { sort: 'popular', limit: 20 });
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it('popular sort preserves Stage A order + sets nextCursor when hasMore', async () => {
    // limit=2, Stage A returns 3 rows (limit+1 sentinel).
    const stageA: RawRow[] = [
      { id: 10, viewCount: 500, createdAt: new Date('2026-04-01T00:00:00Z') },
      { id: 20, viewCount: 200, createdAt: new Date('2026-04-02T00:00:00Z') },
      { id: 30, viewCount: 0, createdAt: new Date('2026-04-03T00:00:00Z') },
    ];
    const stageB = [
      {
        id: 10,
        title: 'Clip 10',
        thumbnailUrl: null,
        duration: 60,
        platform: 'YOUTUBE',
        createdAt: stageA[0].createdAt,
        stat: { viewCount: 500 },
        clipChannels: [
          {
            isPrimary: true,
            channel: { id: 1, name: 'Ch1', profileImageUrl: null },
          },
        ],
      },
      {
        id: 20,
        title: 'Clip 20',
        thumbnailUrl: 't.jpg',
        duration: null,
        platform: 'SOOP',
        createdAt: stageA[1].createdAt,
        stat: { viewCount: 200 },
        clipChannels: [
          {
            isPrimary: true,
            channel: { id: 2, name: 'Ch2', profileImageUrl: 'p.png' },
          },
        ],
      },
      {
        id: 30,
        title: 'Clip 30',
        thumbnailUrl: null,
        duration: 90,
        platform: 'CHZZK',
        createdAt: stageA[2].createdAt,
        stat: null, // ClipStat row absent → viewCount defaults to 0
        clipChannels: [
          {
            isPrimary: true,
            channel: { id: 3, name: 'Ch3', profileImageUrl: null },
          },
        ],
      },
    ];
    // Jest mock returns rows in a non-deterministic order — the service must
    // re-sort to match Stage A order.
    const { svc } = createService({
      globalSong: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
      $queryRaw: jest.fn().mockResolvedValue(stageA),
      clip: {
        findMany: jest
          .fn()
          .mockResolvedValue([stageB[2], stageB[0], stageB[1]]),
      },
    });

    const result = await svc.getClips(1, { sort: 'popular', limit: 2 });

    // limit=2 + sentinel=3 → keep first 2, set nextCursor from LAST of kept.
    expect(result.items).toHaveLength(2);
    expect(result.items.map((i) => i.id)).toEqual([10, 20]);
    expect(result.items[0].viewCount).toBe(500);
    expect(result.items[1].channel.profileImage).toBe('p.png');
    expect(result.nextCursor).not.toBeNull();

    // Decoded cursor should carry {sort:'popular', viewCount:200, id:20}
    const decoded = JSON.parse(
      Buffer.from(result.nextCursor!, 'base64url').toString('utf8'),
    );
    expect(decoded).toEqual({ sort: 'popular', viewCount: 200, id: 20 });
  });

  it('clips with no ClipStat row end up with viewCount = 0', async () => {
    const stageA: RawRow[] = [
      { id: 1, viewCount: 0, createdAt: new Date('2026-04-01') },
    ];
    const { svc } = createService({
      globalSong: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
      $queryRaw: jest.fn().mockResolvedValue(stageA),
      clip: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            title: 'Clip',
            thumbnailUrl: null,
            duration: null,
            platform: 'YOUTUBE',
            createdAt: stageA[0].createdAt,
            stat: null,
            clipChannels: [
              {
                isPrimary: true,
                channel: { id: 10, name: 'X', profileImageUrl: null },
              },
            ],
          },
        ]),
      },
    });

    const result = await svc.getClips(1, { sort: 'popular', limit: 20 });
    expect(result.items[0].viewCount).toBe(0);
  });

  it('recent sort returns items ordered by Stage A createdAt', async () => {
    const stageA: RawRow[] = [
      { id: 3, viewCount: 0, createdAt: new Date('2026-04-03T00:00:00Z') },
      { id: 1, viewCount: 100, createdAt: new Date('2026-04-01T00:00:00Z') },
    ];
    const { svc, prisma } = createService({
      globalSong: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
      $queryRaw: jest.fn().mockResolvedValue(stageA),
      clip: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            title: 'Old',
            thumbnailUrl: null,
            duration: null,
            platform: 'YOUTUBE',
            createdAt: stageA[1].createdAt,
            stat: { viewCount: 100 },
            clipChannels: [
              {
                isPrimary: true,
                channel: { id: 10, name: 'X', profileImageUrl: null },
              },
            ],
          },
          {
            id: 3,
            title: 'New',
            thumbnailUrl: null,
            duration: null,
            platform: 'YOUTUBE',
            createdAt: stageA[0].createdAt,
            stat: { viewCount: 0 },
            clipChannels: [
              {
                isPrimary: true,
                channel: { id: 30, name: 'Y', profileImageUrl: null },
              },
            ],
          },
        ]),
      },
    });

    const result = await svc.getClips(1, { sort: 'recent', limit: 20 });
    expect(result.items.map((i) => i.id)).toEqual([3, 1]);
    // Raw SQL was called once (recent first page, no cursor).
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('silently ignores cursor whose sort does not match the query sort', async () => {
    const stageA: RawRow[] = [
      { id: 10, viewCount: 500, createdAt: new Date('2026-04-01T00:00:00Z') },
    ];
    const queryRaw = jest.fn().mockResolvedValue(stageA);
    const { svc } = createService({
      globalSong: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
      $queryRaw: queryRaw,
      clip: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 10,
            title: 'X',
            thumbnailUrl: null,
            duration: null,
            platform: 'YOUTUBE',
            createdAt: stageA[0].createdAt,
            stat: { viewCount: 500 },
            clipChannels: [
              {
                isPrimary: true,
                channel: { id: 1, name: 'A', profileImageUrl: null },
              },
            ],
          },
        ]),
      },
    });

    const mismatchedCursor = encodeCursor<GlobalSongClipCursorPayload>({
      sort: 'recent',
      createdAt: '2026-04-01T00:00:00Z',
      id: 1,
    });

    const result = await svc.getClips(1, {
      sort: 'popular',
      cursor: mismatchedCursor,
      limit: 20,
    });

    // Should return results (cursor was IGNORED, not a bad request).
    expect(result.items).toHaveLength(1);
  });

  it('throws BadRequestException on malformed (non-base64) cursor', async () => {
    const { svc } = createService({
      globalSong: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
    });

    await expect(
      svc.getClips(1, {
        sort: 'popular',
        cursor: 'not_base64_json!!',
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException when decoded cursor is missing sort field', async () => {
    const { svc } = createService({
      globalSong: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
    });

    // Well-formed base64 JSON but no `sort` tag — structurally invalid.
    const cursorNoSort = Buffer.from(
      JSON.stringify({ viewCount: 100, id: 5 }),
      'utf8',
    ).toString('base64url');

    await expect(
      svc.getClips(1, {
        sort: 'popular',
        cursor: cursorNoSort,
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException when decoded cursor sort value is not popular|recent', async () => {
    const { svc } = createService({
      globalSong: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
    });

    const cursorBadSort = Buffer.from(
      JSON.stringify({ sort: 'bogus', id: 1 }),
      'utf8',
    ).toString('base64url');

    await expect(
      svc.getClips(1, {
        sort: 'popular',
        cursor: cursorBadSort,
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws on popular cursor with non-number viewCount', async () => {
    const { svc } = createService({
      globalSong: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
    });

    // Structurally well-formed (correct `sort` tag) but viewCount is a
    // string — would flow into raw SQL and cause MySQL implicit conversion.
    const cursor = encodeCursor({
      sort: 'popular',
      viewCount: 'abc',
      id: 5,
    } as unknown as GlobalSongClipCursorPayload);

    await expect(
      svc.getClips(1, { sort: 'popular', cursor, limit: 20 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws on popular cursor with non-number id', async () => {
    const { svc } = createService({
      globalSong: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
    });

    const cursor = encodeCursor({
      sort: 'popular',
      viewCount: 100,
      id: 'xyz',
    } as unknown as GlobalSongClipCursorPayload);

    await expect(
      svc.getClips(1, { sort: 'popular', cursor, limit: 20 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws on recent cursor with non-string createdAt', async () => {
    const { svc } = createService({
      globalSong: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
    });

    const cursor = encodeCursor({
      sort: 'recent',
      createdAt: 12345,
      id: 5,
    } as unknown as GlobalSongClipCursorPayload);

    await expect(
      svc.getClips(1, { sort: 'recent', cursor, limit: 20 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws on recent cursor with invalid Date string in createdAt', async () => {
    const { svc } = createService({
      globalSong: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
    });

    // Well-formed JSON + string, but Date.parse returns NaN.
    const cursor = encodeCursor<GlobalSongClipCursorPayload>({
      sort: 'recent',
      createdAt: 'not-a-date',
      id: 5,
    });

    await expect(
      svc.getClips(1, { sort: 'recent', cursor, limit: 20 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  /* -------------------------------------------------------------------- */
  /*  Channel visibility filter (Codex final review fix)                   */
  /* -------------------------------------------------------------------- */

  it('Stage A raw SQL joins channels and filters ch.visibility = PUBLIC', async () => {
    // The raw SQL for Stage A must restrict cc.channel_id to PUBLIC channels
    // so clips whose only link to this GlobalSong is a PRIVATE/UNLISTED
    // channel are excluded at ordering/DISTINCT time (visibility leak fix).
    const queryRaw = jest.fn().mockResolvedValue([]);
    const { svc } = createService({
      globalSong: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
      $queryRaw: queryRaw,
    });

    await svc.getClips(1, { sort: 'popular', limit: 20 });

    // Tagged-template $queryRaw calls receive (strings, ...values).
    // Reconstruct the raw SQL by joining the template strings.
    expect(queryRaw).toHaveBeenCalled();
    const args = queryRaw.mock.calls[0];
    const templateStrings = args[0] as ReadonlyArray<string>;
    const reconstructed = templateStrings.join(' ');
    expect(reconstructed).toMatch(/JOIN channels ch ON cc\.channel_id = ch\.id/);
    expect(reconstructed).toMatch(/ch\.visibility = 'PUBLIC'/);
  });

  it('Stage A recent sort SQL also carries the visibility filter', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const { svc } = createService({
      globalSong: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
      $queryRaw: queryRaw,
    });

    await svc.getClips(1, { sort: 'recent', limit: 20 });

    const templateStrings = queryRaw.mock.calls[0][0] as ReadonlyArray<string>;
    const reconstructed = templateStrings.join(' ');
    expect(reconstructed).toMatch(/JOIN channels ch ON cc\.channel_id = ch\.id/);
    expect(reconstructed).toMatch(/ch\.visibility = 'PUBLIC'/);
  });

  it('Stage B passes visibility = PUBLIC filter to clipChannels nested where', async () => {
    const stageA: RawRow[] = [
      { id: 10, viewCount: 0, createdAt: new Date('2026-04-01') },
    ];
    const clipFindMany = jest.fn().mockResolvedValue([
      {
        id: 10,
        title: 'Clip',
        thumbnailUrl: null,
        duration: null,
        platform: 'YOUTUBE',
        createdAt: stageA[0].createdAt,
        stat: null,
        clipChannels: [
          {
            isPrimary: true,
            channel: { id: 1, name: 'Ch1', profileImageUrl: null },
          },
        ],
      },
    ]);
    const { svc } = createService({
      globalSong: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
      $queryRaw: jest.fn().mockResolvedValue(stageA),
      clip: { findMany: clipFindMany },
    });

    await svc.getClips(1, { sort: 'popular', limit: 20 });

    const args = clipFindMany.mock.calls[0][0];
    expect(args.select.clipChannels.where).toEqual({
      channel: { visibility: 'PUBLIC' },
    });
  });

  it('uses PUBLIC ClipChannel as primary when the Prisma-level primary is PRIVATE', async () => {
    // Simulate the post-filter reality: the Prisma query has already dropped
    // PRIVATE ClipChannels via the nested where, so the service receives only
    // the remaining PUBLIC rows. The service should surface the first PUBLIC
    // one as the displayed channel — even though its isPrimary is false.
    const stageA: RawRow[] = [
      { id: 10, viewCount: 0, createdAt: new Date('2026-04-01') },
    ];
    const { svc } = createService({
      globalSong: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
      $queryRaw: jest.fn().mockResolvedValue(stageA),
      clip: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 10,
            title: 'Clip',
            thumbnailUrl: null,
            duration: null,
            platform: 'YOUTUBE',
            createdAt: stageA[0].createdAt,
            stat: null,
            // PRIVATE-primary was filtered out by Prisma's nested where.
            // Only the secondary PUBLIC channel remains.
            clipChannels: [
              {
                isPrimary: false,
                channel: {
                  id: 222,
                  name: 'PublicSecondary',
                  profileImageUrl: 'p.png',
                },
              },
            ],
          },
        ]),
      },
    });

    const result = await svc.getClips(1, { sort: 'popular', limit: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].channel).toEqual({
      id: 222,
      name: 'PublicSecondary',
      profileImage: 'p.png',
    });
  });

  it('skips clips whose ClipChannels array is empty after visibility filter', async () => {
    // If all ClipChannels for a clip are PRIVATE, the Prisma query returns
    // an empty clipChannels array. The service must skip such clips rather
    // than surface them with a missing channel.
    const stageA: RawRow[] = [
      { id: 10, viewCount: 0, createdAt: new Date('2026-04-01') },
      { id: 20, viewCount: 0, createdAt: new Date('2026-04-02') },
    ];
    const { svc } = createService({
      globalSong: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
      $queryRaw: jest.fn().mockResolvedValue(stageA),
      clip: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 10,
            title: 'NoPublicChannels',
            thumbnailUrl: null,
            duration: null,
            platform: 'YOUTUBE',
            createdAt: stageA[0].createdAt,
            stat: null,
            clipChannels: [], // all dropped by visibility filter
          },
          {
            id: 20,
            title: 'HasPublicChannel',
            thumbnailUrl: null,
            duration: null,
            platform: 'YOUTUBE',
            createdAt: stageA[1].createdAt,
            stat: null,
            clipChannels: [
              {
                isPrimary: true,
                channel: { id: 5, name: 'Pub', profileImageUrl: null },
              },
            ],
          },
        ]),
      },
    });

    const result = await svc.getClips(1, { sort: 'popular', limit: 20 });
    expect(result.items.map((i) => i.id)).toEqual([20]);
  });
});

/* -------------------------------------------------------------------------- */
/*  getByArtist                                                                */
/* -------------------------------------------------------------------------- */

describe('GlobalSongPublicService.getByArtist', () => {
  it('returns empty items when the global song does not exist', async () => {
    const { svc } = createService({
      globalSong: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    const result = await svc.getByArtist(99, 10);
    expect(result.items).toEqual([]);
  });

  it('returns sibling songs of the same artist, excluding self, ordered by channelCount Desc', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValue({ globalArtistId: 7 });
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 11,
        title: '좋은 날',
        albumArt: 'a.jpg',
        channelCount: 80,
        globalArtist: { id: 7, canonicalName: '아이유' },
      },
      {
        id: 22,
        title: '내 손을 잡아',
        albumArt: null,
        channelCount: 30,
        globalArtist: { id: 7, canonicalName: '아이유' },
      },
    ]);
    const { svc } = createService({
      globalSong: { findUnique, findMany },
    });

    const result = await svc.getByArtist(42, 10);

    expect(result.items).toEqual([
      {
        id: 11,
        title: '좋은 날',
        artist: { id: 7, name: '아이유' },
        albumArt: 'a.jpg',
        channelCount: 80,
      },
      {
        id: 22,
        title: '내 손을 잡아',
        artist: { id: 7, name: '아이유' },
        albumArt: null,
        channelCount: 30,
      },
    ]);

    // self exclusion + active filter + ordering must be applied at the SQL level
    const where = findMany.mock.calls[0][0].where;
    expect(where.globalArtistId).toBe(7);
    expect(where.id).toEqual({ not: 42 });
    expect(where.channelCount).toEqual({ gt: 0 });
    expect(findMany.mock.calls[0][0].orderBy).toEqual([
      { channelCount: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('clamps limit into [1, 50]', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { svc } = createService({
      globalSong: {
        findUnique: jest.fn().mockResolvedValue({ globalArtistId: 1 }),
        findMany,
      },
    });

    await svc.getByArtist(1, 9999);
    expect(findMany.mock.calls[0][0].take).toBe(50);

    findMany.mockClear();
    await svc.getByArtist(1, -5);
    expect(findMany.mock.calls[0][0].take).toBe(1);
  });

  it('falls back to default limit 10 when limit is 0/NaN', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { svc } = createService({
      globalSong: {
        findUnique: jest.fn().mockResolvedValue({ globalArtistId: 1 }),
        findMany,
      },
    });

    await svc.getByArtist(1, 0);
    expect(findMany.mock.calls[0][0].take).toBe(10);
  });

  it('resolves merged-loser ids to the canonical winner', async () => {
    const resolveMerged = jest
      .fn()
      .mockResolvedValue({ canonicalId: 100, mergedFrom: 42 });
    const findUnique = jest
      .fn()
      .mockResolvedValue({ globalArtistId: 9 });
    const findMany = jest.fn().mockResolvedValue([]);
    const { svc } = createService({
      globalSong: { findUnique, findMany },
      mergeService: { resolveMerged },
    });

    await svc.getByArtist(42, 10);

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 100 },
      select: { globalArtistId: true },
    });
    expect(findMany.mock.calls[0][0].where.id).toEqual({ not: 100 });
  });
});

/* -------------------------------------------------------------------------- */
/*  getMyRegistrations                                                         */
/* -------------------------------------------------------------------------- */

describe('GlobalSongPublicService.getMyRegistrations', () => {
  it('returns empty registeredChannelIds when the caller has no channels', async () => {
    const channelFindMany = jest.fn().mockResolvedValue([]);
    const songFindMany = jest.fn();
    const { svc } = createService({
      channel: { findMany: channelFindMany },
      song: { findMany: songFindMany },
    });

    const result = await svc.getMyRegistrations(42, 100);

    expect(result.registeredChannelIds).toEqual([]);
    expect(result.globalSongId).toBe(42);
    expect(result.mergedFrom).toBeNull();
    // No song lookup when there are no channels — saves a query.
    expect(songFindMany).not.toHaveBeenCalled();
  });

  it('returns distinct channel ids of the caller that have the song', async () => {
    const channelFindMany = jest
      .fn()
      .mockResolvedValue([{ id: 11 }, { id: 22 }, { id: 33 }]);
    const songFindMany = jest
      .fn()
      .mockResolvedValue([{ channelId: 11 }, { channelId: 33 }]);
    const { svc } = createService({
      channel: { findMany: channelFindMany },
      song: { findMany: songFindMany },
    });

    const result = await svc.getMyRegistrations(42, 100);

    expect(result.registeredChannelIds).toEqual([11, 33]);

    // Channel resolver covers both owner (userId) AND manager
    const channelWhere = channelFindMany.mock.calls[0][0].where;
    expect(channelWhere.OR).toEqual([
      { userId: 100 },
      { managers: { some: { userId: 100, isActive: true } } },
    ]);

    // Song lookup is restricted to the caller's channels + the resolved id
    const songWhere = songFindMany.mock.calls[0][0].where;
    expect(songWhere.globalSongId).toBe(42);
    expect(songWhere.channelId).toEqual({ in: [11, 22, 33] });
    expect(songFindMany.mock.calls[0][0].distinct).toEqual(['channelId']);
  });

  it('resolves merged-loser ids to the canonical winner and surfaces mergedFrom', async () => {
    const resolveMerged = jest
      .fn()
      .mockResolvedValue({ canonicalId: 100, mergedFrom: 42 });
    const channelFindMany = jest.fn().mockResolvedValue([{ id: 1 }]);
    const songFindMany = jest.fn().mockResolvedValue([]);
    const { svc } = createService({
      channel: { findMany: channelFindMany },
      song: { findMany: songFindMany },
      mergeService: { resolveMerged },
    });

    const result = await svc.getMyRegistrations(42, 1);

    expect(result.globalSongId).toBe(100);
    expect(result.mergedFrom).toBe(42);
    expect(songFindMany.mock.calls[0][0].where.globalSongId).toBe(100);
  });
});

/* -------------------------------------------------------------------------- */
/*  search                                                                     */
/* -------------------------------------------------------------------------- */

describe('GlobalSongPublicService.search', () => {
  it('returns empty page when no songs match', async () => {
    const { svc } = createService({
      globalSong: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    const result = await svc.search({ q: 'xyz-nope', limit: 20 });
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it('applies channelCount > 0 filter + returns expected shape', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 1,
        title: '밤편지',
        albumArt: null,
        channelCount: 50,
        globalArtist: { id: 7, canonicalName: '아이유' },
      },
    ]);
    const { svc } = createService({
      globalSong: { findMany },
    });

    const result = await svc.search({ q: '밤편지', limit: 20 });

    expect(result.items).toEqual([
      {
        id: 1,
        title: '밤편지',
        artist: { id: 7, name: '아이유' },
        albumArt: null,
        channelCount: 50,
      },
    ]);
    // channelCount > 0 MUST be part of the where clause.
    const args = findMany.mock.calls[0][0];
    expect(args.where.channelCount).toEqual({ gt: 0 });
    // Orders by channelCount DESC, id DESC
    expect(args.orderBy).toEqual([
      { channelCount: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('sets nextCursor when result exceeds limit', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 1,
        title: 'A',
        albumArt: null,
        channelCount: 10,
        globalArtist: { id: 1, canonicalName: 'X' },
      },
      {
        id: 2,
        title: 'B',
        albumArt: null,
        channelCount: 5,
        globalArtist: { id: 1, canonicalName: 'X' },
      },
      // Sentinel triggering hasMore=true
      {
        id: 3,
        title: 'C',
        albumArt: null,
        channelCount: 1,
        globalArtist: { id: 1, canonicalName: 'X' },
      },
    ]);
    const { svc } = createService({ globalSong: { findMany } });

    const result = await svc.search({ q: 'x', limit: 2 });
    expect(result.items.map((i) => i.id)).toEqual([1, 2]);
    expect(result.nextCursor).not.toBeNull();
    // Cursor MUST be the LAST kept item, not the sentinel.
    const decoded = JSON.parse(
      Buffer.from(result.nextCursor!, 'base64url').toString('utf8'),
    );
    expect(decoded).toEqual({ channelCount: 5, id: 2 });
  });

  it('throws BadRequestException on malformed cursor', async () => {
    const { svc } = createService({ globalSong: {} });
    await expect(
      svc.search({ q: 'x', limit: 20, cursor: 'not_base64_json!!' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a well-formed cursor and applies keyset pagination', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { svc } = createService({ globalSong: { findMany } });

    const cursor = Buffer.from(
      JSON.stringify({ channelCount: 5, id: 100 }),
      'utf8',
    ).toString('base64url');

    await svc.search({ q: 'x', limit: 20, cursor });

    const args = findMany.mock.calls[0][0];
    expect(args.where.AND).toBeDefined();
  });
});
