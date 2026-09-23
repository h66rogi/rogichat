import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GlobalArtistMergeService } from '../global-artist-merge.service';
import {
  AdminArtistDetailResponseDto,
  AdminArtistsListQueryDto,
  AdminArtistsListResponseDto,
  AdminArtistsMergeRequestDto,
} from './dto/admin-artists.dto';

@Injectable()
export class AdminArtistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly artistMergeService: GlobalArtistMergeService,
  ) {}

  async list(
    query: AdminArtistsListQueryDto,
  ): Promise<AdminArtistsListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 30;
    const search = query.search?.trim() ?? '';
    const sort = query.sort ?? 'songs_desc';
    const offset = (page - 1) * limit;

    const where: Prisma.GlobalArtistWhereInput = search
      ? {
          OR: [
            { canonicalName: { contains: search } },
            { normKey: { contains: search } },
          ],
        }
      : {};

    // We need song counts to sort by, so do a count(*) per artist via raw SQL
    // when sorting by songs. For other sorts, we order by Prisma directly and
    // batch-count. Either way, paginate after the cheap filter.
    if (sort === 'songs_desc' || sort === 'songs_asc') {
      const direction =
        sort === 'songs_desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
      const searchClause = search
        ? Prisma.sql`WHERE ga.canonical_name LIKE ${'%' + search + '%'} OR ga.norm_key LIKE ${'%' + search + '%'}`
        : Prisma.empty;
      const rows = await this.prisma.$queryRaw<
        Array<{
          id: number;
          canonical_name: string;
          norm_key: string;
          song_count: bigint;
        }>
      >`
        SELECT ga.id, ga.canonical_name, ga.norm_key,
          (SELECT COUNT(*) FROM global_songs WHERE global_artist_id = ga.id) AS song_count
        FROM global_artists ga
        ${searchClause}
        ORDER BY song_count ${direction}, ga.id ASC
        LIMIT ${limit} OFFSET ${offset}
      `;
      const totalRows = await this.prisma.globalArtist.count({ where });
      return {
        data: rows.map((r) => ({
          id: r.id,
          canonicalName: r.canonical_name,
          normKey: r.norm_key,
          songCount: Number(r.song_count),
        })),
        total: totalRows,
        page,
        limit,
      };
    }

    const orderBy: Prisma.GlobalArtistOrderByWithRelationInput =
      sort === 'id_asc'
        ? { id: 'asc' }
        : sort === 'id_desc'
          ? { id: 'desc' }
          : sort === 'name_asc'
            ? { canonicalName: 'asc' }
            : { id: 'desc' };

    const [items, total] = await Promise.all([
      this.prisma.globalArtist.findMany({
        where,
        orderBy,
        skip: offset,
        take: limit,
      }),
      this.prisma.globalArtist.count({ where }),
    ]);

    const counts = await this.prisma.globalSong.groupBy({
      by: ['globalArtistId'],
      where: { globalArtistId: { in: items.map((i) => i.id) } },
      _count: { _all: true },
    });
    const countMap = new Map(
      counts.map((c) => [c.globalArtistId, c._count._all]),
    );

    return {
      data: items.map((i) => ({
        id: i.id,
        canonicalName: i.canonicalName,
        normKey: i.normKey,
        songCount: countMap.get(i.id) ?? 0,
      })),
      total,
      page,
      limit,
    };
  }

  async detail(id: number): Promise<AdminArtistDetailResponseDto> {
    const artist = await this.prisma.globalArtist.findUnique({
      where: { id },
      select: { id: true, canonicalName: true, normKey: true },
    });
    if (!artist) throw new NotFoundException(`artist ${id} not found`);

    const [songCount, sampleSongs, siblings] = await Promise.all([
      this.prisma.globalSong.count({ where: { globalArtistId: id } }),
      this.prisma.globalSong.findMany({
        where: { globalArtistId: id },
        select: { id: true, title: true, normTitle: true, channelCount: true },
        orderBy: { channelCount: 'desc' },
        take: 30,
      }),
      this.prisma.globalArtist.findMany({
        where: {
          canonicalName: artist.canonicalName,
          NOT: { id },
        },
        select: { id: true, normKey: true },
      }),
    ]);

    const siblingCounts =
      siblings.length === 0
        ? []
        : await this.prisma.globalSong.groupBy({
            by: ['globalArtistId'],
            where: { globalArtistId: { in: siblings.map((s) => s.id) } },
            _count: { _all: true },
          });
    const sibCountMap = new Map(
      siblingCounts.map((c) => [c.globalArtistId, c._count._all]),
    );

    return {
      id: artist.id,
      canonicalName: artist.canonicalName,
      normKey: artist.normKey,
      songCount,
      sampleSongs,
      siblings: siblings.map((s) => ({
        id: s.id,
        normKey: s.normKey,
        songCount: sibCountMap.get(s.id) ?? 0,
      })),
    };
  }

  async merge(body: AdminArtistsMergeRequestDto) {
    return this.artistMergeService.merge({
      winnerId: body.winnerId,
      loserIds: body.loserIds,
      reason: body.reason || 'admin manual artist-merge',
      dryRun: body.dryRun ?? false,
    });
  }

  async listSongs(
    artistId: number,
    page = 1,
    limit = 30,
  ): Promise<{
    data: Array<{
      id: number;
      title: string;
      normTitle: string;
      channelCount: number;
    }>;
    total: number;
    page: number;
    limit: number;
  }> {
    const exists = await this.prisma.globalArtist.findUnique({
      where: { id: artistId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(`artist ${artistId} not found`);

    const [data, total] = await Promise.all([
      this.prisma.globalSong.findMany({
        where: { globalArtistId: artistId },
        select: { id: true, title: true, normTitle: true, channelCount: true },
        orderBy: [{ channelCount: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.globalSong.count({ where: { globalArtistId: artistId } }),
    ]);

    return { data, total, page, limit };
  }
}
