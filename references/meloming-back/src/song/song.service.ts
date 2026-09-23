import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelService } from '../channel/channel.service';
import {
  CreateSongDto,
  UpdateSongDto,
  BulkCreateSongDto,
} from './dto/song.dto';
import { ResourceNotFoundException } from '../common/exceptions/custom.exception';
import { SongAlbumArtService } from './song-album-art.service';
import type { SongsListResponse, SongDetailResponse } from './dto/song.dto';
import { sortSongCategories } from './utils/sort-song-categories';
import { SongQueryService } from './song-query.service';
import { SongMutationService } from './song-mutation.service';
import { PointsService } from '../points/points.service';
import { POINT_ACTIONS } from '../points/constants/point-actions';
import { buildPointReason } from '../points/utils/point-reason';
import { mapSongForViewer } from './song-mappers';

@Injectable()
export class SongService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channelService: ChannelService,
    private readonly albumArtService: SongAlbumArtService,
    private readonly songQueryService: SongQueryService,
    private readonly songMutationService: SongMutationService,
    private readonly points: PointsService,
  ) {}

  // 새로운 Channel 기반 메서드
  async getSongsByChannelId(
    channelId: number,
    query: any = {},
    viewer: { userId?: number; isManager: boolean } = { isManager: false },
  ): Promise<SongsListResponse> {
    return this.songQueryService.getSongsByChannelId(channelId, query, viewer);
  }

  // V2 - 다중 필터 지원
  async getSongsByChannelIdV2(
    channelId: number,
    query: any = {},
    viewer: { userId?: number; isManager: boolean } = { isManager: false },
  ): Promise<SongsListResponse> {
    return this.songQueryService.getSongsByChannelIdV2(
      channelId,
      query,
      viewer,
    );
  }

  async getSongsByWebPath(
    webPath: string,
    query: any = {},
    viewer: { userId?: number; isManager: boolean } = { isManager: false },
  ): Promise<SongsListResponse> {
    const channel = await this.channelService.findByWebPath(webPath);
    if (!channel) {
      throw new ResourceNotFoundException('음악북을 찾을 수 없습니다.');
    }
    return this.songQueryService.getSongsByChannelId(channel.id, query, viewer);
  }

  async getSongsByWebPathV2(
    webPath: string,
    query: any = {},
    viewer: { userId?: number; isManager: boolean } = { isManager: false },
  ): Promise<SongsListResponse> {
    const channel = await this.channelService.findByWebPath(webPath);
    if (!channel) {
      throw new ResourceNotFoundException('음악북을 찾을 수 없습니다.');
    }
    return this.songQueryService.getSongsByChannelIdV2(
      channel.id,
      query,
      viewer,
    );
  }

  async searchSongs(
    query: any = {},
    viewer: { userId?: number; isManager: boolean } = { isManager: false },
  ): Promise<SongsListResponse> {
    return this.songQueryService.searchSongs(query, viewer);
  }

  // channelId와 songId로 특정 노래 조회
  async getSongByChannelId(
    channelId: number,
    songId: number,
    viewer: { userId?: number; isManager: boolean } = { isManager: false },
  ): Promise<SongDetailResponse> {
    const song = await this.prisma.song.findFirst({
      where: {
        id: songId,
        channelId: channelId,
      },
      include: {
        artist: true,
        songCategories: {
          include: {
            category: true,
          },
        },
        channel: {
          select: {
            id: true,
            name: true,
            webPath: true,
            themeColor: true,
          },
        },
      },
    });

    if (!song) {
      throw new ResourceNotFoundException(
        '해당 채널에서 노래를 찾을 수 없습니다.',
      );
    }

    // 즐겨찾기 수 조회
    const totalFavorites = await this.prisma.userSongLike.count({
      where: { songId: song.id },
    });

    // Preserve author-only lyrics for managers; strip them for other viewers.
    const shaped = mapSongForViewer(song, viewer, {
      exposeLyricsToManager: true,
    });

    return {
      ...shaped,
      totalFavorites,
      categories: sortSongCategories(song.songCategories),
      channel: song.channel,
    };
  }

  async getPublicSongById(
    webPath: string,
    songId: number,
    viewer: { userId?: number; isManager: boolean } = { isManager: false },
  ): Promise<SongDetailResponse> {
    // 먼저 음악북이 존재하는지 확인
    const channel = await this.channelService.findByWebPath(webPath);
    if (!channel) {
      throw new ResourceNotFoundException('음악북을 찾을 수 없습니다.');
    }

    // 해당 음악북의 노래인지 확인
    const song = await this.prisma.song.findFirst({
      where: {
        id: songId,
        channelId: channel.id,
      },
      include: {
        artist: true,
        songCategories: {
          include: {
            category: true,
          },
        },
        channel: {
          select: {
            id: true,
            name: true,
            webPath: true,
            themeColor: true,
          },
        },
      },
    });

    if (!song) {
      throw new ResourceNotFoundException('노래를 찾을 수 없습니다.');
    }

    // 즐겨찾기 수 조회
    const totalFavorites = await this.prisma.userSongLike.count({
      where: { songId: song.id },
    });

    const shaped = mapSongForViewer(song, viewer, {
      exposeLyricsToManager: true,
    });

    return {
      ...shaped,
      totalFavorites,
      categories: sortSongCategories(song.songCategories),
      channel: song.channel,
    };
  }

  private getKstDayBounds(now: Date = new Date()): {
    startUtc: Date;
    endUtc: Date;
  } {
    const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
    const kst = new Date(now.getTime() + KST_OFFSET_MS);
    kst.setHours(0, 0, 0, 0);
    const startUtc = new Date(kst.getTime() - KST_OFFSET_MS);
    const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
    return { startUtc, endUtc };
  }

  private async grantSongCreatePointsFor(
    userId: number,
    songIds: number[],
  ): Promise<void> {
    const { startUtc, endUtc } = this.getKstDayBounds();
    const todayCount = await this.prisma.pointTransaction.count({
      where: {
        userId,
        action: POINT_ACTIONS.SONG_CREATE,
        type: 'CREDIT',
        createdAt: { gte: startUtc, lt: endUtc },
      },
    });
    let remaining = Math.max(0, 10 - todayCount);
    for (const id of songIds) {
      if (remaining <= 0) break;
      try {
        const songData = await this.prisma.song.findUnique({
          where: { id },
          select: { title: true, channel: { select: { name: true } } },
        });
        await this.points.grant({
          userId,
          amount: 50,
          action: POINT_ACTIONS.SONG_CREATE,
          uniqueKey: `song:create:${id}`,
          reason: buildPointReason(POINT_ACTIONS.SONG_CREATE, {
            channelName: songData?.channel?.name ?? undefined,
            songTitle: songData?.title ?? undefined,
          }),
          referenceType: 'song',
          referenceId: String(id),
        });
        remaining -= 1;
      } catch {
        // ignore per-item failure
      }
    }
  }

  private async reverseSongCreatePointsIfExists(songId: number): Promise<void> {
    const tx = await this.prisma.pointTransaction.findFirst({
      where: {
        action: POINT_ACTIONS.SONG_CREATE,
        uniqueKey: `song:create:${songId}`,
      },
      select: { id: true, userId: true },
    });
    if (tx) {
      await this.points.reverse(tx.userId, String(tx.id), {
        allowNegative: true,
      });
    }
  }

  /** 고아 클립의 생성 포인트를 비동기로 회수한다 (best effort). */
  private revokeOrphanClipPoints(clipIds: number[]): void {
    if (clipIds.length === 0) return;
    this.prisma.pointTransaction
      .findMany({
        where: {
          uniqueKey: { in: clipIds.map((id) => `clip:create:${id}`) },
        },
        select: { id: true, userId: true },
      })
      .then((txs) =>
        Promise.allSettled(
          txs.map((tx) =>
            this.points.reverse(tx.userId, String(tx.id), {
              allowNegative: true,
            }),
          ),
        ),
      )
      .catch(() => {});
  }

  /** 노래 삭제 시 고아가 될 클립 수를 미리 조회 */
  async getOrphanClipCount(
    songIds: number[],
  ): Promise<{ orphanClipCount: number }> {
    const count = await this.songMutationService.getOrphanClipCount(songIds);
    return { orphanClipCount: count };
  }

  async createSongByChannelId(
    createSongDto: CreateSongDto,
    channelId: number,
    userId?: number,
  ) {
    const created = await this.songMutationService.createSongByChannelId(
      createSongDto,
      channelId,
    );
    if (userId) {
      try {
        await this.grantSongCreatePointsFor(userId, [created.id]);
      } catch {
        // ignore
      }
    }
    return created;
  }

  async bulkCreateSongsByChannelId(
    bulkDto: BulkCreateSongDto,
    channelId: number,
    userId?: number,
  ) {
    const result = await this.songMutationService.bulkCreateSongsByChannelId(
      bulkDto,
      channelId,
    );
    if (userId && result?.songs?.length) {
      try {
        const ids = result.songs.map((s) => s.id);
        await this.grantSongCreatePointsFor(userId, ids);
      } catch {
        // ignore
      }
    }
    return result;
  }

  // v2: 성능개선 버전 (캐싱 없음, 인덱스 친화 쿼리, 청크 처리)
  async bulkCreateSongsByChannelIdV2(
    bulkDto: BulkCreateSongDto,
    channelId: number,
    userId?: number,
  ) {
    const result = await this.songMutationService.bulkCreateSongsByChannelIdV2(
      bulkDto,
      channelId,
    );
    if (userId && result?.songs?.length) {
      try {
        const ids = result.songs.map((s) => s.id);
        await this.grantSongCreatePointsFor(userId, ids);
      } catch {
        // ignore
      }
    }
    return result;
  }

  // 앨범 아트 관련은 전담 서비스로 위임

  async updateSongByChannelId(
    songId: number,
    updateSongDto: UpdateSongDto,
    channelId: number,
  ) {
    return this.songMutationService.updateSongByChannelId(
      songId,
      updateSongDto,
      channelId,
    );
  }

  async deleteSongByChannelId(songId: number, channelId: number) {
    // reverse points for this song if previously granted
    try {
      await this.reverseSongCreatePointsIfExists(songId);
    } catch {
      // ignore
    }
    const result = await this.songMutationService.deleteSongByChannelId(
      songId,
      channelId,
    );
    this.revokeOrphanClipPoints(result.deletedClipIds);

    return {
      message: result.message,
      deletedClipCount: result.deletedClipIds.length,
    };
  }

  async bulkDeleteSongsByChannelId(
    ids: number[],
    channelId: number,
  ): Promise<{
    success: boolean;
    deletedCount: number;
    deletedClipCount: number;
  }> {
    try {
      await Promise.all(
        ids.map((id) =>
          this.reverseSongCreatePointsIfExists(id).catch(() => {}),
        ),
      );
    } catch {
      // ignore
    }
    const result = await this.songMutationService.bulkDeleteSongsByChannelId(
      ids,
      channelId,
    );
    this.revokeOrphanClipPoints(result.deletedClipIds);

    return {
      success: result.success,
      deletedCount: result.deletedCount,
      deletedClipCount: result.deletedClipIds.length,
    };
  }

  async bulkUpdateSongsByChannelId(
    songs: import('./dto/song.dto').BulkUpdateSongItemDto[],
    channelId: number,
  ): Promise<import('./dto/song.dto').BulkUpdateSongsResponseDto> {
    return this.songMutationService.bulkUpdateSongsByChannelId(
      songs,
      channelId,
    );
  }

  async searchAlbumArtFromDB(title: string, artist: string) {
    return this.albumArtService.searchAlbumArtFromDB(title, artist);
  }

  async bulkSearchAlbumArtFromDB(songs: { title: string; artist: string }[]) {
    return this.albumArtService.bulkSearchAlbumArtFromDB(songs);
  }

  async getRandomSongsByChannelId(
    channelId: number,
    count: number,
    categoryIds: number[] = [],
    viewer: { userId?: number; isManager: boolean } = { isManager: false },
  ): Promise<SongsListResponse> {
    return this.songQueryService.getRandomSongsByChannelId(
      channelId,
      count,
      categoryIds,
      viewer,
    );
  }

  async getRandomSongsByWebPath(
    webPath: string,
    count: number,
    categoryIds: number[] = [],
    viewer: { userId?: number; isManager: boolean } = { isManager: false },
  ): Promise<SongsListResponse> {
    const channel = await this.channelService.findByWebPath(webPath);
    if (!channel) {
      throw new ResourceNotFoundException('음악북을 찾을 수 없습니다.');
    }
    return this.songQueryService.getRandomSongsByChannelId(
      channel.id,
      count,
      categoryIds,
      viewer,
    );
  }

  async getMyFavoriteSongsByChannel(
    userId: number,
    channelId: number,
    query: { page?: number; limit?: number } = {},
    viewer: { userId?: number; isManager: boolean } = { isManager: false },
  ): Promise<SongsListResponse> {
    return this.songQueryService.getMyFavoriteSongsByChannel(
      userId,
      channelId,
      query,
      viewer,
    );
  }
}
