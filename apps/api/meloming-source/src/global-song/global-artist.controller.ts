import {
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { GlobalArtistPublicService } from './global-artist-public.service';
import { GlobalArtistPopularService } from './global-artist-popular.service';
import type { GlobalArtistDetailResponseDto } from './dto/global-artist-detail.dto';
import { GlobalArtistPopularResponseDto } from './dto/global-artist-popular.dto';
import {
  GlobalArtistSongsQueryDto,
  GlobalArtistSongsResponseDto,
} from './dto/global-artist-songs.dto';
import {
  GlobalArtistChannelsQueryDto,
  GlobalArtistChannelsResponseDto,
} from './dto/global-artist-channels.dto';
import {
  GlobalSongClipQueryDto,
  GlobalSongClipResponseDto,
} from './dto/global-song-clips.dto';

/**
 * REST endpoints for the public /artist/[id] page.
 *
 *   GET /global-artists/:id              → hero / summary counts
 *   GET /global-artists/:id/songs        → cursor paginated catalog
 *   GET /global-artists/:id/channels     → cursor paginated streamers
 *   GET /global-artists/:id/clips        → cursor paginated clip feed
 *
 * All endpoints are unauthenticated and CDN-cacheable. Cache-Control budgets
 * mirror /global-songs/:id (300 s detail, 60-300 s list pages).
 */
@Controller('global-artists')
export class GlobalArtistController {
  constructor(
    private readonly publicService: GlobalArtistPublicService,
    private readonly popularService: GlobalArtistPopularService,
  ) {}

  /**
   * Aggregated popular sections that power /musicbook/artist:
   *   ranking      – SUM(channelCount) Desc across artist's GlobalSongs
   *   newcomers    – MIN(GlobalSong.createdAt) Desc per artist
   *   mostClipped  – DISTINCT visible clip count Desc per artist
   *
   * MUST stay above `@Get(':id')` so NestJS routes the static path here
   * instead of treating "popular" as an artist id.
   */
  @Get('popular')
  @Header('Cache-Control', 'public, max-age=300')
  async getPopular(): Promise<GlobalArtistPopularResponseDto> {
    return this.popularService.getPopular();
  }

  @Get(':id')
  @Header('Cache-Control', 'public, max-age=300')
  async getDetail(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GlobalArtistDetailResponseDto> {
    return this.publicService.getDetail(id);
  }

  @Get(':id/songs')
  @Header('Cache-Control', 'public, max-age=300')
  async getSongs(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: GlobalArtistSongsQueryDto,
  ): Promise<GlobalArtistSongsResponseDto> {
    return this.publicService.getSongs(id, query);
  }

  @Get(':id/channels')
  @Header('Cache-Control', 'public, max-age=60')
  async getChannels(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: GlobalArtistChannelsQueryDto,
  ): Promise<GlobalArtistChannelsResponseDto> {
    return this.publicService.getChannels(id, query);
  }

  @Get(':id/clips')
  @Header('Cache-Control', 'public, max-age=300')
  async getClips(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: GlobalSongClipQueryDto,
  ): Promise<GlobalSongClipResponseDto> {
    return this.publicService.getClips(id, query);
  }
}
