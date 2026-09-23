import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GlobalSongMergeService } from '../global-song-merge.service';
import {
  AdminLocalSongMergeRequestDto,
  AdminSongChannelsResponseDto,
  AdminSongDetailResponseDto,
  AdminSongSiblingsResponseDto,
  AdminSongsListQueryDto,
  AdminSongsListResponseDto,
  AdminSongsMergeRequestDto,
} from './dto/admin-songs.dto';

@Injectable()
export class AdminSongsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly songMergeService: GlobalSongMergeService,
  ) {}

  async list(
    query: AdminSongsListQueryDto,
  ): Promise<AdminSongsListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 30;
    const search = query.search?.trim() ?? '';
    const artistSearch = query.artistSearch?.trim() ?? '';
    const sort = query.sort ?? 'channels_desc';
    const offset = (page - 1) * limit;

    const ands: Prisma.GlobalSongWhereInput[] = [];
    if (query.artistId) ands.push({ globalArtistId: query.artistId });
    if (search) {
      // 통합 검색: title / normTitle / artist canonicalName / artist normKey
      ands.push({
        OR: [
          { title: { contains: search } },
          { normTitle: { contains: search } },
          { globalArtist: { canonicalName: { contains: search } } },
          { globalArtist: { normKey: { contains: search } } },
        ],
      });
    }
    if (artistSearch) {
      ands.push({
        globalArtist: {
          OR: [
            { canonicalName: { contains: artistSearch } },
            { normKey: { contains: artistSearch } },
          ],
        },
      });
    }
    const where: Prisma.GlobalSongWhereInput =
      ands.length > 0 ? { AND: ands } : {};

    const orderBy: Prisma.GlobalSongOrderByWithRelationInput =
      sort === 'channels_asc'
        ? { channelCount: 'asc' }
        : sort === 'id_asc'
          ? { id: 'asc' }
          : sort === 'id_desc'
            ? { id: 'desc' }
            : sort === 'title_asc'
              ? { title: 'asc' }
              : { channelCount: 'desc' };

    const [items, total] = await Promise.all([
      this.prisma.globalSong.findMany({
        where,
        orderBy: [orderBy, { id: 'asc' }],
        skip: offset,
        take: limit,
        include: {
          globalArtist: { select: { canonicalName: true } },
        },
      }),
      this.prisma.globalSong.count({ where }),
    ]);

    return {
      data: items.map((i) => ({
        id: i.id,
        title: i.title,
        normTitle: i.normTitle,
        globalArtistId: i.globalArtistId,
        artistCanonicalName: i.globalArtist?.canonicalName ?? '',
        channelCount: i.channelCount,
      })),
      total,
      page,
      limit,
    };
  }

  async detail(id: number): Promise<AdminSongDetailResponseDto> {
    const song = await this.prisma.globalSong.findUnique({
      where: { id },
      include: {
        globalArtist: { select: { canonicalName: true, normKey: true } },
      },
    });
    if (!song) throw new NotFoundException(`song ${id} not found`);

    const [channelRows, crossArtistSiblings] = await Promise.all([
      this.prisma.song.findMany({
        where: { globalSongId: id },
        select: {
          id: true,
          title: true,
          channelId: true,
          channel: { select: { name: true } },
        },
        take: 30,
      }),
      this.prisma.globalSong.findMany({
        where: {
          normTitle: song.normTitle,
          NOT: { id },
        },
        select: {
          id: true,
          title: true,
          globalArtistId: true,
          channelCount: true,
          globalArtist: { select: { canonicalName: true } },
        },
        orderBy: { channelCount: 'desc' },
        take: 50,
      }),
    ]);

    return {
      id: song.id,
      title: song.title,
      normTitle: song.normTitle,
      globalArtistId: song.globalArtistId,
      artistCanonicalName: song.globalArtist?.canonicalName ?? '',
      artistNormKey: song.globalArtist?.normKey ?? '',
      channelCount: song.channelCount,
      channels: channelRows.map((s) => ({
        channelId: s.channelId,
        channelName: s.channel?.name ?? '',
        songId: s.id,
        songTitle: s.title,
      })),
      crossArtistSiblings: crossArtistSiblings.map((s) => ({
        id: s.id,
        title: s.title,
        globalArtistId: s.globalArtistId,
        artistCanonicalName: s.globalArtist?.canonicalName ?? '',
        channelCount: s.channelCount,
      })),
    };
  }

  async merge(body: AdminSongsMergeRequestDto) {
    return this.songMergeService.merge({
      winnerId: body.winnerId,
      loserIds: body.loserIds,
      reason: body.reason || 'admin manual song-merge',
      dryRun: body.dryRun ?? false,
    });
  }

  async localMerge(body: AdminLocalSongMergeRequestDto) {
    return this.songMergeService.absorbLocalDuplicateSongs({
      keepSongId: body.keepSongId,
      dropSongId: body.dropSongId,
      reason: body.reason || 'admin manual local song-merge',
    });
  }

  async listChannels(
    songId: number,
    page = 1,
    limit = 30,
  ): Promise<AdminSongChannelsResponseDto> {
    const exists = await this.prisma.globalSong.findUnique({
      where: { id: songId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(`song ${songId} not found`);

    const [rows, total] = await Promise.all([
      this.prisma.song.findMany({
        where: { globalSongId: songId },
        select: {
          id: true,
          title: true,
          channelId: true,
          channel: { select: { name: true } },
        },
        orderBy: { id: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.song.count({ where: { globalSongId: songId } }),
    ]);

    return {
      data: rows.map((s) => ({
        channelId: s.channelId,
        channelName: s.channel?.name ?? '',
        songId: s.id,
        songTitle: s.title,
      })),
      total,
      page,
      limit,
    };
  }

  async listSiblings(
    songId: number,
    page = 1,
    limit = 30,
  ): Promise<AdminSongSiblingsResponseDto> {
    const song = await this.prisma.globalSong.findUnique({
      where: { id: songId },
      select: { normTitle: true },
    });
    if (!song) throw new NotFoundException(`song ${songId} not found`);

    const where = { normTitle: song.normTitle, NOT: { id: songId } };
    const [rows, total] = await Promise.all([
      this.prisma.globalSong.findMany({
        where,
        select: {
          id: true,
          title: true,
          globalArtistId: true,
          channelCount: true,
          globalArtist: { select: { canonicalName: true } },
        },
        orderBy: [{ channelCount: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.globalSong.count({ where }),
    ]);

    return {
      data: rows.map((s) => ({
        id: s.id,
        title: s.title,
        globalArtistId: s.globalArtistId,
        artistCanonicalName: s.globalArtist?.canonicalName ?? '',
        channelCount: s.channelCount,
      })),
      total,
      page,
      limit,
    };
  }
}
