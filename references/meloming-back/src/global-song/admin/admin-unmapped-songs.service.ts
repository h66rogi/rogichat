import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GlobalSongRedisService } from '../global-song-redis.service';
import { CacheKeyTrackingService } from '../../redis/cache-key-tracking.service';
import {
  AdminUnmappedLinkResponseDto,
  AdminUnmappedSongsListQueryDto,
  AdminUnmappedSongsListResponseDto,
} from './dto/admin-unmapped.dto';

/**
 * Admin 화면 — songs.global_song_id 가 NULL 인 (= GlobalSong 매칭 안 된)
 * 곡을 검토 + 수동 GlobalSong 으로 연결.
 *
 * 일별 reconciliation cron 이 자동 매칭을 돌리지만, 잔여 unmapped 는
 * fuzzy 가 안 잡거나 LLM 도 ABSTAIN 한 케이스. admin 이 직접 매칭.
 */
@Injectable()
export class AdminUnmappedSongsService {
  private readonly logger = new Logger(AdminUnmappedSongsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: GlobalSongRedisService,
    private readonly cacheTracker: CacheKeyTrackingService,
  ) {}

  async list(
    query: AdminUnmappedSongsListQueryDto,
  ): Promise<AdminUnmappedSongsListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 30;
    const search = query.search?.trim() ?? '';
    const offset = (page - 1) * limit;

    const where: Prisma.SongWhereInput = {
      globalSongId: null,
      ...(search
        ? {
            OR: [
              { title: { contains: search } },
              { artist: { name: { contains: search } } },
              { channel: { name: { contains: search } } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.song.findMany({
        where,
        select: {
          id: true,
          title: true,
          channelId: true,
          createdAt: true,
          artist: { select: { name: true } },
          channel: { select: { name: true } },
        },
        orderBy: { id: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.song.count({ where }),
    ]);

    return {
      data: items.map((s) => ({
        id: s.id,
        title: s.title,
        artistName: s.artist?.name ?? '',
        channelId: s.channelId,
        channelName: s.channel?.name ?? '',
        createdAt: (s.createdAt ?? new Date()).toISOString(),
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * Manually link a Song to an existing GlobalSong.
   *
   * 동일 로직: UnmappedSongReconciliationService.applyMatch() 에 channelCount
   * 재계산 추가. 동시 writer 가 먼저 잡으면 alreadyLinked=true 로 반환.
   */
  async link(
    songId: number,
    globalSongId: number,
  ): Promise<AdminUnmappedLinkResponseDto> {
    const song = await this.prisma.song.findUnique({
      where: { id: songId },
      select: { id: true, channelId: true, globalSongId: true },
    });
    if (!song) throw new NotFoundException(`song ${songId} not found`);
    if (song.globalSongId !== null) {
      throw new ConflictException(
        `song ${songId} already linked to globalSong ${song.globalSongId}`,
      );
    }

    const globalSong = await this.prisma.globalSong.findUnique({
      where: { id: globalSongId },
      select: { id: true },
    });
    if (!globalSong) {
      throw new NotFoundException(`globalSong ${globalSongId} not found`);
    }

    // (channelId, globalSongId) unique 제약(unique_songs_channel_globalsong):
    // 한 채널은 같은 글로벌곡에 둘 이상의 song 을 가질 수 없다. 이 채널에 이미
    // 해당 글로벌곡으로 매핑된 song 이 있으면 이 곡은 채널 내 중복곡이라 link
    // 불가 — 제약 위반은 500 이 아니라 409 로, 충돌 대상 song 을 알린다.
    const conflicting = await this.prisma.song.findFirst({
      where: { channelId: song.channelId, globalSongId },
      select: { id: true },
    });
    if (conflicting) {
      throw new ConflictException(
        `channel ${song.channelId} already has song ${conflicting.id} linked to globalSong ${globalSongId}`,
      );
    }

    // Race-safe FK update. 사전 체크와 이 update 사이 동시 writer 가 같은
    // 글로벌곡을 매핑하면 같은 unique 제약을 위반하므로 P2002 도 409 로 변환.
    let updated: Prisma.BatchPayload;
    try {
      updated = await this.prisma.song.updateMany({
        where: { id: songId, globalSongId: null },
        data: { globalSongId },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `channel ${song.channelId} already has a song linked to globalSong ${globalSongId}`,
        );
      }
      throw error;
    }
    const alreadyLinked = updated.count === 0;

    if (!alreadyLinked) {
      try {
        await this.redis.setChannelSongMapping(
          globalSongId,
          song.channelId,
          songId,
        );
        await this.redis.addToChannelSongSet(song.channelId, globalSongId);
      } catch (error) {
        this.logger.warn(
          `Redis sync failed after link songId=${songId} → globalSongId=${globalSongId}: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }

    // Recount channelCount from truth.
    const recount = await this.prisma.$queryRaw<{ c: bigint }[]>`
      SELECT COUNT(DISTINCT channel_id) AS c
      FROM songs
      WHERE global_song_id = ${globalSongId}
    `;
    const newCount = Number(recount[0]?.c ?? 0);
    await this.prisma.globalSong.update({
      where: { id: globalSongId },
      data: { channelCount: newCount },
    });

    // song.globalSongId 변경 → song list 응답의 globalSongId 영향. 채널 SET 회수.
    if (!alreadyLinked) {
      await this.cacheTracker.clearChannelSafe(
        song.channelId,
        'admin:linkUnmappedSong',
      );
    }

    return {
      songId,
      globalSongId,
      alreadyLinked,
      winnerChannelCountAfter: newCount,
    };
  }
}
