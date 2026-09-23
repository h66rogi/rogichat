import {
  Body,
  BadRequestException,
  ConflictException,
  Controller,
  DefaultValuePipe,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import { ChannelPermissionGuard } from '../channel/guards/channel-permission.guard';
import { ChannelPermission } from '../channel/guards/channel-permission.decorator';
import { GlobalSongMatcherService } from './global-song-matcher.service';
import { GlobalSongRebuildService } from './global-song-rebuild.service';
import { GlobalSongBackfillService } from './global-song-backfill.service';
import { GlobalSongQuickAddService } from './global-song-quick-add.service';
import {
  GlobalSongRecommendationService,
  type RecommendationsResponseDto,
} from './global-song-recommendation.service';
import { CFComputationService } from './cf/cf-computation.service';
import { GlobalSongPublicService } from './global-song-public.service';
import { GlobalSongPopularService } from './global-song-popular.service';
import { GlobalSongMergeService } from './global-song-merge.service';
import { GlobalArtistMergeService } from './global-artist-merge.service';
import {
  LyricsExtrasBackfillService,
  type LyricsExtrasCoverageResult,
  type LyricsExtrasBackfillResult,
} from './musixmatch/lyrics-extras-backfill.service';
import { MergeRequestDto, MergeResponseDto } from './dto/merge.dto';
import {
  ArtistMergeRequestDto,
  ArtistMergeResponseDto,
} from './dto/artist-merge.dto';
import { MatchRequestDto, MatchResponseDto } from './dto/match.dto';
import { QuickAddRequestDto, QuickAddResponseDto } from './dto/quick-add.dto';
import {
  GlobalSongDetailResponseDto,
  GlobalSongMyRegisteredIdsResponseDto,
  GlobalSongMyRegistrationsResponseDto,
} from './dto/global-song-detail.dto';
import { GlobalSongLyricsResponseDto } from './dto/global-song-lyrics.dto';
import {
  GlobalSongClipQueryDto,
  GlobalSongClipResponseDto,
} from './dto/global-song-clips.dto';
import {
  GlobalSongByArtistResponseDto,
  GlobalSongSearchQueryDto,
  GlobalSongSearchResponseDto,
} from './dto/global-song-search.dto';
import {
  GLOBAL_SONG_POPULAR_SECTION_KEYS,
  GlobalSongPopularResponseDto,
  GlobalSongPopularSectionQueryDto,
  GlobalSongPopularSectionResponseDto,
  type GlobalSongPopularSectionKey,
} from './dto/global-song-popular.dto';

/**
 * REST endpoints for the global-song system.
 *
 *   GET  /global-songs/search                                   (public)
 *   GET  /global-songs/:id                                      (public)
 *   GET  /global-songs/:id/clips                                (public)
 *   POST /global-songs/match                                    (JWT)
 *   POST /global-songs/quick-add/channel/:channelId             (JWT + channel perm)
 *   GET  /global-songs/recommendations/channel/:channelId       (JWT + channel perm)
 *   POST /global-songs/rebuild/bootstrap                        (InternalApiKey)
 *   POST /global-songs/rebuild/cf                               (InternalApiKey)
 *   POST /global-songs/backfill                                 (InternalApiKey)
 *   POST /global-songs/musixmatch/lyrics-extras/backfill        (InternalApiKey)
 *   POST /global-songs/musixmatch/lyrics-extras/recover         (InternalApiKey)
 *   POST /global-songs/musixmatch/lyrics-extras/recover/status  (InternalApiKey)
 *
 * IMPORTANT — route ordering:
 *   The static `search` path MUST be declared before `:id` so NestJS matches
 *   /global-songs/search as the search endpoint and not as a param route. See
 *   the 2026-04-12 global-song detail design spec Section 4 for details.
 */
@Controller('global-songs')
export class GlobalSongController {
  constructor(
    private readonly matcher: GlobalSongMatcherService,
    private readonly rebuild: GlobalSongRebuildService,
    private readonly backfill: GlobalSongBackfillService,
    private readonly quickAdd: GlobalSongQuickAddService,
    private readonly recommendations: GlobalSongRecommendationService,
    private readonly cfComputation: CFComputationService,
    private readonly publicService: GlobalSongPublicService,
    private readonly popularService: GlobalSongPopularService,
    private readonly mergeService: GlobalSongMergeService,
    private readonly artistMergeService: GlobalArtistMergeService,
    private readonly lyricsExtrasBackfill: LyricsExtrasBackfillService,
  ) {}

  /* =====================================================================
   *  Public read endpoints (no auth guard).
   *
   *  These power the fan-facing /song/[id] page and the search "곡" tab.
   * ===================================================================== */

  /**
   * Search global songs by title (or alias) with `channelCount > 0` filter.
   *
   * MUST be declared BEFORE `@Get(':id')` to avoid NestJS matching
   * `/global-songs/search` as `/global-songs/:id`.
   */
  @Get('search')
  @Header('Cache-Control', 'public, max-age=60')
  async searchPublic(
    @Query() query: GlobalSongSearchQueryDto,
  ): Promise<GlobalSongSearchResponseDto> {
    return this.publicService.search(query);
  }

  /**
   * Aggregated popular sections that power /musicbook/song:
   * ranking (channelCount Desc), newcomers (createdAt Desc), top artists.
   *
   * MUST stay above `@Get(':id')` so NestJS routes the static path here.
   */
  @Get('popular')
  @Header('Cache-Control', 'public, max-age=300')
  async getPopular(): Promise<GlobalSongPopularResponseDto> {
    return this.popularService.getPopular();
  }

  /**
   * Paged single-section variant for /musicbook/song/:section.
   * Capped at 500 visible ranks by query DTO (100 rows x 5 pages).
   *
   * MUST stay above `@Get(':id')` so NestJS routes the static path here.
   */
  @Get('popular/sections/:section')
  @Header('Cache-Control', 'public, max-age=300')
  async getPopularSection(
    @Param('section') section: string,
    @Query() query: GlobalSongPopularSectionQueryDto,
  ): Promise<GlobalSongPopularSectionResponseDto> {
    if (!isGlobalSongPopularSectionKey(section)) {
      throw new BadRequestException('Unsupported popular section');
    }
    return this.popularService.getPopularSection(section, query);
  }

  /**
   * Distinct GlobalSong ids the caller has registered across any of their
   * owned/manager channels. Powers SongCard's "이미 노래책에 있어요" hint —
   * one query for the whole popular page instead of one-per-card.
   *
   * MUST stay above `@Get(':id')` so NestJS routes the static path here.
   */
  @Get('me/registered-ids')
  @UseGuards(AuthGuard('jwt'))
  async getMyRegisteredGlobalSongIds(
    @Req() req: any,
  ): Promise<GlobalSongMyRegisteredIdsResponseDto> {
    return this.publicService.getMyRegisteredGlobalSongIds(
      Number(req.user?.id),
    );
  }

  /**
   * Timed lyrics for an editor-imported GlobalSong.
   * Authenticated surface only: this can include full lyrics text and LRC lines.
   */
  @Get(':id/lyrics')
  @UseGuards(AuthGuard('jwt'))
  @Header('Cache-Control', 'private, max-age=3600')
  async getLyrics(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GlobalSongLyricsResponseDto> {
    return this.publicService.getLyrics(id);
  }

  /**
   * Global song detail + channel list. Returns 404 if the song does not exist.
   * Channels are filtered to active (visibility=PUBLIC) and sorted:
   *   isLive DESC → followerCount DESC → id ASC.
   */
  @Get(':id')
  @Header('Cache-Control', 'public, max-age=300')
  async getDetail(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GlobalSongDetailResponseDto> {
    return this.publicService.getDetail(id);
  }

  /**
   * Clips for a global song. Sort: `popular` (default) or `recent`.
   * Uses Base64(JSON) cursors that include `sort` so mismatched cursors are
   * silently ignored (treated as first page) rather than returning bad data.
   */
  @Get(':id/clips')
  @Header('Cache-Control', 'public, max-age=300')
  async getClips(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: GlobalSongClipQueryDto,
  ): Promise<GlobalSongClipResponseDto> {
    return this.publicService.getClips(id, query);
  }

  /**
   * Other GlobalSongs of the same GlobalArtist with at least one channel
   * registered. Powers the "이 아티스트의 다른 노래" rail at the bottom of
   * /song/:id. Ordered (channelCount DESC, id DESC).
   */
  @Get(':id/by-artist')
  @Header('Cache-Control', 'public, max-age=300')
  async getByArtist(
    @Param('id', ParseIntPipe) id: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ): Promise<GlobalSongByArtistResponseDto> {
    return this.publicService.getByArtist(id, limit);
  }

  /* =====================================================================
   *  Internal / authenticated endpoints (unchanged).
   * ===================================================================== */

  /**
   * Channel ids (caller's owned + managed channels, any visibility) that
   * already have this GlobalSong. Drives the front-end "이미 노래책에
   * 있어요" indicator and removes already-registered channels from the
   * "내 노래책에 추가" picker.
   */
  @Get(':id/my-registrations')
  @UseGuards(AuthGuard('jwt'))
  async getMyRegistrations(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
  ): Promise<GlobalSongMyRegistrationsResponseDto> {
    return this.publicService.getMyRegistrations(id, Number(req.user?.id));
  }

  @Post('match')
  @UseGuards(AuthGuard('jwt'))
  async match(@Body() body: MatchRequestDto): Promise<MatchResponseDto> {
    return this.matcher.match(body);
  }

  /**
   * One-click add a global song to a channel's songbook.
   * Reuses the standard SongMutationService flow internally.
   * Returns 409 Conflict if the song is already in the channel.
   */
  @Post('quick-add/channel/:channelId')
  @UseGuards(AuthGuard('jwt'), ChannelPermissionGuard)
  @ChannelPermission('content')
  @HttpCode(HttpStatus.CREATED)
  async quickAddToChannel(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Body() body: QuickAddRequestDto,
    @Req() req: any,
  ): Promise<QuickAddResponseDto> {
    return this.quickAdd.quickAdd(channelId, body, req.user?.id);
  }

  /**
   * Pre-computed recommendations for a channel's songbook.
   */
  @Get('recommendations/channel/:channelId')
  @UseGuards(AuthGuard('jwt'), ChannelPermissionGuard)
  @ChannelPermission('content')
  async getRecommendations(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ): Promise<RecommendationsResponseDto> {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const safeOffset = Math.max(0, offset);
    return this.recommendations.getRecommendations(
      channelId,
      safeLimit,
      safeOffset,
    );
  }

  /**
   * One-shot bootstrap: flush index keys and scan every existing song.
   * Gated behind the internal API key - only operators should hit this.
   */
  @Post('rebuild/bootstrap')
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  async bootstrapRebuild(): Promise<{ indexed: number; errors: number }> {
    return this.rebuild.bootstrap();
  }

  /**
   * Trigger CF computation: channel similarity + item similarity +
   * per-channel recommendations. Takes several minutes for large datasets.
   */
  @Post('rebuild/cf')
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  async computeCF(): Promise<{
    channelSimilarities: number;
    itemSimilarities: number;
    channelRecommendations: number;
  }> {
    return this.cfComputation.compute();
  }

  /**
   * Backfill Song.globalSongId from Redis mappings.
   * Scans all gs:{id}:channels HASHes and writes the FK to Song rows
   * that don't have it yet. Idempotent — safe to rerun.
   *
   * Returns 409 Conflict when a backfill is already running.
   * Returns 503 Service Unavailable when Redis is not ready.
   */
  @Post('backfill')
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  async backfillGlobalSongIds(): Promise<{
    updated: number;
    skipped: number;
    errors: number;
  }> {
    const rejection = await this.backfill.tryAcquire();
    if (rejection === 'running') {
      throw new ConflictException('Backfill is already in progress');
    }
    if (rejection === 'redis_down') {
      throw new ServiceUnavailableException('Global-song Redis is not ready');
    }
    // Lock acquired by tryAcquire — hand off to backfill() which will
    // skip its own tryAcquire (lock already held by this pod) and release
    // the lock in its finally block.
    return this.backfill.backfill();
  }

  /**
   * Backfill auxiliary Musixmatch lyrics fields for already-stored lyrics.
   *
   * The regular Musixmatch matcher backfill only consumes PENDING songs. This
   * internal endpoint revisits existing lyrics rows in small batches to fill
   * newly-added display fields such as Korean translation and Japanese
   * Korean-pronunciation text without ad-hoc production DB scripts.
   */
  @Post('musixmatch/lyrics-extras/backfill')
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  async backfillLyricsExtras(
    @Body()
    body: {
      language?: string;
      limit?: number;
      dryRun?: boolean;
      includeTranslation?: boolean;
      includePronunciation?: boolean;
    } = {},
  ): Promise<LyricsExtrasBackfillResult> {
    return this.lyricsExtrasBackfill.run(body);
  }

  @Post('musixmatch/lyrics-extras/recover')
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  async recoverLyricsExtras(
    @Body()
    body: {
      language?: string;
      limit?: number;
      dryRun?: boolean;
      includeTranslation?: boolean;
      includePronunciation?: boolean;
    } = {},
  ): Promise<LyricsExtrasBackfillResult> {
    return this.lyricsExtrasBackfill.run(body);
  }

  @Post('musixmatch/lyrics-extras/recover/status')
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  async getLyricsExtrasRecoverStatus(
    @Body() body: { language?: string } = {},
  ): Promise<LyricsExtrasCoverageResult> {
    return this.lyricsExtrasBackfill.getCoverage(body.language);
  }

  /**
   * Merge duplicate GlobalSong rows into a single winner. Loser rows are
   * hard-deleted; every Song.globalSongId FK pointing at them is reassigned
   * to the winner. A `global_song_merges` row keeps the redirect forever so
   * stale clients get the canonical id back.
   *
   * Gated behind the internal API key — batch script calls this, not the
   * end-user admin UI yet.
   */
  @Post('merge')
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  async mergeGlobalSongs(
    @Body() dto: MergeRequestDto,
  ): Promise<MergeResponseDto> {
    return this.mergeService.merge({
      winnerId: dto.winnerId,
      loserIds: dto.loserIds,
      reason: dto.reason,
      dryRun: dto.dryRun ?? false,
    });
  }

  /**
   * Merge duplicate GlobalArtist rows. Loser artists' songs are re-pointed
   * to the winner; if re-pointing would collide on (norm_title, artist_id),
   * the conflicting song pair is merged inline first.
   */
  @Post('artist-merge')
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  async mergeGlobalArtists(
    @Body() dto: ArtistMergeRequestDto,
  ): Promise<ArtistMergeResponseDto> {
    return this.artistMergeService.merge({
      winnerId: dto.winnerId,
      loserIds: dto.loserIds,
      reason: dto.reason,
      dryRun: dto.dryRun ?? false,
    });
  }
}

function isGlobalSongPopularSectionKey(
  value: string,
): value is GlobalSongPopularSectionKey {
  return GLOBAL_SONG_POPULAR_SECTION_KEYS.includes(
    value as GlobalSongPopularSectionKey,
  );
}
