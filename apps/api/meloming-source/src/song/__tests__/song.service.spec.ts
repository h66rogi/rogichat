import { SongService } from '../song.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ChannelService } from '../../channel/channel.service';
import type { SongAlbumArtService } from '../song-album-art.service';
import type { SongQueryService } from '../song-query.service';
import type { SongMutationService } from '../song-mutation.service';
import type { PointsService } from '../../points/points.service';

/**
 * Round 3 C5 — Single-song endpoints (getSongByChannelId / getPublicSongById)
 * must pass responses through the permission-aware mapSongForViewer helper.
 *
 * Before the fix:
 *   - `lyricsText` (author-only memo) leaked to anonymous viewers and to any
 *     authenticated non-manager viewer.
 *   - `sheetMusicUrl` / `sheetMusicType` never appeared — even for managers —
 *     because the Prisma query didn't `include: { sheetMusics }` and nothing
 *     flattened them.
 *
 * After the fix:
 *   - Manager: keeps lyricsText, strips raw `sheetMusics` relation, flattens
 *     `sheetMusicUrl` / `sheetMusicType` (null when no primary exists).
 *   - Non-manager (authenticated or anonymous): strips lyricsText AND
 *     sheetMusicUrl/Type AND raw sheetMusics relation.
 */

type SheetMusicRow = {
  songId: number;
  url: string;
  type: string;
  isPrimary: boolean;
};

function makeSongRow(opts: {
  id: number;
  channelId: number;
  lyricsText: string | null;
  sheetMusics: SheetMusicRow[];
}) {
  return {
    id: opts.id,
    title: `song-${opts.id}`,
    artistId: 1,
    channelId: opts.channelId,
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
    lyricsText: opts.lyricsText,
    description: null,
    price: null,
    currencyPrices: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    artist: { id: 1, name: 'a' },
    songCategories: [],
    channel: {
      id: opts.channelId,
      name: 'ch',
      webPath: 'ch',
      themeColor: '#000',
    },
    sheetMusics: opts.sheetMusics,
  };
}

function buildService(prismaOverrides: {
  findFirstResult: any;
  userSongLikeCount?: number;
}) {
  const prisma = {
    song: {
      findFirst: jest.fn().mockResolvedValue(prismaOverrides.findFirstResult),
    },
    userSongLike: {
      count: jest.fn().mockResolvedValue(prismaOverrides.userSongLikeCount ?? 0),
    },
  } as unknown as PrismaService;

  const channelService = {
    findByWebPath: jest.fn().mockResolvedValue({ id: 42 }),
  } as unknown as ChannelService;

  const albumArtService = {} as unknown as SongAlbumArtService;
  const songQueryService = {} as unknown as SongQueryService;
  const songMutationService = {} as unknown as SongMutationService;
  const points = {} as unknown as PointsService;

  const service = new SongService(
    prisma,
    channelService,
    albumArtService,
    songQueryService,
    songMutationService,
    points,
  );
  return { service, prisma, channelService };
}

describe('SongService — getSongByChannelId permission-aware mapper (Round 3 C5)', () => {
  it('manager response flattens sheetMusicUrl/Type, strips raw sheetMusics relation, keeps lyricsText', async () => {
    const row = makeSongRow({
      id: 101,
      channelId: 42,
      lyricsText: 'private author memo',
      sheetMusics: [
        { songId: 101, url: 'https://cdn/primary.pdf', type: 'PDF', isPrimary: true },
      ],
    });
    const { service } = buildService({ findFirstResult: row });

    const result = (await service.getSongByChannelId(42, 101, {
      userId: 7,
      isManager: true,
    })) as any;

    expect(result.sheetMusicUrl).toBe('https://cdn/primary.pdf');
    expect(result.sheetMusicType).toBe('PDF');
    // raw 1:N relation must not leak
    expect(result.sheetMusics).toBeUndefined();
    // manager keeps the author-only memo on single-song endpoints
    expect(result.lyricsText).toBe('private author memo');
  });

  it('non-manager (authenticated) response excludes lyricsText AND sheetMusicUrl/Type AND raw sheetMusics', async () => {
    const row = makeSongRow({
      id: 101,
      channelId: 42,
      lyricsText: 'private author memo',
      sheetMusics: [
        { songId: 101, url: 'https://cdn/primary.pdf', type: 'PDF', isPrimary: true },
      ],
    });
    const { service } = buildService({ findFirstResult: row });

    const result = (await service.getSongByChannelId(42, 101, {
      userId: 999,
      isManager: false,
    })) as any;

    expect(result.lyricsText).toBeUndefined();
    expect(result.sheetMusicUrl).toBeUndefined();
    expect(result.sheetMusicType).toBeUndefined();
    expect(result.sheetMusics).toBeUndefined();
  });

  it('anonymous (no viewer passed) response excludes lyricsText AND sheet fields — default isManager=false', async () => {
    const row = makeSongRow({
      id: 101,
      channelId: 42,
      lyricsText: 'private author memo',
      sheetMusics: [
        { songId: 101, url: 'https://cdn/primary.pdf', type: 'PDF', isPrimary: true },
      ],
    });
    const { service } = buildService({ findFirstResult: row });

    // No viewer argument — default `{ isManager: false }` applies.
    const result = (await service.getSongByChannelId(42, 101)) as any;

    expect(result.lyricsText).toBeUndefined();
    expect(result.sheetMusicUrl).toBeUndefined();
    expect(result.sheetMusicType).toBeUndefined();
    expect(result.sheetMusics).toBeUndefined();
  });

  it('manager response with no sheet music returns null (not undefined) for both sheet fields', async () => {
    const row = makeSongRow({
      id: 101,
      channelId: 42,
      lyricsText: null,
      sheetMusics: [],
    });
    const { service } = buildService({ findFirstResult: row });

    const result = (await service.getSongByChannelId(42, 101, {
      userId: 7,
      isManager: true,
    })) as any;

    expect(result).toHaveProperty('sheetMusicUrl', null);
    expect(result).toHaveProperty('sheetMusicType', null);
    expect(result.sheetMusics).toBeUndefined();
  });

  it('includes sheetMusics filter (where isPrimary=true) in the Prisma include shape', async () => {
    const row = makeSongRow({
      id: 101,
      channelId: 42,
      lyricsText: null,
      sheetMusics: [],
    });
    const { service, prisma } = buildService({ findFirstResult: row });

    await service.getSongByChannelId(42, 101, { userId: 7, isManager: true });

    const findFirstCall = (prisma.song.findFirst as jest.Mock).mock.calls[0]?.[0];
    expect(findFirstCall?.include?.sheetMusics).toEqual({
      where: { isPrimary: true },
    });
  });
});

describe('SongService — getPublicSongById permission-aware mapper (Round 3 C5)', () => {
  it('manager response flattens sheetMusicUrl/Type, strips raw sheetMusics, keeps lyricsText', async () => {
    const row = makeSongRow({
      id: 202,
      channelId: 42,
      lyricsText: 'manager-only memo',
      sheetMusics: [
        { songId: 202, url: 'https://cdn/p.pdf', type: 'PDF', isPrimary: true },
      ],
    });
    const { service } = buildService({ findFirstResult: row });

    const result = (await service.getPublicSongById('ch', 202, {
      userId: 7,
      isManager: true,
    })) as any;

    expect(result.sheetMusicUrl).toBe('https://cdn/p.pdf');
    expect(result.sheetMusicType).toBe('PDF');
    expect(result.sheetMusics).toBeUndefined();
    expect(result.lyricsText).toBe('manager-only memo');
  });

  it('non-manager response excludes lyricsText AND sheet fields', async () => {
    const row = makeSongRow({
      id: 202,
      channelId: 42,
      lyricsText: 'manager-only memo',
      sheetMusics: [
        { songId: 202, url: 'https://cdn/p.pdf', type: 'PDF', isPrimary: true },
      ],
    });
    const { service } = buildService({ findFirstResult: row });

    const result = (await service.getPublicSongById('ch', 202, {
      userId: 999,
      isManager: false,
    })) as any;

    expect(result.lyricsText).toBeUndefined();
    expect(result.sheetMusicUrl).toBeUndefined();
    expect(result.sheetMusicType).toBeUndefined();
    expect(result.sheetMusics).toBeUndefined();
  });

  it('anonymous (no viewer) — default isManager=false strips everything author-only', async () => {
    const row = makeSongRow({
      id: 202,
      channelId: 42,
      lyricsText: 'memo',
      sheetMusics: [
        { songId: 202, url: 'https://cdn/p.pdf', type: 'PDF', isPrimary: true },
      ],
    });
    const { service } = buildService({ findFirstResult: row });

    const result = (await service.getPublicSongById('ch', 202)) as any;

    expect(result.lyricsText).toBeUndefined();
    expect(result.sheetMusicUrl).toBeUndefined();
    expect(result.sheetMusicType).toBeUndefined();
    expect(result.sheetMusics).toBeUndefined();
  });

  it('manager response with no sheet music returns null fields', async () => {
    const row = makeSongRow({
      id: 202,
      channelId: 42,
      lyricsText: null,
      sheetMusics: [],
    });
    const { service } = buildService({ findFirstResult: row });

    const result = (await service.getPublicSongById('ch', 202, {
      userId: 7,
      isManager: true,
    })) as any;

    expect(result).toHaveProperty('sheetMusicUrl', null);
    expect(result).toHaveProperty('sheetMusicType', null);
    expect(result.sheetMusics).toBeUndefined();
  });

  it('includes sheetMusics filter (where isPrimary=true) in the Prisma include shape', async () => {
    const row = makeSongRow({
      id: 202,
      channelId: 42,
      lyricsText: null,
      sheetMusics: [],
    });
    const { service, prisma } = buildService({ findFirstResult: row });

    await service.getPublicSongById('ch', 202, { userId: 7, isManager: true });

    const findFirstCall = (prisma.song.findFirst as jest.Mock).mock.calls[0]?.[0];
    expect(findFirstCall?.include?.sheetMusics).toEqual({
      where: { isPrimary: true },
    });
  });
});
