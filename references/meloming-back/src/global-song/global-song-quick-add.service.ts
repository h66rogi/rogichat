import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GlobalSongRedisService } from './global-song-redis.service';
import { GlobalSongMergeService } from './global-song-merge.service';
import { SongMutationService } from '../song/song-mutation.service';
import { GlobalSongRecommendationService } from './global-song-recommendation.service';
import { QuickAddRequestDto, QuickAddResponseDto } from './dto/quick-add.dto';
import { ChannelMusicbookSettingsService } from '../channel/channel-musicbook-settings.service';

/**
 * Quick-add: one-click song addition from the global-song registry.
 *
 * Spec Section 3 internal flow:
 *   1. Fetch metadata from global_songs (title, artist, album art)
 *   2. Find or create Artist in channel (reuse existing SongMutationService)
 *   3. Create song via SongMutationService.createSongByChannelId() while
 *      synchronously persisting Song.globalSongId because quick-add already
 *      has an authoritative GlobalSong selection.
 *   4. Redis indexes and channelCount are updated via the SONG_CREATED
 *      indexer path — no extra work here.
 *   5. Recommendations — Phase 3 delivers CF. For now, return empty array.
 */
@Injectable()
export class GlobalSongQuickAddService {
  private readonly logger = new Logger(GlobalSongQuickAddService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: GlobalSongRedisService,
    private readonly songMutation: SongMutationService,
    private readonly recommendationService: GlobalSongRecommendationService,
    private readonly mergeService: GlobalSongMergeService,
    private readonly musicbookSettingsService: ChannelMusicbookSettingsService,
  ) {}

  async quickAdd(
    channelId: number,
    dto: QuickAddRequestDto,
    userId?: number,
  ): Promise<QuickAddResponseDto> {
    // Redis must be available for duplicate detection — without it we
    // could silently create duplicate songs in the channel.
    if (!this.redis.isReady()) {
      throw new ServiceUnavailableException(
        'Global song index is not ready. Retry in a few seconds.',
      );
    }

    // Merged loser → winner. If a client holds a stale id (e.g. cached search
    // result), we silently reroute to the canonical row so quick-add does not
    // 404 against a valid-from-client's-view id.
    const resolved = await this.mergeService.resolveMerged(dto.globalSongId);
    const globalSongId = resolved.canonicalId;

    // 1. Duplicate detection via Redis
    const existingSongId = await this.redis.getChannelSongMapping(
      globalSongId,
      channelId,
    );
    if (existingSongId !== null) {
      const existingSong = await this.prisma.song.findFirst({
        where: { id: existingSongId, channelId },
        include: {
          artist: { select: { name: true } },
          songCategories: {
            include: { category: { select: { id: true, name: true } } },
          },
        },
      });
      throw new ConflictException({
        message: '이미 등록된 곡입니다.',
        existingSong,
      });
    }
    const existingMappedSong = await this.prisma.song.findFirst({
      where: { channelId, globalSongId },
      include: {
        artist: { select: { name: true } },
        songCategories: {
          include: { category: { select: { id: true, name: true } } },
        },
      },
    });
    if (existingMappedSong) {
      throw new ConflictException({
        message: '이미 등록된 곡입니다.',
        existingSong: existingMappedSong,
      });
    }

    // 2. Load global song metadata
    const globalSong = await this.prisma.globalSong.findUnique({
      where: { id: globalSongId },
      include: { globalArtist: true },
    });
    if (!globalSong) {
      throw new NotFoundException('해당 글로벌 곡을 찾을 수 없습니다.');
    }

    // 3. Build CreateSongDto and delegate to existing mutation service.
    //    SongMutationService handles artist find-or-create, category
    //    validation, album art processing, and event emission.
    //
    //    Identity fields (title / artistName) are taken from the canonical
    //    GlobalSong row — clients cannot override them. albumArt accepts a
    //    per-channel override; everything else passes through.
    //
    //    difficulty / songKey / bpm: prefer the flat field, fall back to the
    //    legacy `overrides` block so older callers keep working.
    const finalDifficulty = dto.difficulty ?? dto.overrides?.difficulty;
    const finalProficiency =
      dto.proficiency ??
      ((await this.musicbookSettingsService.usesProficiencyAsPrimary(channelId))
        ? (finalDifficulty ?? 1)
        : undefined);
    const createSongDto = {
      title: globalSong.title,
      artistName: globalSong.globalArtist.canonicalName,
      albumArt: dto.albumArt ?? globalSong.albumArt ?? undefined,
      autoSearchAlbumArt: dto.autoSearchAlbumArt,
      categoryIds: dto.categoryIds,
      categoryNames: dto.categoryNames,
      karaokeUrl: dto.karaokeUrl,
      coverUrl: dto.coverUrl,
      originalUrl: dto.originalUrl,
      lyricsLink: dto.lyricsLink,
      lyricsText: dto.lyricsText,
      description: dto.description,
      difficulty: finalDifficulty,
      proficiency: finalProficiency,
      songKey: dto.songKey ?? dto.overrides?.songKey,
      bpm: dto.bpm ?? dto.overrides?.bpm,
      price: dto.price,
      currencyPrices: dto.currencyPrices,
    };

    const created = await this.songMutation
      .createSongByChannelId(createSongDto as any, channelId, undefined, {
        globalSongId,
      })
      .catch((error) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException({
            message: '이미 등록된 곡입니다.',
          });
        }
        throw error;
      });

    // 4. Post-add recommendations from pre-computed CF cache
    let recommendations: QuickAddResponseDto['recommendations'] = [];
    try {
      const recs = await this.recommendationService.getPostAddRecommendations(
        channelId,
        5,
      );
      recommendations = recs.map((r) => ({
        globalSongId: r.globalSongId,
        title: r.title,
        artist: r.artist,
        albumArt: r.albumArt,
        score: r.score,
        reason: r.reason,
        channelCount: r.channelCount,
        topCategories: r.topCategories,
      }));
    } catch {
      // Recs are best-effort; don't fail the add
    }

    return {
      song: created,
      recommendations,
    };
  }
}
