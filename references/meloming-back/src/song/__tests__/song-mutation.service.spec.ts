import type { EventEmitter2 } from '@nestjs/event-emitter';
import { SongMutationService } from '../song-mutation.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SongHelperService } from '../song-helper.service';
import type { SongAlbumArtService } from '../song-album-art.service';
import type { SongCacheService } from '../song-cache.service';
import { GLOBAL_SONG_EVENTS } from '../../global-song/dto/global-song.events';

/**
 * Round 2 C1/C2/C6 — SongMutationService no longer handles sheet music.
 *
 * Previously (Phase 1.6 + Round 1 C4), updateSongByChannelId interpreted
 * `sheetMusicUrl` + `sheetMusicType` in the PATCH DTO: both null to delete,
 * both set to replace, mixed-null rejected with sheet_music_partial_value,
 * key-partial rejected with sheet_music_partial_key.
 *
 * That entire code path has been removed. Sheet music is now managed via the
 * dedicated channel-scoped endpoint POST /songs/channel/:identifier/:songId/
 * sheet-music (see song-sheet-music.controller.ts + song-sheet-music.service
 * .ts). The DTO fields are kept ONLY for `forbidNonWhitelisted: true`
 * compatibility during the frontend migration; the service IGNORES them.
 *
 * This spec locks that contract:
 *   - Passing sheetMusicUrl/Type in PATCH triggers NO DB mutation on
 *     SongSheetMusic (no deleteMany, no create, no $transaction).
 *   - Other fields (title, etc.) still update normally.
 *   - No partial-key / partial-value rejection exists anymore — those
 *     errors belonged to the old in-service logic.
 */

type ExistingSong = {
  id: number;
  title: string;
  artistId: number;
  channelId: number;
  albumArt: string | null;
  artist: { name: string };
  songCategories: { category: { name: string } }[];
};

function buildExistingSong(
  songId: number,
  channelId: number,
  artistId = 7,
): ExistingSong {
  return {
    id: songId,
    title: '밤편지',
    artistId,
    channelId,
    albumArt: null,
    artist: { name: '아이유' },
    songCategories: [],
  };
}

function buildPrismaMock(opts: { existingSong: ExistingSong }) {
  const { existingSong } = opts;

  const tx = {
    songSheetMusic: {
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
  };

  const prisma = {
    song: {
      findFirst: jest.fn(async (args: { where: { id: number; channelId: number } }) => ({
        id: args.where.id,
        title: existingSong.title,
        artistId: existingSong.artistId,
        channelId: existingSong.channelId,
        albumArt: existingSong.albumArt,
        artist: { id: existingSong.artistId, name: '아이유' },
        songCategories: [],
        channel: {
          id: existingSong.channelId,
          name: 'ch',
          webPath: 'ch',
          themeColor: '#000',
        },
      })),
      update: jest.fn(async (args: { where: { id: number }; data: any }) => ({
        id: args.where.id,
        title: args.data.title ?? existingSong.title,
        artistId: existingSong.artistId,
        channelId: existingSong.channelId,
        albumArt: existingSong.albumArt,
      })),
    },
    songSheetMusic: {
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
    songCategory: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    artist: {
      findUnique: jest.fn().mockResolvedValue({ name: '아이유' }),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    userSongLike: {
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  } as unknown as PrismaService & { __tx: typeof tx };

  (prisma as any).__tx = tx;
  return prisma as PrismaService & { __tx: typeof tx };
}

function buildService(prisma: PrismaService) {
  const songHelper = {
    validateArtistIdByChannel: jest.fn().mockResolvedValue(undefined),
    validateCategoryIdsByChannel: jest.fn().mockResolvedValue(undefined),
    createNewCategoriesByChannel: jest.fn().mockResolvedValue([]),
  } as unknown as SongHelperService;
  const albumArt = {
    sanitizeAlbumArtUrl: jest.fn((v: any) => v),
    processAlbumArt: jest.fn(),
  } as unknown as SongAlbumArtService;
  const cache = {
    clearChannelSongCaches: jest.fn().mockResolvedValue(undefined),
  } as unknown as SongCacheService;
  const events = { emit: jest.fn() } as unknown as EventEmitter2;
  const service = new SongMutationService(prisma, songHelper, albumArt, cache, events);
  return { service, cache };
}

describe('SongMutationService — sheet music fields are ignored in PATCH (Round 2)', () => {
  const channelId = 42;
  const songId = 101;

  it('does NOT touch SongSheetMusic when only title is updated', async () => {
    const prisma = buildPrismaMock({
      existingSong: buildExistingSong(songId, channelId),
    });
    const { service } = buildService(prisma);

    await service.updateSongByChannelId(
      songId,
      { title: '새 제목' } as any,
      channelId,
    );

    const tx = (prisma as any).__tx;
    expect(tx.songSheetMusic.deleteMany).not.toHaveBeenCalled();
    expect(tx.songSheetMusic.create).not.toHaveBeenCalled();
    expect((prisma as any).songSheetMusic.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('IGNORES sheetMusicUrl + sheetMusicType in PATCH (no DB mutation)', async () => {
    const prisma = buildPrismaMock({
      existingSong: buildExistingSong(songId, channelId),
    });
    const { service } = buildService(prisma);

    await service.updateSongByChannelId(
      songId,
      {
        sheetMusicUrl: 'https://cdn.test/sheet/a.pdf',
        sheetMusicType: 'PDF',
      } as any,
      channelId,
    );

    const tx = (prisma as any).__tx;
    expect(tx.songSheetMusic.deleteMany).not.toHaveBeenCalled();
    expect(tx.songSheetMusic.create).not.toHaveBeenCalled();
    expect((prisma as any).songSheetMusic.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('IGNORES sheetMusicUrl=null + sheetMusicType=null in PATCH', async () => {
    const prisma = buildPrismaMock({
      existingSong: buildExistingSong(songId, channelId),
    });
    const { service } = buildService(prisma);

    await service.updateSongByChannelId(
      songId,
      { sheetMusicUrl: null, sheetMusicType: null } as any,
      channelId,
    );

    const tx = (prisma as any).__tx;
    expect(tx.songSheetMusic.deleteMany).not.toHaveBeenCalled();
    expect(tx.songSheetMusic.create).not.toHaveBeenCalled();
    expect((prisma as any).songSheetMusic.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does NOT reject key-only sheetMusicUrl (old sheet_music_partial_key semantic removed)', async () => {
    const prisma = buildPrismaMock({
      existingSong: buildExistingSong(songId, channelId),
    });
    const { service } = buildService(prisma);

    // Previously this would throw BadRequestException with
    // code 'sheet_music_partial_key'. Now it's a no-op.
    await expect(
      service.updateSongByChannelId(
        songId,
        { sheetMusicUrl: 'https://cdn.test/sheet/a.pdf' } as any,
        channelId,
      ),
    ).resolves.toBeDefined();

    const tx = (prisma as any).__tx;
    expect(tx.songSheetMusic.deleteMany).not.toHaveBeenCalled();
    expect(tx.songSheetMusic.create).not.toHaveBeenCalled();
  });

  it('does NOT reject mixed-null (old sheet_music_partial_value semantic removed)', async () => {
    const prisma = buildPrismaMock({
      existingSong: buildExistingSong(songId, channelId),
    });
    const { service } = buildService(prisma);

    // Previously mixed-null threw sheet_music_partial_value. Now it's a no-op.
    await expect(
      service.updateSongByChannelId(
        songId,
        { sheetMusicUrl: null, sheetMusicType: 'PDF' } as any,
        channelId,
      ),
    ).resolves.toBeDefined();

    const tx = (prisma as any).__tx;
    expect(tx.songSheetMusic.deleteMany).not.toHaveBeenCalled();
    expect(tx.songSheetMusic.create).not.toHaveBeenCalled();
  });

  it('still invalidates channel song caches after any PATCH (even when only sheet music fields sent)', async () => {
    // Ignoring the fields means the endpoint still hits the normal update
    // flow. Cache invalidation must still fire so viewers see fresh data
    // from other PATCH calls (title/artist/etc.). This also ensures sheet
    // music writes via the new endpoint — which separately invalidates —
    // don't get shadowed by a stale PATCH cache.
    const prisma = buildPrismaMock({
      existingSong: buildExistingSong(songId, channelId),
    });
    const { service, cache } = buildService(prisma);

    await service.updateSongByChannelId(
      songId,
      { sheetMusicUrl: null, sheetMusicType: null } as any,
      channelId,
    );

    expect(cache.clearChannelSongCaches).toHaveBeenCalledWith(channelId);
  });
});

/**
 * 엑셀 일괄 등록(bulk V1/V2)이 단건 등록과 동일하게 GlobalSong 인덱싱을
 * 트리거하도록, emitBulkSongCreatedEvents helper 가 단건 path 와 동일한
 * SONG_CREATED payload 를 곡마다 emit 하는지 검증한다. 전체 bulk 흐름은
 * 기존 동작이라, 이번 변경의 계약(payload 동등성 / chunk 분할 / 부분 실패
 * 격리 / 빈 배열)만 helper 단위로 격리 테스트한다.
 */
describe('SongMutationService — bulk GlobalSong 인덱싱 이벤트 emit', () => {
  const channelId = 42;

  function buildServiceForEmit() {
    const emit = jest.fn();
    const findMany = jest.fn();
    const prisma = { song: { findMany } } as unknown as PrismaService;
    const service = new SongMutationService(
      prisma,
      {} as unknown as SongHelperService,
      {} as unknown as SongAlbumArtService,
      {} as unknown as SongCacheService,
      { emit } as unknown as EventEmitter2,
    );
    return { service, emit, findMany };
  }

  function rowsFor(ids: number[]) {
    return ids.map((id) => ({
      id,
      title: `t${id}`,
      artistId: 7,
      albumArt: id % 2 === 0 ? `art${id}` : null,
      artist: { name: '아이유' },
      songCategories: [
        { category: { name: '발라드' } },
        { category: { name: 'K-POP' } },
      ],
    }));
  }

  function callEmit(service: SongMutationService, ids: number[]) {
    return (
      service as unknown as {
        emitBulkSongCreatedEvents: (c: number, i: number[]) => Promise<void>;
      }
    ).emitBulkSongCreatedEvents(channelId, ids);
  }

  it('단건 등록과 동일한 SONG_CREATED payload 로 곡마다 emit', async () => {
    const { service, emit, findMany } = buildServiceForEmit();
    findMany.mockResolvedValue(rowsFor([10, 11]));

    await callEmit(service, [10, 11]);

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith(GLOBAL_SONG_EVENTS.SONG_CREATED, {
      song: { id: 10, title: 't10', artistId: 7, channelId, albumArt: 'art10' },
      artistName: '아이유',
      channelId,
      categoryNames: ['발라드', 'K-POP'],
    });
    expect(emit).toHaveBeenCalledWith(GLOBAL_SONG_EVENTS.SONG_CREATED, {
      song: { id: 11, title: 't11', artistId: 7, channelId, albumArt: null },
      artistName: '아이유',
      channelId,
      categoryNames: ['발라드', 'K-POP'],
    });
  });

  it('200곡 초과 시 chunk(200) 단위로 findMany 를 분할 호출', async () => {
    const { service, findMany } = buildServiceForEmit();
    const ids = Array.from({ length: 250 }, (_, i) => i + 1);
    findMany.mockImplementation(
      async ({ where }: { where: { id: { in: number[] } } }) =>
        rowsFor(where.id.in),
    );

    await callEmit(service, ids);

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[0][0].where.id.in).toHaveLength(200);
    expect(findMany.mock.calls[1][0].where.id.in).toHaveLength(50);
  });

  it('한 chunk 의 lookup 이 실패해도 나머지 chunk 는 emit 하고 throw 하지 않음', async () => {
    const { service, emit, findMany } = buildServiceForEmit();
    const ids = Array.from({ length: 250 }, (_, i) => i + 1);
    findMany
      .mockRejectedValueOnce(new Error('DB hiccup'))
      .mockImplementationOnce(
        async ({ where }: { where: { id: { in: number[] } } }) =>
          rowsFor(where.id.in),
      );

    await expect(callEmit(service, ids)).resolves.toBeUndefined();

    // 첫 chunk(200) 는 실패로 skip, 두 번째 chunk(50) 만 emit
    expect(emit).toHaveBeenCalledTimes(50);
  });

  it('빈 id 배열이면 findMany/emit 를 호출하지 않음', async () => {
    const { service, emit, findMany } = buildServiceForEmit();
    await callEmit(service, []);
    expect(findMany).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});
