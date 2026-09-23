import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PostStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  InvalidInputException,
  ResourceNotFoundException,
  ResourceAlreadyExistsException,
} from '../common/exceptions/custom.exception';
import { SongHelperService } from './song-helper.service';
import { SongAlbumArtService } from './song-album-art.service';
import { sortSongCategories } from './utils/sort-song-categories';
import { SongCacheService } from './song-cache.service';
import { normalizeForSearch } from './utils/search-normalize';
import {
  CreateSongDto,
  UpdateSongDto,
  BulkCreateSongDto,
  BulkUpdateSongItemDto,
  BulkUpdateSongsResponseDto,
} from './dto/song.dto';
import {
  pickLegacyPrice,
  sanitizeCurrencyPriceMap,
} from '../song-pricing/utils/currency-unit.util';
import {
  GLOBAL_SONG_EVENTS,
  SongDeletedEvent,
} from '../global-song/dto/global-song.events';
import {
  emitSongDeletedBatch,
  snapshotSongsByIds,
  softDeleteOrphanClipsByIds,
} from './song-cascade-deletion.helper';
import { ChannelMusicbookSettingsService } from '../channel/channel-musicbook-settings.service';

interface CreateSongByChannelIdOptions {
  /**
   * Internal-only synchronous GlobalSong mapping. Public song create callers do
   * not pass this; quick-add does because the selected GlobalSong is already
   * authoritative at submit time.
   */
  globalSongId?: number;
}

type BulkSkippedSong = {
  title: string;
  artistName?: string;
  artistId?: number;
  reason: 'duplicate_in_request' | 'already_exists';
};

@Injectable()
export class SongMutationService {
  private readonly logger = new Logger(SongMutationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly songHelper: SongHelperService,
    private readonly albumArtService: SongAlbumArtService,
    private readonly songCacheService: SongCacheService,
    private readonly eventEmitter: EventEmitter2,
    private readonly musicbookSettingsService: ChannelMusicbookSettingsService,
  ) {}

  private orphanClipWhere(songIds: number[]) {
    return {
      status: { not: PostStatus.DELETED },
      clipChannels: {
        some: { songId: { in: songIds } },
        every: { songId: { in: songIds } },
      },
    };
  }

  /** 미리보기용: 고아가 될 클립 수만 반환 (ID를 불러오지 않음). */
  async getOrphanClipCount(songIds: number[]): Promise<number> {
    if (songIds.length === 0) return 0;
    return this.prisma.clip.count({
      where: this.orphanClipWhere(songIds),
    });
  }

  async createSongByChannelId(
    createSongDto: CreateSongDto,
    channelId: number,
    userId?: number,
    options: CreateSongByChannelIdOptions = {},
  ) {
    await this.assertProficiencyPresentWhenRequired(
      channelId,
      createSongDto.proficiency,
    );

    if (!createSongDto.artistId && !createSongDto.artistName) {
      throw new InvalidInputException(
        '아티스트 ID 또는 아티스트 이름을 제공해야 합니다.',
      );
    }
    if (
      (!createSongDto.categoryIds || createSongDto.categoryIds.length === 0) &&
      (!createSongDto.categoryNames || createSongDto.categoryNames.length === 0)
    ) {
      throw new InvalidInputException(
        '카테고리 ID 또는 카테고리 이름을 제공해야 합니다.',
      );
    }

    let artistId = createSongDto.artistId;
    if (artistId) {
      await this.songHelper.validateArtistIdByChannel(artistId, channelId);
    }
    if (!artistId && createSongDto.artistName) {
      const existingArtist = await this.prisma.artist.findFirst({
        where: { name: createSongDto.artistName, channelId },
      });
      artistId = existingArtist
        ? existingArtist.id
        : (
            await this.prisma.artist.create({
              data: {
                name: createSongDto.artistName,
                nameSearchable: normalizeForSearch(createSongDto.artistName),
                channelId,
              },
            })
          ).id;
    }

    if (artistId === undefined) {
      throw new InvalidInputException('아티스트를 확인할 수 없습니다.');
    }
    await this.validateSongDuplicate(createSongDto.title, artistId, channelId);

    const finalCategoryIds: number[] = [];
    if (createSongDto.categoryIds?.length) {
      await this.songHelper.validateCategoryIdsByChannel(
        createSongDto.categoryIds,
        channelId,
      );
      finalCategoryIds.push(...createSongDto.categoryIds);
    }
    if (createSongDto.categoryNames?.length) {
      const newCategoryIds = await this.songHelper.createNewCategoriesByChannel(
        createSongDto.categoryNames,
        channelId,
      );
      finalCategoryIds.push(...newCategoryIds);
    }

    const finalAlbumArt = await this.albumArtService.processAlbumArt(
      createSongDto,
      artistId || 0,
      this.prisma,
    );
    const currencyPrices = sanitizeCurrencyPriceMap(
      createSongDto.currencyPrices,
    );
    const fallbackPrice = pickLegacyPrice(currencyPrices);

    const newSong = await this.prisma.song.create({
      data: {
        title: createSongDto.title,
        titleSearchable: normalizeForSearch(createSongDto.title),
        artistId: artistId,
        channelId,
        albumArt: finalAlbumArt,
        karaokeUrl: createSongDto.karaokeUrl,
        coverUrl: createSongDto.coverUrl,
        originalUrl: createSongDto.originalUrl,
        difficulty: createSongDto.difficulty,
        proficiency: createSongDto.proficiency ?? null,
        songKey:
          createSongDto.songKey && createSongDto.songKey.trim() !== ''
            ? createSongDto.songKey
            : null,
        bpm: createSongDto.bpm,
        lyricsLink: createSongDto.lyricsLink,
        lyricsText: createSongDto.lyricsText,
        description: createSongDto.description,
        price: createSongDto.price ?? fallbackPrice,
        currencyPrices: currencyPrices as any,
        globalSongId: options.globalSongId,
      },
    });

    if (finalCategoryIds.length > 0) {
      const uniqueCategoryIds = [...new Set(finalCategoryIds)];
      await this.prisma.songCategory.createMany({
        data: uniqueCategoryIds.map((categoryId) => ({
          songId: newSong.id,
          categoryId,
        })),
      });
    }

    await this.songCacheService.clearChannelSongCaches(channelId);

    // Fire-and-forget global-song index sync. Wrapped in try/catch so even
    // the metadata lookups cannot affect the song create flow. Listeners
    // also swallow their own errors.
    try {
      const [artistForEvent, categoriesForEvent] = await Promise.all([
        this.prisma.artist.findUnique({
          where: { id: artistId },
          select: { name: true },
        }),
        finalCategoryIds.length > 0
          ? this.prisma.category.findMany({
              where: { id: { in: [...new Set(finalCategoryIds)] } },
              select: { name: true },
            })
          : Promise.resolve([] as Array<{ name: string }>),
      ]);
      this.eventEmitter.emit(GLOBAL_SONG_EVENTS.SONG_CREATED, {
        song: {
          id: newSong.id,
          title: newSong.title,
          artistId: newSong.artistId,
          channelId,
          albumArt: newSong.albumArt,
        },
        artistName: artistForEvent?.name ?? '',
        channelId,
        categoryNames: categoriesForEvent.map((c) => c.name),
      });
    } catch (error) {
      // global-song sync 는 best-effort. mutation 결과에 영향 X 라 throw 안 함.
      // 이전엔 silent — 이젠 logger.error 로 운영 추적 가시화.
      this.logger.error(
        `SONG_CREATED metadata lookup/emit failed (song=${newSong.id}, channel=${channelId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    return this.getSongByChannelId(channelId, newSong.id);
  }

  async updateSongByChannelId(
    songId: number,
    updateSongDto: UpdateSongDto,
    channelId: number,
  ) {
    const existingSong = await this.prisma.song.findFirst({
      where: { id: songId, channelId },
      include: {
        artist: { select: { name: true } },
        songCategories: {
          select: { category: { select: { name: true } } },
        },
      },
    });
    if (!existingSong) {
      throw new ResourceNotFoundException(
        '노래를 찾을 수 없거나 수정 권한이 없습니다.',
      );
    }
    const oldArtistName = existingSong.artist?.name ?? '';
    const oldCategoryNames = existingSong.songCategories.map(
      (sc) => sc.category.name,
    );
    const oldSongSnapshot = {
      id: existingSong.id,
      title: existingSong.title,
      artistId: existingSong.artistId,
      channelId,
      albumArt: existingSong.albumArt,
    };

    if (
      await this.musicbookSettingsService.usesProficiencyAsPrimary(channelId)
    ) {
      const finalProficiency = Object.prototype.hasOwnProperty.call(
        updateSongDto,
        'proficiency',
      )
        ? updateSongDto.proficiency
        : existingSong.proficiency;
      if (!this.isValidRating(finalProficiency)) {
        throw new InvalidInputException('숙련도를 입력해주세요.');
      }
    }

    let artistId = updateSongDto.artistId;
    if (artistId) {
      await this.songHelper.validateArtistIdByChannel(artistId, channelId);
    }
    if (updateSongDto.artistName) {
      const existingArtist = await this.prisma.artist.findFirst({
        where: { name: updateSongDto.artistName, channelId },
      });
      artistId = existingArtist
        ? existingArtist.id
        : (
            await this.prisma.artist.create({
              data: {
                name: updateSongDto.artistName,
                nameSearchable: normalizeForSearch(updateSongDto.artistName),
                channelId,
              },
            })
          ).id;
    }

    // Build update data with only explicitly provided fields
    const normalizeNullableString = (
      value: unknown,
    ): string | null | undefined => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      if (typeof value === 'string') {
        const t = value.trim();
        if (t === '' || t.toLowerCase() === 'null') return null;
        return value;
      }
      return value as string | null | undefined;
    };

    const data: import('@prisma/client').Prisma.SongUncheckedUpdateInput = {};
    if (Object.prototype.hasOwnProperty.call(updateSongDto, 'title')) {
      const v = normalizeNullableString(updateSongDto.title);
      // title은 null 허용하지 않음: null이 오면 빈 문자열로 저장하거나 키 무시 중 정책 선택
      if (v !== undefined && v !== null) {
        data.title = v;
        data.titleSearchable = normalizeForSearch(v);
      }
    }
    // artistId: only set when resolved; null is not allowed for required relation
    if (typeof artistId === 'number') {
      data.artistId = artistId;
    }
    if (Object.prototype.hasOwnProperty.call(updateSongDto, 'albumArt')) {
      const normalizedAlbumArt = normalizeNullableString(
        updateSongDto.albumArt,
      );
      const sanitizedAlbumArt =
        this.albumArtService.sanitizeAlbumArtUrl(normalizedAlbumArt);
      data.albumArt =
        sanitizedAlbumArt === undefined
          ? undefined
          : (sanitizedAlbumArt ?? null);
    }
    if (Object.prototype.hasOwnProperty.call(updateSongDto, 'karaokeUrl')) {
      data.karaokeUrl =
        normalizeNullableString(updateSongDto.karaokeUrl) ?? null;
      // VideoCacheEntry 는 video_id 단위 PK 이므로 invalidate 불필요.
      // preferredPitchSemitones / preferredLyricsOffsetMs 는 영상-종속이라 함께
      // 초기화 (동일 요청에 사용자가 명시한 값이 있으면 아래 분기에서 덮어씀).
      data.preferredPitchSemitones = null;
      data.preferredLyricsOffsetMs = null;
    }
    if (Object.prototype.hasOwnProperty.call(updateSongDto, 'coverUrl')) {
      data.coverUrl = normalizeNullableString(updateSongDto.coverUrl) ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(updateSongDto, 'originalUrl')) {
      data.originalUrl =
        normalizeNullableString(updateSongDto.originalUrl) ?? null;
      // VideoCacheEntry 는 video_id 단위 PK 이므로 invalidate 불필요.
      data.preferredPitchSemitones = null;
      data.preferredLyricsOffsetMs = null;
    }
    if (
      Object.prototype.hasOwnProperty.call(
        updateSongDto,
        'preferredPitchSemitones',
      )
    ) {
      // null 명시 = 초기화, 정수 = 값 설정, 미지정 = 유지.
      data.preferredPitchSemitones = updateSongDto.preferredPitchSemitones;
    }
    if (
      Object.prototype.hasOwnProperty.call(
        updateSongDto,
        'preferredLyricsOffsetMs',
      )
    ) {
      // null 명시 = 초기화, 정수 = 값 설정, 미지정 = 유지.
      data.preferredLyricsOffsetMs = updateSongDto.preferredLyricsOffsetMs;
    }
    if (Object.prototype.hasOwnProperty.call(updateSongDto, 'difficulty')) {
      data.difficulty = updateSongDto.difficulty as unknown as number | null;
    }
    if (Object.prototype.hasOwnProperty.call(updateSongDto, 'proficiency')) {
      data.proficiency = updateSongDto.proficiency as unknown as number | null;
    }
    if (Object.prototype.hasOwnProperty.call(updateSongDto, 'songKey')) {
      data.songKey = normalizeNullableString(updateSongDto.songKey) ?? null; // null clears, string sets, omitted leaves unchanged
    }
    if (Object.prototype.hasOwnProperty.call(updateSongDto, 'bpm')) {
      data.bpm = updateSongDto.bpm as unknown as number | null;
    }
    if (Object.prototype.hasOwnProperty.call(updateSongDto, 'lyricsLink')) {
      data.lyricsLink =
        normalizeNullableString(updateSongDto.lyricsLink) ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(updateSongDto, 'lyricsText')) {
      data.lyricsText =
        normalizeNullableString(updateSongDto.lyricsText) ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(updateSongDto, 'description')) {
      data.description =
        normalizeNullableString(updateSongDto.description) ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(updateSongDto, 'price')) {
      data.price = updateSongDto.price ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(updateSongDto, 'currencyPrices')) {
      const currencyPrices = sanitizeCurrencyPriceMap(
        updateSongDto.currencyPrices,
      );
      data.currencyPrices = (currencyPrices ?? null) as any;
      if (!Object.prototype.hasOwnProperty.call(updateSongDto, 'price')) {
        data.price = pickLegacyPrice(currencyPrices);
      }
    }

    const updatedSong = await this.prisma.song.update({
      where: { id: songId },
      data,
    });

    if (
      updateSongDto.categoryIds !== undefined ||
      updateSongDto.categoryNames !== undefined
    ) {
      const finalCategoryIds: number[] = [];
      if (updateSongDto.categoryIds?.length) {
        await this.songHelper.validateCategoryIdsByChannel(
          updateSongDto.categoryIds,
          channelId,
        );
        finalCategoryIds.push(...updateSongDto.categoryIds);
      }
      if (updateSongDto.categoryNames?.length) {
        const newCategoryIds =
          await this.songHelper.createNewCategoriesByChannel(
            updateSongDto.categoryNames,
            channelId,
          );
        finalCategoryIds.push(...newCategoryIds);
      }

      await this.prisma.songCategory.deleteMany({ where: { songId } });
      if (finalCategoryIds.length > 0) {
        const uniqueCategoryIds = [...new Set(finalCategoryIds)];
        await this.prisma.songCategory.createMany({
          data: uniqueCategoryIds.map((categoryId) => ({
            songId,
            categoryId,
          })),
        });
      }
    }

    await this.songCacheService.clearChannelSongCaches(channelId);

    // Fire-and-forget global-song index sync for updates.
    try {
      const [newArtistForEvent, newCategoriesForEvent] = await Promise.all([
        this.prisma.artist.findUnique({
          where: { id: updatedSong.artistId },
          select: { name: true },
        }),
        this.prisma.songCategory.findMany({
          where: { songId },
          select: { category: { select: { name: true } } },
        }),
      ]);
      this.eventEmitter.emit(GLOBAL_SONG_EVENTS.SONG_UPDATED, {
        oldSong: oldSongSnapshot,
        oldArtistName,
        oldCategoryNames,
        newSong: {
          id: updatedSong.id,
          title: updatedSong.title,
          artistId: updatedSong.artistId,
          channelId,
          albumArt: updatedSong.albumArt,
        },
        newArtistName: newArtistForEvent?.name ?? '',
        newCategoryNames: newCategoriesForEvent.map((sc) => sc.category.name),
        channelId,
      });
    } catch (error) {
      this.logger.error(
        `SONG_UPDATED metadata lookup/emit failed (song=${updatedSong.id}, channel=${channelId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    return this.getSongByChannelId(channelId, updatedSong.id);
  }

  async deleteSongByChannelId(
    songId: number,
    channelId: number,
  ): Promise<{ message: string; deletedClipIds: number[] }> {
    // Snapshot + orphan-clip cleanup + delete must run inside a single
    // transaction with the target row locked FOR UPDATE — bulk version
    // (bulkDeleteSongsByChannelId) follows the same pattern. Splitting
    // these into separate Prisma calls let an orphan-clip scan miss clips
    // that became orphans between the scan and the song.delete cascade,
    // leaving Clip rows with zero clip_channels in VISIBLE state (the
    // root cause of the legacy orphan_clip backlog cleaned up on 5/15).
    let songEvents: SongDeletedEvent[];
    let orphanClipIds: number[];
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM songs WHERE id = ${songId} AND channel_id = ${channelId} FOR UPDATE`;
        const events = await snapshotSongsByIds(tx, [songId], channelId);
        const orphanIds = await softDeleteOrphanClipsByIds(
          tx,
          [songId],
          channelId,
        );
        await tx.song.delete({ where: { id: songId, channelId } });
        return { events, orphanIds };
      });
      songEvents = result.events;
      orphanClipIds = result.orphanIds;
    } catch (error) {
      // P2025 (record not found) 만 404 로 매핑. DB connection 오류 / 제약 위반 등은
      // 그대로 throw 해서 5xx 로 노출 — 잘못 404 로 가리면 운영 추적 불가.
      // 패턴 모델: artist.service.ts:175-189
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new ResourceNotFoundException(
          '노래를 찾을 수 없거나 삭제 권한이 없습니다.',
        );
      }
      throw error;
    }

    // 트랜잭션 commit 후 — invalidate / emit 실패가 caller 200 을 500/404 로 변경 X.
    await this.songCacheService.clearChannelSongCaches(channelId);
    emitSongDeletedBatch(this.eventEmitter, songEvents);

    return {
      message: '노래가 삭제되었습니다.',
      deletedClipIds: orphanClipIds,
    };
  }

  async bulkCreateSongsByChannelId(
    bulkDto: BulkCreateSongDto,
    channelId: number,
    userId?: number,
  ) {
    const useProficiencyAsPrimary =
      await this.musicbookSettingsService.usesProficiencyAsPrimary(channelId);
    // 간결 위임: SongService에서 사용하던 검증/트랜잭션 로직을 유지
    for (const song of bulkDto.songs) {
      if (!song.artistId && !song.artistName) {
        throw new InvalidInputException(
          `노래 "${song.title}": 아티스트 ID 또는 아티스트 이름을 제공해야 합니다.`,
        );
      }
      if (
        (!song.categoryIds || song.categoryIds.length === 0) &&
        (!song.categoryNames || song.categoryNames.length === 0)
      ) {
        throw new InvalidInputException(
          `노래 "${song.title}": 카테고리 ID 또는 카테고리 이름을 제공해야 합니다.`,
        );
      }
    }

    const allArtistNames = [
      ...new Set(
        bulkDto.songs
          .filter((song) => song.artistName)
          .map((song) => song.artistName),
      ),
    ] as string[];
    const categoryNameInputMap = this.songHelper.buildUniqueCategoryNameMap(
      bulkDto.songs.flatMap((song) => song.categoryNames ?? []),
    );
    const allCategoryNames = [...categoryNameInputMap.values()];
    const allArtistIds = [
      ...new Set(
        bulkDto.songs
          .filter((song) => song.artistId)
          .map((song) => song.artistId),
      ),
    ] as number[];
    const allCategoryIds = [
      ...new Set(bulkDto.songs.flatMap((song) => song.categoryIds || [])),
    ] as number[];

    if (allArtistIds.length > 0) {
      const existingArtistIds = await this.prisma.artist.findMany({
        where: { id: { in: allArtistIds }, channelId },
        select: { id: true },
      });
      const valid = new Set(existingArtistIds.map((a) => a.id));
      const invalid = allArtistIds.filter((id) => !valid.has(id));
      if (invalid.length > 0) {
        throw new InvalidInputException(
          `존재하지 않거나 해당 채널에 속하지 않은 아티스트 ID: ${invalid.join(', ')}`,
        );
      }
    }
    if (allCategoryIds.length > 0) {
      const existingCategoryIds = await this.prisma.category.findMany({
        where: { id: { in: allCategoryIds }, channelId },
        select: { id: true },
      });
      const valid = new Set(existingCategoryIds.map((c) => c.id));
      const invalid = allCategoryIds.filter((id) => !valid.has(id));
      if (invalid.length > 0) {
        throw new InvalidInputException(
          `존재하지 않거나 해당 채널에 속하지 않은 카테고리 ID: ${invalid.join(', ')}`,
        );
      }
    }

    const existingArtists = await this.prisma.artist.findMany({
      where: { channelId, name: { in: allArtistNames } },
    });
    // MySQL에서는 mode: 'insensitive'를 지원하지 않으므로
    // 모든 카테고리를 가져온 후 애플리케이션 레벨에서 비교
    const existingCategories =
      allCategoryNames.length > 0
        ? await this.prisma.category.findMany({
            where: { channelId },
          })
        : [];
    const artistNameMap = new Map(existingArtists.map((a) => [a.name, a.id]));
    const categoryNameMap = new Map<string, number>();
    existingCategories.forEach((category) => {
      categoryNameMap.set(
        this.songHelper.normalizeCategoryName(category.name),
        category.id,
      );
    });

    const skippedSongs: BulkSkippedSong[] = [];
    const inPayloadSeen = new Set<string>();
    const candidateSongs: CreateSongDto[] = [];
    for (const song of bulkDto.songs) {
      const artistIdOrMapped =
        song.artistId ??
        (song.artistName ? artistNameMap.get(song.artistName) : undefined);
      const key = `$${artistIdOrMapped !== undefined ? `id:${artistIdOrMapped}` : `name:${song.artistName ?? ''}`}|${song.title}`;
      if (inPayloadSeen.has(key)) {
        skippedSongs.push({
          title: song.title,
          artistName: song.artistName,
          artistId: song.artistId ?? artistIdOrMapped,
          reason: 'duplicate_in_request',
        });
        continue;
      }
      inPayloadSeen.add(key);
      candidateSongs.push(song);
    }

    const duplicateCheckPairs: { title: string; artistId: number }[] = [];
    for (const song of candidateSongs) {
      const resolvedArtistId =
        song.artistId ??
        (song.artistName ? artistNameMap.get(song.artistName) : undefined);
      if (resolvedArtistId) {
        duplicateCheckPairs.push({
          title: song.title,
          artistId: resolvedArtistId,
        });
      }
    }
    let songsToCreate = candidateSongs;
    if (duplicateCheckPairs.length > 0) {
      const existing = await this.prisma.song.findMany({
        where: {
          channelId,
          OR: duplicateCheckPairs.map((p) => ({
            title: p.title,
            artistId: p.artistId,
          })),
        },
        include: { artist: { select: { name: true } } },
      });
      if (existing.length > 0) {
        const existingKeys = new Set(
          existing.map((song) => `${song.artistId}|${song.title}`),
        );
        for (const song of existing) {
          skippedSongs.push({
            title: song.title,
            artistName: song.artist.name,
            artistId: song.artistId,
            reason: 'already_exists',
          });
        }
        songsToCreate = candidateSongs.filter((song) => {
          const resolvedArtistId =
            song.artistId ??
            (song.artistName ? artistNameMap.get(song.artistName) : undefined);
          return !(
            resolvedArtistId !== undefined &&
            existingKeys.has(`${resolvedArtistId}|${song.title}`)
          );
        });
      }
    }

    const newArtistNames = [
      ...new Set(
        songsToCreate.flatMap((song) =>
          song.artistName && !artistNameMap.has(song.artistName)
            ? [song.artistName]
            : [],
        ),
      ),
    ];
    const categoryNameInputMapForCreate =
      this.songHelper.buildUniqueCategoryNameMap(
        songsToCreate.flatMap((song) => song.categoryNames ?? []),
      );
    const newCategoryNames = [...categoryNameInputMapForCreate.entries()]
      .filter(([normalized]) => !categoryNameMap.has(normalized))
      .map(([, displayName]) => displayName);

    if (songsToCreate.length === 0) {
      return {
        success: true,
        createdCount: 0,
        skippedCount: skippedSongs.length,
        newArtistsCount: 0,
        newCategoriesCount: 0,
        songs: [],
        skippedSongs,
      };
    }

    const precomputedAlbumArts = await Promise.all(
      songsToCreate.map((song) => {
        const resolvedArtistId =
          song.artistId ??
          (song.artistName ? (artistNameMap.get(song.artistName) ?? 0) : 0);
        return this.albumArtService.processAlbumArt(
          song,
          resolvedArtistId || 0,
          this.prisma,
        );
      }),
    );

    const txResult = await this.prisma.$transaction(async (tx) => {
      if (newArtistNames.length > 0) {
        await tx.artist.createMany({
          data: newArtistNames.map((name) => ({
            name,
            nameSearchable: normalizeForSearch(name),
            channelId,
          })),
        });
      }
      if (newCategoryNames.length > 0) {
        await tx.category.createMany({
          data: newCategoryNames.map((name, index) => ({
            name,
            channelId,
            color: this.songHelper.chooseColorByIndex(index),
          })),
        });
      }

      const createdArtists =
        newArtistNames.length > 0
          ? await tx.artist.findMany({
              where: { channelId, name: { in: newArtistNames } },
              select: { id: true, name: true },
            })
          : [];
      const createdCategories =
        newCategoryNames.length > 0
          ? await tx.category.findMany({
              where: { channelId, name: { in: newCategoryNames } },
              select: { id: true, name: true },
            })
          : [];
      for (const a of createdArtists) artistNameMap.set(a.name, a.id);
      for (const c of createdCategories)
        categoryNameMap.set(
          this.songHelper.normalizeCategoryName(c.name),
          c.id,
        );

      const songsData = songsToCreate.map((song, i) => {
        const artistId =
          song.artistId ??
          (song.artistName ? artistNameMap.get(song.artistName) : undefined);
        const finalAlbumArt = precomputedAlbumArts[i] ?? null;
        const currencyPrices = sanitizeCurrencyPriceMap(song.currencyPrices);
        const fallbackPrice = pickLegacyPrice(currencyPrices);
        if (artistId === undefined) {
          throw new InvalidInputException('아티스트를 확인할 수 없습니다.');
        }
        return {
          title: song.title,
          titleSearchable: normalizeForSearch(song.title),
          artistId,
          channelId,
          albumArt: finalAlbumArt,
          karaokeUrl: song.karaokeUrl,
          coverUrl: song.coverUrl,
          originalUrl: song.originalUrl,
          difficulty: song.difficulty ?? 1,
          proficiency: this.resolveBulkCreateProficiency(
            song,
            useProficiencyAsPrimary,
          ),
          songKey: song.songKey,
          bpm: song.bpm,
          lyricsLink: song.lyricsLink,
          lyricsText: song.lyricsText,
          description: song.description,
          price: song.price ?? fallbackPrice,
          currencyPrices: (currencyPrices ?? null) as any,
        };
      });
      await tx.song.createMany({ data: songsData });

      const createdSongsFull = await tx.song.findMany({
        where: {
          channelId,
          OR: songsData.map((d) => ({ title: d.title, artistId: d.artistId })),
        },
        select: { id: true, title: true, artistId: true },
      });
      const songKeyToId = new Map<string, number>(
        createdSongsFull.map((s) => [`${s.artistId}|${s.title}`, s.id]),
      );
      const createdSongs = createdSongsFull.map((s) => ({
        id: s.id,
        title: s.title,
      }));

      const relationPairs: { songId: number; categoryId: number }[] = [];
      for (let i = 0; i < songsToCreate.length; i++) {
        const s = songsToCreate[i];
        const artistId =
          s.artistId ??
          (s.artistName ? artistNameMap.get(s.artistName) : undefined);
        if (artistId === undefined) continue;
        const createdSongId = songKeyToId.get(`${artistId}|${s.title}`);
        if (!createdSongId) continue;
        const categoryIds: number[] = [];
        if (s.categoryIds && s.categoryIds.length > 0)
          categoryIds.push(...s.categoryIds);
        if (s.categoryNames && s.categoryNames.length > 0) {
          const mappedIds = s.categoryNames
            .map((name) =>
              categoryNameMap.get(this.songHelper.normalizeCategoryName(name)),
            )
            .filter((id): id is number => id !== undefined);
          categoryIds.push(...mappedIds);
        }
        const uniqueCategoryIds = [...new Set(categoryIds)];
        uniqueCategoryIds.forEach((categoryId) =>
          relationPairs.push({ songId: createdSongId, categoryId }),
        );
      }
      if (relationPairs.length > 0) {
        const dedup = Array.from(
          new Map(
            relationPairs.map((r) => [`${r.songId}|${r.categoryId}`, r]),
          ).values(),
        );
        await tx.songCategory.createMany({ data: dedup });
      }

      return {
        success: true,
        createdCount: songsToCreate.length,
        skippedCount: skippedSongs.length,
        newArtistsCount: newArtistNames.length,
        newCategoriesCount: newCategoryNames.length,
        songs: createdSongs,
        skippedSongs,
      };
    });

    await this.songCacheService.clearChannelSongCaches(channelId);
    const typedResult = txResult as unknown as {
      success: boolean;
      createdCount: number;
      skippedCount: number;
      newArtistsCount: number;
      newCategoriesCount: number;
      songs: { id: number; title: string }[];
      skippedSongs: BulkSkippedSong[];
    };
    await this.emitBulkSongCreatedEvents(
      channelId,
      typedResult.songs.map((s) => s.id),
    );
    return typedResult;
  }

  async bulkCreateSongsByChannelIdV2(
    bulkDto: BulkCreateSongDto,
    channelId: number,
    userId?: number,
  ) {
    const useProficiencyAsPrimary =
      await this.musicbookSettingsService.usesProficiencyAsPrimary(channelId);
    // 간결 위임: SongService v2 로직을 반영
    for (const song of bulkDto.songs) {
      if (!song.artistId && !song.artistName) {
        throw new InvalidInputException(
          `노래 "${song.title}": 아티스트 ID 또는 아티스트 이름을 제공해야 합니다.`,
        );
      }
    }

    const artistNames = [
      ...new Set(
        bulkDto.songs
          .map((s) => s.artistName)
          .filter((v): v is string => !!v?.trim()),
      ),
    ];
    const artistIds = [
      ...new Set(
        bulkDto.songs
          .map((s) => s.artistId)
          .filter((v): v is number => typeof v === 'number'),
      ),
    ];
    const categoryNameInputMapV2 = this.songHelper.buildUniqueCategoryNameMap(
      bulkDto.songs.flatMap((s) => s.categoryNames ?? []),
    );
    const categoryNames = [...categoryNameInputMapV2.values()];
    const categoryIds = [
      ...new Set(bulkDto.songs.flatMap((s) => s.categoryIds || [])),
    ];

    if (artistIds.length > 0) {
      const ok = new Set(
        (
          await this.prisma.artist.findMany({
            where: { id: { in: artistIds }, channelId },
            select: { id: true },
          })
        ).map((a) => a.id),
      );
      const bad = artistIds.filter((id) => !ok.has(id));
      if (bad.length > 0) {
        throw new InvalidInputException(
          `존재하지 않거나 채널에 속하지 않은 아티스트 ID: ${bad.join(', ')}`,
        );
      }
    }
    if (categoryIds.length > 0) {
      const ok = new Set(
        (
          await this.prisma.category.findMany({
            where: { id: { in: categoryIds }, channelId },
            select: { id: true },
          })
        ).map((c) => c.id),
      );
      const bad = categoryIds.filter((id) => !ok.has(id));
      if (bad.length > 0) {
        throw new InvalidInputException(
          `존재하지 않거나 채널에 속하지 않은 카테고리 ID: ${bad.join(', ')}`,
        );
      }
    }

    const existingArtists = await this.prisma.artist.findMany({
      where: { channelId, name: { in: artistNames } },
      select: { id: true, name: true },
    });
    // MySQL에서는 mode: 'insensitive'를 지원하지 않으므로
    // 모든 카테고리를 가져온 후 애플리케이션 레벨에서 비교
    const existingCategories =
      categoryNames.length > 0
        ? await this.prisma.category.findMany({
            where: { channelId },
            select: { id: true, name: true },
          })
        : [];
    const artistNameToId = new Map(existingArtists.map((a) => [a.name, a.id]));
    const categoryNameToId = new Map<string, number>();
    existingCategories.forEach((category) => {
      categoryNameToId.set(
        this.songHelper.normalizeCategoryName(category.name),
        category.id,
      );
    });
    const skippedSongs: BulkSkippedSong[] = [];
    const seen = new Set<string>();
    const candidateSongs: CreateSongDto[] = [];
    for (const s of bulkDto.songs) {
      const artistId = s.artistId ?? artistNameToId.get(s.artistName || '');
      const key = `${artistId ?? s.artistName}|${s.title}`;
      if (seen.has(key)) {
        skippedSongs.push({
          title: s.title,
          artistName: s.artistName,
          artistId: s.artistId ?? artistId,
          reason: 'duplicate_in_request',
        });
        continue;
      }
      seen.add(key);
      candidateSongs.push(s);
    }

    const pairs: { title: string; artistId: number }[] = [];
    for (const s of candidateSongs) {
      const id = s.artistId ?? artistNameToId.get(s.artistName || '');
      if (id) pairs.push({ title: s.title, artistId: id });
    }
    let songsToCreate = candidateSongs;
    if (pairs.length > 0) {
      const exist = await this.prisma.song.findMany({
        where: { channelId, OR: pairs },
        include: { artist: { select: { name: true } } },
      });
      if (exist.length > 0) {
        const existingKeys = new Set(
          exist.map((song) => `${song.artistId}|${song.title}`),
        );
        for (const song of exist) {
          skippedSongs.push({
            title: song.title,
            artistName: song.artist.name,
            artistId: song.artistId,
            reason: 'already_exists',
          });
        }
        songsToCreate = candidateSongs.filter((song) => {
          const artistId =
            song.artistId ?? artistNameToId.get(song.artistName || '');
          return !(
            artistId !== undefined &&
            existingKeys.has(`${artistId}|${song.title}`)
          );
        });
      }
    }

    const newArtistNames = [
      ...new Set(
        songsToCreate.flatMap((song) =>
          song.artistName && !artistNameToId.has(song.artistName)
            ? [song.artistName]
            : [],
        ),
      ),
    ];
    const categoryNameInputMapForCreate =
      this.songHelper.buildUniqueCategoryNameMap(
        songsToCreate.flatMap((song) => song.categoryNames ?? []),
      );
    const newCategoryNames = [...categoryNameInputMapForCreate.entries()]
      .filter(([normalized]) => !categoryNameToId.has(normalized))
      .map(([, displayName]) => displayName);

    if (songsToCreate.length === 0) {
      return {
        success: true,
        createdCount: 0,
        skippedCount: skippedSongs.length,
        newArtistsCount: 0,
        newCategoriesCount: 0,
        songs: [],
        skippedSongs,
      };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (newArtistNames.length > 0) {
        await tx.artist.createMany({
          data: newArtistNames.map((name) => ({
            name,
            nameSearchable: normalizeForSearch(name),
            channelId,
          })),
        });
      }
      if (newCategoryNames.length > 0) {
        await tx.category.createMany({
          data: newCategoryNames.map((name, index) => ({
            name,
            channelId,
            color: this.songHelper.chooseColorByIndex(index),
          })),
        });
      }

      if (newArtistNames.length > 0) {
        const created = await tx.artist.findMany({
          where: { channelId, name: { in: newArtistNames } },
          select: { id: true, name: true },
        });
        created.forEach((a) => artistNameToId.set(a.name, a.id));
      }
      if (newCategoryNames.length > 0) {
        const created = await tx.category.findMany({
          where: { channelId, name: { in: newCategoryNames } },
          select: { id: true, name: true },
        });
        created.forEach((c) =>
          categoryNameToId.set(
            this.songHelper.normalizeCategoryName(c.name),
            c.id,
          ),
        );
      }

      const rows = songsToCreate.map((s) => {
        const artistId = s.artistId ?? artistNameToId.get(s.artistName || '');
        const currencyPrices = sanitizeCurrencyPriceMap(s.currencyPrices);
        const fallbackPrice = pickLegacyPrice(currencyPrices);
        if (!artistId)
          throw new InvalidInputException('아티스트를 확인할 수 없습니다.');
        return {
          title: s.title,
          titleSearchable: normalizeForSearch(s.title),
          artistId,
          channelId,
          albumArt: s.albumArt ?? null,
          karaokeUrl: s.karaokeUrl ?? null,
          coverUrl: s.coverUrl ?? null,
          originalUrl: s.originalUrl ?? null,
          difficulty: s.difficulty ?? 1,
          proficiency: this.resolveBulkCreateProficiency(
            s,
            useProficiencyAsPrimary,
          ),
          songKey: s.songKey ?? null,
          bpm: s.bpm ?? null,
          lyricsLink: s.lyricsLink ?? null,
          lyricsText: s.lyricsText ?? null,
          description: s.description ?? null,
          price: s.price ?? fallbackPrice,
          currencyPrices: (currencyPrices ?? null) as any,
        };
      });

      const chunkSize = 200;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        await tx.song.createMany({ data: chunk });
      }

      const created = await tx.song.findMany({
        where: {
          channelId,
          OR: rows.map((r) => ({ title: r.title, artistId: r.artistId })),
        },
        select: { id: true, title: true, artistId: true },
      });
      const keyToId = new Map(
        created.map((s) => [`${s.artistId}|${s.title}`, s.id]),
      );

      const rel: { songId: number; categoryId: number }[] = [];
      for (const s of songsToCreate) {
        const artistId = s.artistId ?? artistNameToId.get(s.artistName || '');
        if (!artistId) continue;
        const songId = keyToId.get(`${artistId}|${s.title}`);
        if (!songId) continue;
        const ids: number[] = [];
        if (s.categoryIds?.length) ids.push(...s.categoryIds);
        if (s.categoryNames?.length) {
          ids.push(
            ...s.categoryNames
              .map((n) =>
                categoryNameToId.get(this.songHelper.normalizeCategoryName(n)),
              )
              .filter((v): v is number => typeof v === 'number'),
          );
        }
        const uniq = [...new Set(ids)];
        uniq.forEach((cid) => rel.push({ songId, categoryId: cid }));
      }
      if (rel.length > 0) {
        const dedup = Array.from(
          new Map(rel.map((r) => [`${r.songId}|${r.categoryId}`, r])).values(),
        );
        for (let i = 0; i < dedup.length; i += chunkSize) {
          const chunk = dedup.slice(i, i + chunkSize);
          await tx.songCategory.createMany({ data: chunk });
        }
      }

      return {
        success: true,
        createdCount: rows.length,
        skippedCount: skippedSongs.length,
        newArtistsCount: newArtistNames.length,
        newCategoriesCount: newCategoryNames.length,
        songs: created.map((s) => ({ id: s.id, title: s.title })),
        skippedSongs,
      };
    });

    await this.songCacheService.clearChannelSongCaches(channelId);
    await this.emitBulkSongCreatedEvents(
      channelId,
      result.songs.map((s) => s.id),
    );
    return result;
  }

  /**
   * Bulk 등록 (V1/V2) 후 생성된 곡들에 대해 단건 등록과 동일한
   * SONG_CREATED 이벤트를 emit 하여 GlobalSongIndexer 가 globalSongId
   * 매핑을 수행하도록 한다. metadata lookup 은 chunk 단위로 fetch 하며
   * 실패해도 bulk mutation 결과에는 영향 X (best-effort, 단건 path 동일 패턴).
   */
  private async emitBulkSongCreatedEvents(
    channelId: number,
    createdSongIds: number[],
  ): Promise<void> {
    if (createdSongIds.length === 0) return;
    const CHUNK = 200;
    let emitted = 0;
    let failedChunks = 0;
    // chunk 단위 try/catch — 한 chunk 의 metadata lookup 이 실패해도 나머지
    // chunk 는 계속 emit (부분 실패 격리). 전체를 한 catch 로 감싸면 첫 chunk
    // 실패 시 이후 곡이 전부 unmapped 로 남는다.
    for (let i = 0; i < createdSongIds.length; i += CHUNK) {
      const chunk = createdSongIds.slice(i, i + CHUNK);
      try {
        const songsWithMeta = await this.prisma.song.findMany({
          where: { id: { in: chunk } },
          select: {
            id: true,
            title: true,
            artistId: true,
            albumArt: true,
            artist: { select: { name: true } },
            songCategories: {
              select: { category: { select: { name: true } } },
            },
          },
        });
        for (const s of songsWithMeta) {
          this.eventEmitter.emit(GLOBAL_SONG_EVENTS.SONG_CREATED, {
            song: {
              id: s.id,
              title: s.title,
              artistId: s.artistId,
              channelId,
              albumArt: s.albumArt,
            },
            artistName: s.artist?.name ?? '',
            channelId,
            categoryNames: s.songCategories.map((sc) => sc.category.name),
          });
          emitted++;
        }
      } catch (error) {
        failedChunks++;
        this.logger.error(
          `Bulk SONG_CREATED chunk failed (channel=${channelId}, chunkStart=${i}, ids=${chunk.length}): ${
            error instanceof Error ? error.message : String(error)
          }`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
    if (failedChunks > 0) {
      this.logger.warn(
        `Bulk SONG_CREATED partial emit (channel=${channelId}): emitted=${emitted}/${createdSongIds.length}, failedChunks=${failedChunks}`,
      );
    }
  }

  async bulkDeleteSongsByChannelId(
    ids: number[],
    channelId: number,
  ): Promise<{
    success: boolean;
    deletedCount: number;
    deletedClipIds: number[];
  }> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new InvalidInputException('삭제할 ID 목록이 필요합니다.');
    }
    if (ids.length > 300) {
      throw new InvalidInputException(
        '한 번에 최대 300개까지만 삭제할 수 있습니다.',
      );
    }
    const normalizedIds = Array.from(
      new Set(ids.filter((v) => typeof v === 'number' && !isNaN(v))),
    );
    if (normalizedIds.length === 0) {
      throw new InvalidInputException('유효한 ID가 없습니다.');
    }

    // Snapshot + orphan-clip cleanup + delete must run inside a single
    // transaction with the target rows locked FOR UPDATE. Otherwise a
    // concurrent rename/move can mutate title/artist/categories between
    // snapshot and deleteMany, leaving the SONG_DELETED payload pointing at
    // a stale tuple — deindexSong would then no-op and the GlobalSong index
    // would drift (the same root cause we're fixing for channel/artist).
    const { count, deletedClipIds, songEvents } =
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM songs WHERE id IN (${Prisma.join(normalizedIds)}) AND channel_id = ${channelId} FOR UPDATE`;
        const events = await snapshotSongsByIds(tx, normalizedIds, channelId);
        const orphanIds = await softDeleteOrphanClipsByIds(
          tx,
          normalizedIds,
          channelId,
        );
        const { count: deletedCount } = await tx.song.deleteMany({
          where: { id: { in: normalizedIds }, channelId },
        });
        return {
          count: deletedCount,
          deletedClipIds: orphanIds,
          songEvents: events,
        };
      });

    // cache clear 를 emit 보다 먼저 — listener 가 stale entry 를 재캐싱하는
    // race 방지 (single deleteSongByChannelId 와 동일 순서).
    await this.songCacheService.clearChannelSongCaches(channelId);
    emitSongDeletedBatch(this.eventEmitter, songEvents);

    return {
      success: true,
      deletedCount: count,
      deletedClipIds,
    };
  }

  async bulkUpdateSongsByChannelId(
    songs: BulkUpdateSongItemDto[],
    channelId: number,
  ): Promise<BulkUpdateSongsResponseDto> {
    if (!Array.isArray(songs) || songs.length === 0) {
      throw new InvalidInputException('수정할 노래 목록이 필요합니다.');
    }
    if (songs.length > 300) {
      throw new InvalidInputException(
        '한 번에 최대 300개까지만 수정할 수 있습니다.',
      );
    }

    const songIds = songs.map((s) => s.id);
    const uniqueSongIds = [...new Set(songIds)];

    // 모든 노래가 해당 채널에 속하는지 확인
    const existingSongs = await this.prisma.song.findMany({
      where: { id: { in: uniqueSongIds }, channelId },
      select: { id: true, proficiency: true },
    });
    const existingIds = new Set(existingSongs.map((s) => s.id));
    const invalidIds = uniqueSongIds.filter((id) => !existingIds.has(id));
    if (invalidIds.length > 0) {
      throw new InvalidInputException(
        `다음 노래를 찾을 수 없거나 수정 권한이 없습니다: ${invalidIds.join(', ')}`,
      );
    }
    if (
      await this.musicbookSettingsService.usesProficiencyAsPrimary(channelId)
    ) {
      const existingProficiencyById = new Map(
        existingSongs.map((song) => [song.id, song.proficiency]),
      );
      for (const item of songs) {
        const finalProficiency = Object.prototype.hasOwnProperty.call(
          item,
          'proficiency',
        )
          ? item.proficiency
          : existingProficiencyById.get(item.id);
        if (!this.isValidRating(finalProficiency)) {
          throw new InvalidInputException(
            `노래 ID ${item.id}: 숙련도를 입력해주세요.`,
          );
        }
      }
    }

    // 트랜잭션으로 일괄 수정
    const updatedIds = await this.prisma.$transaction(async (tx) => {
      const updated: number[] = [];

      for (const item of songs) {
        let artistId: number | undefined;

        // 아티스트 처리
        if (item.artistId) {
          await this.songHelper.validateArtistIdByChannel(
            item.artistId,
            channelId,
          );
          artistId = item.artistId;
        } else if (item.artistName) {
          const existingArtist = await tx.artist.findFirst({
            where: { name: item.artistName, channelId },
          });
          artistId = existingArtist
            ? existingArtist.id
            : (
                await tx.artist.create({
                  data: {
                    name: item.artistName,
                    nameSearchable: normalizeForSearch(item.artistName),
                    channelId,
                  },
                })
              ).id;
        }

        // 노래 업데이트 데이터 구성
        const updateData: {
          artistId?: number;
          difficulty?: number;
          proficiency?: number | null;
          price?: number | null;
          currencyPrices?: any;
        } = {};
        if (artistId !== undefined) {
          updateData.artistId = artistId;
        }
        if (item.difficulty !== undefined) {
          updateData.difficulty = item.difficulty;
        }
        if (item.proficiency !== undefined) {
          updateData.proficiency = item.proficiency;
        }
        if (item.price !== undefined) {
          updateData.price = item.price;
        }
        if (item.currencyPrices !== undefined) {
          const currencyPrices = sanitizeCurrencyPriceMap(item.currencyPrices);
          updateData.currencyPrices = (currencyPrices ?? null) as any;
          if (item.price === undefined) {
            updateData.price = pickLegacyPrice(currencyPrices);
          }
        }

        // 노래 기본 정보 업데이트
        if (Object.keys(updateData).length > 0) {
          await tx.song.update({
            where: { id: item.id },
            data: updateData,
          });
        }

        // 카테고리 처리
        if (
          item.categoryIds !== undefined ||
          item.categoryNames !== undefined
        ) {
          const finalCategoryIds: number[] = [];

          if (item.categoryIds?.length) {
            await this.songHelper.validateCategoryIdsByChannel(
              item.categoryIds,
              channelId,
            );
            finalCategoryIds.push(...item.categoryIds);
          }

          if (item.categoryNames?.length) {
            // 기존 카테고리 이름 매핑 조회
            const existingCategories = await tx.category.findMany({
              where: {
                channelId,
                name: {
                  in: item.categoryNames.map((n) =>
                    this.songHelper.normalizeCategoryName(n),
                  ),
                },
              },
            });
            const existingMap = new Map(
              existingCategories.map((c) => [
                this.songHelper.normalizeCategoryName(c.name),
                c.id,
              ]),
            );

            let newCategoryIndex = 0;
            for (const name of item.categoryNames) {
              const normalized = this.songHelper.normalizeCategoryName(name);
              if (existingMap.has(normalized)) {
                finalCategoryIds.push(existingMap.get(normalized));
              } else {
                // 새 카테고리 생성
                const newCategory = await tx.category.create({
                  data: {
                    name: name.trim(),
                    channelId,
                    color: this.songHelper.chooseColorByIndex(newCategoryIndex),
                  },
                });
                newCategoryIndex++;
                finalCategoryIds.push(newCategory.id);
                existingMap.set(normalized, newCategory.id);
              }
            }
          }

          // 기존 카테고리 관계 삭제 후 재생성
          await tx.songCategory.deleteMany({ where: { songId: item.id } });
          if (finalCategoryIds.length > 0) {
            const uniqueCategoryIds = [...new Set(finalCategoryIds)];
            await tx.songCategory.createMany({
              data: uniqueCategoryIds.map((categoryId) => ({
                songId: item.id,
                categoryId,
              })),
            });
          }
        }

        updated.push(item.id);
      }

      return updated;
    });

    await this.songCacheService.clearChannelSongCaches(channelId);

    return {
      success: true,
      updatedCount: updatedIds.length,
      updatedIds,
    };
  }

  private async validateSongDuplicate(
    title: string,
    artistId: number,
    channelId: number,
    prisma: any = this.prisma,
  ) {
    const existingSong = await prisma.song.findFirst({
      where: { title, artistId, channelId },
      include: { artist: { select: { name: true } } },
    });
    if (existingSong) {
      throw new ResourceAlreadyExistsException(
        `이미 동일한 노래가 존재합니다: "${title}" - ${existingSong.artist.name}`,
      );
    }
  }

  private async getSongByChannelId(channelId: number, songId: number) {
    const song = await this.prisma.song.findFirst({
      where: { id: songId, channelId },
      include: {
        artist: true,
        songCategories: { include: { category: true } },
        channel: {
          select: { id: true, name: true, webPath: true, themeColor: true },
        },
      },
    });
    if (!song) {
      throw new ResourceNotFoundException(
        '해당 채널에서 노래를 찾을 수 없습니다.',
      );
    }
    const totalFavorites = await this.prisma.userSongLike.count({
      where: { songId: song.id },
    });
    return {
      ...song,
      totalFavorites,
      categories: sortSongCategories(song.songCategories),
      channel: song.channel,
    };
  }

  private isValidRating(value: unknown): value is number {
    return (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 5
    );
  }

  private resolveBulkCreateProficiency(
    song: Pick<CreateSongDto, 'difficulty' | 'proficiency'>,
    useProficiencyAsPrimary: boolean,
  ): number | null {
    if (this.isValidRating(song.proficiency)) return song.proficiency;
    if (useProficiencyAsPrimary && this.isValidRating(song.difficulty)) {
      return song.difficulty;
    }
    return null;
  }

  private async assertProficiencyPresentWhenRequired(
    channelId: number,
    proficiency: unknown,
  ): Promise<void> {
    if (
      (await this.musicbookSettingsService.usesProficiencyAsPrimary(
        channelId,
      )) &&
      !this.isValidRating(proficiency)
    ) {
      throw new InvalidInputException('숙련도를 입력해주세요.');
    }
  }
}
