import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelService } from '../channel/channel.service';
import { CreateArtistDto, UpdateArtistDto } from './dto/artist.request.dto';
import { artistCacheKeys } from './cache/artist.cache-keys';
import { artistListQuery, ArtistWithCounts } from './prisma/artist.selections';
import { CacheKeyTrackingService } from '../redis/cache-key-tracking.service';
import {
  ResourceNotFoundException,
  InvalidInputException,
} from '../common/exceptions/custom.exception';
import {
  emitSongDeletedBatch,
  snapshotSongsForArtistDeletion,
  softDeleteOrphanClipsByIds,
} from '../song/song-cascade-deletion.helper';
import { Prisma } from '@prisma/client';
import { SongDeletedEvent } from '../global-song/dto/global-song.events';
import { ARTIST_EVENTS, ArtistDeletedEvent } from './artist-events';
import { normalizeForSearch } from '../song/utils/search-normalize';

@Injectable()
export class ArtistService {
  constructor(
    private prisma: PrismaService,
    private readonly channelService: ChannelService,
    private readonly eventEmitter: EventEmitter2,
    private readonly cacheTracker: CacheKeyTrackingService,
  ) {}

  async getArtistsByChannelId(channelId: number): Promise<ArtistWithCounts[]> {
    const cacheKey = artistCacheKeys.byChannel(channelId);

    const cached = await this.cacheTracker.get<ArtistWithCounts[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const artistsWithCount = await this.prisma.artist.findMany({
      where: { channelId: channelId },
      ...artistListQuery,
      orderBy: { name: 'asc' },
    });

    await this.cacheTracker.trackAndSet(cacheKey, artistsWithCount, 60, {
      kind: 'channel',
      channelId,
    });

    return artistsWithCount as ArtistWithCounts[];
  }

  async getArtistsByUserId(userId: number) {
    const channelId = await this.channelService.getChannelIdByUserId(userId);

    const artists = await this.getArtistsByChannelId(channelId);

    return artists.map((artist) => ({
      id: artist.id,
      name: artist.name,
      userId: userId,
      createdAt: artist.createdAt,
      songCount: artist._count.songs,
    }));
  }

  async getArtistsByWebPath(webPath: string): Promise<ArtistWithCounts[]> {
    const cacheKey = artistCacheKeys.byWebPath(webPath);

    const cached = await this.cacheTracker.get<ArtistWithCounts[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const channel = await this.channelService.findByWebPath(webPath);
    if (!channel) {
      throw new ResourceNotFoundException('음악북을 찾을 수 없습니다.');
    }

    const result = await this.getArtistsByChannelId(channel.id);

    // webPath 키지만 channel scope 에 등록 — 채널 mutation 시 채널 SET 통째 회수.
    await this.cacheTracker.trackAndSet(cacheKey, result, 60, {
      kind: 'channel',
      channelId: channel.id,
    });

    return result;
  }

  async createArtistByChannelId(
    createArtistDto: CreateArtistDto,
    channelId: number,
  ) {
    await this.assertUniqueArtistNameInChannel(createArtistDto.name, channelId);

    const newArtist = await this.prisma.artist.create({
      data: {
        ...createArtistDto,
        nameSearchable: normalizeForSearch(createArtistDto.name),
        channelId: channelId,
      },
    });

    await this.clearChannelArtistCaches(channelId);

    return newArtist;
  }

  async createArtist(createArtistDto: CreateArtistDto, userId: number) {
    const channelId = await this.channelService.getChannelIdByUserId(userId);

    return this.createArtistByChannelId(createArtistDto, channelId);
  }

  async updateArtistByChannelId(
    artistId: number,
    updateArtistDto: UpdateArtistDto,
    channelId: number,
  ) {
    if (updateArtistDto.name && updateArtistDto.name.trim() !== '') {
      await this.assertUniqueArtistNameInChannel(
        updateArtistDto.name,
        channelId,
        artistId,
      );
    }

    let updatedArtist;
    try {
      updatedArtist = await this.prisma.artist.update({
        where: {
          id: artistId,
          channelId: channelId,
        },
        data: {
          ...updateArtistDto,
          ...(updateArtistDto.name !== undefined && {
            nameSearchable: normalizeForSearch(updateArtistDto.name),
          }),
        },
      });
    } catch (error) {
      // P2025 (record not found) 만 NotFound 로 매핑. 그 외 (P2002 unique
      // 위반 / Lock wait / connection drop 등) 는 silent NotFound 로 가리지 않고
      // 그대로 throw — deleteArtistByChannelId 의 정석 패턴과 정렬.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new ResourceNotFoundException(
          '가수를 찾을 수 없거나 수정 권한이 없습니다.',
        );
      }
      throw error;
    }

    await this.clearChannelArtistCaches(channelId);

    return updatedArtist;
  }

  async updateArtist(
    artistId: number,
    updateArtistDto: UpdateArtistDto,
    userId: number,
  ) {
    const channelId = await this.channelService.getChannelIdByUserId(userId);

    return this.updateArtistByChannelId(artistId, updateArtistDto, channelId);
  }

  async deleteArtistByChannelId(artistId: number, channelId: number) {
    // Song.artist has onDelete: Cascade, so deleting an artist hard-deletes
    // every Song attached to it at the DB layer. Without snapshotting first,
    // those songs vanish without firing SONG_DELETED, leaving the GlobalSong
    // index drifted (channelCount stays high, search keeps surfacing them).
    //
    // Run snapshot + delete in a single transaction so a concurrent song
    // insert under the same artist cannot escape between the two steps.
    let songEvents: SongDeletedEvent[];
    try {
      songEvents = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM artists WHERE id = ${artistId} AND channel_id = ${channelId} FOR UPDATE`;
        const events = await snapshotSongsForArtistDeletion(
          tx,
          artistId,
          channelId,
        );
        const songIds = events.map((e) => e.songId);
        await softDeleteOrphanClipsByIds(tx, songIds, channelId);
        await tx.artist.delete({
          where: { id: artistId, channelId },
        });
        return events;
      });
    } catch (error) {
      // P2025 = "An operation failed because it depends on one or more records
      // that were required but not found." Other errors (lock wait timeout,
      // deadlock, FK violation) must surface for observability — silently
      // mapping them to 404 hides real DB failures.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new ResourceNotFoundException(
          '가수를 찾을 수 없거나 삭제 권한이 없습니다.',
        );
      }
      throw error;
    }

    emitSongDeletedBatch(this.eventEmitter, songEvents);

    const artistDeletedEvent: ArtistDeletedEvent = { artistId, channelId };
    this.eventEmitter.emit(ARTIST_EVENTS.ARTIST_DELETED, artistDeletedEvent);

    await this.clearChannelArtistCaches(channelId);

    return { message: '가수가 삭제되었습니다.' };
  }

  async deleteArtist(artistId: number, userId: number) {
    const channelId = await this.channelService.getChannelIdByUserId(userId);

    return this.deleteArtistByChannelId(artistId, channelId);
  }

  /**
   * 채널 SET 통째 회수 — artist/category/song 캐시 모두 한 번에 atomic 무효화.
   * Layer 1 도입 후 artist mutation 시 song list 응답도 즉시 stale 해소.
   */
  private async clearChannelArtistCaches(channelId: number) {
    await this.cacheTracker.clearChannel(channelId);
  }

  private async assertUniqueArtistNameInChannel(
    name: string,
    channelId: number,
    excludeArtistId?: number,
  ): Promise<void> {
    const trimmedName = name?.trim();
    if (!trimmedName) return;

    const dup = (
      await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT id
      FROM artists
      WHERE channel_id = ${channelId}
        AND REPLACE(LOWER(name), ' ', '') = REPLACE(LOWER(${trimmedName}), ' ', '')
      LIMIT 1
    `
    )[0];

    if (dup && (!excludeArtistId || dup.id !== excludeArtistId)) {
      throw new InvalidInputException('이미 존재하는 아티스트 이름입니다.');
    }
  }
}
