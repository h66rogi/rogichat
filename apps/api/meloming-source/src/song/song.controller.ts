import {
  Controller,
  Get,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Body,
  Patch,
  Delete,
  ParseIntPipe,
  BadRequestException,
  Version,
  Req,
  Request,
  DefaultValuePipe,
  Res,
  Header,
} from '@nestjs/common';
import { Response } from 'express';
import { SongService } from './song.service';
import { SongExportService } from './song-export.service';
import { SongSuggestService } from './song-suggest.service';
import { SongAutocompleteService } from './song-autocomplete.service';
import { ChannelService } from '../channel/channel.service';
import {
  CreateSongDto,
  UpdateSongDto,
  SongQueryDto,
  BulkAlbumArtSearchDto,
  BulkCreateSongDto,
  BulkDeleteSongsDto,
  BulkCreateSongsResponseDto,
  BulkUpdateSongsDto,
  BulkUpdateSongsResponseDto,
} from './dto/song.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
  ApiExtraModels,
  ApiBody,
} from '@nestjs/swagger';
import type { SongsListResponse, SongDetailResponse } from './dto/song.dto';
import { SongSuggestQueryDto } from './dto/requests/song-suggest.request.dto';
import { SongAutocompleteQueryDto } from './dto/requests/song-autocomplete.request.dto';
import { SongArtistSuggestQueryDto } from './dto/requests/song-artist-suggest.request.dto';
import { SongSuggestResponseDto } from './dto/responses/song-suggest.response.dto';
import { SongAutocompleteResponseDto } from './dto/responses/song-autocomplete.response.dto';
import { SongArtistSuggestResponseDto } from './dto/responses/song-artist-suggest.response.dto';
import { ChannelPermission } from '../channel/guards/channel-permission.decorator';
import { ChannelPermissionGuard } from '../channel/guards/channel-permission.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Songs')
@Controller('songs')
export class SongController {
  constructor(
    private readonly songService: SongService,
    private readonly songExportService: SongExportService,
    private readonly songSuggestService: SongSuggestService,
    private readonly songAutocompleteService: SongAutocompleteService,
    private readonly channelService: ChannelService,
  ) {}

  /**
   * Compute viewer context for query service calls.
   * Phase 5 plumbing: lets song-query.service decide whether to expose
   * lyricsText (Phase 5.3) and to choose the right cache bucket (Phase 5.2).
   * The actual access check stays on ChannelPermissionGuard; this is a
   * non-throwing read used to *enrich* the response shape.
   */
  private async buildViewer(
    userId: number | undefined,
    channelId: number | undefined,
  ): Promise<{ userId?: number; isManager: boolean }> {
    if (!userId || !channelId) {
      return { userId, isManager: false };
    }
    const isManager = await this.channelService
      .hasChannelContentPermission(userId, channelId)
      .catch(() => false);
    return { userId, isManager };
  }

  // ========== RESTful 공개 API들 ==========

  @Get('search')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: '공개 노래 검색',
    description: '노래 제목, 아티스트명, 채널명으로 통합 검색합니다.',
  })
  @ApiResponse({ status: 200, description: '노래 검색 결과 반환' })
  async searchSongs(
    @Query() query: SongQueryDto,
    @Req() req,
  ): Promise<SongsListResponse> {
    const userId = req?.user?.id as number | undefined;
    // Global search across all channels — manager status is undefined here.
    return this.songService.searchSongs(query, { userId, isManager: false });
  }

  @Get('channel/:identifier/suggest')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '클립 제목으로 노래 추천 (Fuzzy Search)',
    description:
      '클립 제목이나 텍스트를 입력하면 해당 채널의 노래 중 fuzzy matching으로 추천 노래를 반환합니다.',
  })
  @ApiParam({
    name: 'identifier',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
    examples: {
      channelId: { value: '123', description: '채널 ID로 조회' },
      webPath: { value: 'my_channel', description: 'webPath로 조회' },
    },
  })
  @ApiQuery({
    name: 'text',
    required: true,
    type: String,
    description: '클립 제목 또는 검색 텍스트',
    example: '[클립]모카 - 폰서트 (10cm)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: '반환할 추천 개수 (기본 5, 최대 20)',
    example: 5,
  })
  @ApiResponse({
    status: 200,
    description: '추천 노래 목록',
    type: SongSuggestResponseDto,
  })
  @ApiResponse({ status: 404, description: '채널을 찾을 수 없음' })
  async suggestSongs(
    @Param('identifier') identifier: string,
    @Query() query: SongSuggestQueryDto,
  ): Promise<SongSuggestResponseDto> {
    const isNumericId = /^\d+$/.test(identifier);
    const channelId = isNumericId
      ? parseInt(identifier, 10)
      : (await this.channelService.findByWebPath(identifier))?.id;

    if (!channelId) {
      throw new BadRequestException('채널을 찾을 수 없습니다.');
    }

    const limit = query.limit ?? 5;
    return this.songSuggestService.suggestSongs(channelId, query.text, limit);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Get('channel/:identifier/autocomplete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '노래 제목 자동완성',
    description:
      '채널의 인기곡/검색 결과를 바탕으로 노래 제목 자동완성 목록을 반환합니다.',
  })
  @ApiParam({
    name: 'identifier',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
    examples: {
      channelId: { value: '123', description: '채널 ID로 조회' },
      webPath: { value: 'my_channel', description: 'webPath로 조회' },
    },
  })
  @ApiQuery({
    name: 'query',
    required: false,
    type: String,
    description: '노래 제목 검색어 (비어있으면 인기곡 기준)',
    example: '폰서트',
  })
  @ApiQuery({
    name: 'scope',
    required: false,
    enum: ['channel', 'global'],
    description: '검색 범위 (channel 또는 global)',
    example: 'global',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: '반환할 추천 개수 (기본 8, 최대 20)',
    example: 8,
  })
  @ApiResponse({
    status: 200,
    description: '자동완성 노래 목록',
    type: SongAutocompleteResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '채널 접근 권한 없음' })
  async autocompleteSongTitles(
    @Param('identifier') identifier: string,
    @Query() query: SongAutocompleteQueryDto,
  ): Promise<SongAutocompleteResponseDto> {
    const isNumericId = /^\d+$/.test(identifier);
    const channelId = isNumericId
      ? parseInt(identifier, 10)
      : (await this.channelService.findByWebPath(identifier))?.id;

    if (!channelId) {
      throw new BadRequestException('채널을 찾을 수 없습니다.');
    }

    const limit = query.limit ?? 8;
    const scope = query.scope ?? 'channel';
    const targetChannelId = scope === 'global' ? undefined : channelId;
    return this.songAutocompleteService.autocompleteTitles(
      targetChannelId,
      query.query,
      limit,
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Get('channel/:identifier/artist-suggest')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '노래 제목 기반 아티스트 추천',
    description: '입력한 노래 제목을 기준으로 아티스트 선택 후보를 추천합니다.',
  })
  @ApiParam({
    name: 'identifier',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
    examples: {
      channelId: { value: '123', description: '채널 ID로 조회' },
      webPath: { value: 'my_channel', description: 'webPath로 조회' },
    },
  })
  @ApiQuery({
    name: 'title',
    required: true,
    type: String,
    description: '입력한 노래 제목',
    example: '폰서트',
  })
  @ApiQuery({
    name: 'scope',
    required: false,
    enum: ['channel', 'global'],
    description: '검색 범위 (channel 또는 global)',
    example: 'global',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: '반환할 추천 개수 (기본 5, 최대 20)',
    example: 5,
  })
  @ApiResponse({
    status: 200,
    description: '아티스트 추천 목록',
    type: SongArtistSuggestResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '채널 접근 권한 없음' })
  async suggestArtistsForTitle(
    @Param('identifier') identifier: string,
    @Query() query: SongArtistSuggestQueryDto,
  ): Promise<SongArtistSuggestResponseDto> {
    const isNumericId = /^\d+$/.test(identifier);
    const channelId = isNumericId
      ? parseInt(identifier, 10)
      : (await this.channelService.findByWebPath(identifier))?.id;

    if (!channelId) {
      throw new BadRequestException('채널을 찾을 수 없습니다.');
    }

    const limit = query.limit ?? 5;
    const scope = query.scope ?? 'channel';
    const targetChannelId = scope === 'global' ? undefined : channelId;
    return this.songAutocompleteService.suggestArtists(
      targetChannelId,
      query.title,
      limit,
    );
  }

  @Get('channel/:identifier')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: '채널의 노래 목록 조회',
    description: '숫자면 채널 ID로, 문자면 webPath로 자동 인식하여 조회',
  })
  @ApiParam({
    name: 'identifier',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
    examples: {
      channelId: { value: '123', description: '채널 ID로 조회' },
      webPath: { value: 'my_channel', description: 'webPath로 조회' },
    },
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: '페이지 번호',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: '페이지당 항목 수',
    example: 20,
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: '검색어 (제목/아티스트)',
    example: 'Dynamite',
  })
  @ApiQuery({
    name: 'categoryId',
    required: false,
    type: Number,
    description: '카테고리 ID',
    example: 1,
  })
  @ApiQuery({
    name: 'artistId',
    required: false,
    type: Number,
    description: '아티스트 ID',
    example: 1,
  })
  @ApiQuery({
    name: 'proficiency',
    required: false,
    type: Number,
    description: '숙련도 (1-5)',
    example: 3,
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    type: String,
    description: '정렬 기준',
    enum: [
      'newest',
      'oldest',
      'title',
      'artist',
      'favorites_desc',
      'favorites_asc',
      'likes_desc',
      'likes_asc',
    ],
    example: 'newest',
  })
  @ApiQuery({
    name: 'version',
    required: false,
    type: String,
    description: 'API 버전 표기(설명용). v1 기본 동작',
    enum: ['v1'],
    example: 'v1',
  })
  @ApiResponse({ status: 200, description: '노래 목록 반환' })
  @ApiResponse({ status: 404, description: '채널을 찾을 수 없음' })
  async getSongs(
    @Param('identifier') identifier: string,
    @Query() query: SongQueryDto,
    @Req() req,
  ): Promise<SongsListResponse> {
    const userId = req?.user?.id as number | undefined;
    // 완전히 숫자면 channelId로, 그 외는 webPath로 판단
    const isNumericId = /^\d+$/.test(identifier);
    // viewer 계산을 위한 channelId 사전 해석 (404 처리는 service 위임)
    const resolvedChannelId = userId
      ? await this.channelService.resolveChannelIdByIdentifier(identifier)
      : null;
    const viewer = await this.buildViewer(
      userId,
      resolvedChannelId ?? undefined,
    );

    // version 파라미터에 따라 V1 또는 V2 로직 사용
    if (query.version === 'v2') {
      if (isNumericId) {
        const channelId = parseInt(identifier, 10);
        return await this.songService.getSongsByChannelIdV2(
          channelId,
          query,
          viewer,
        );
      } else {
        return await this.songService.getSongsByWebPathV2(
          identifier,
          query,
          viewer,
        );
      }
    } else {
      // 기본값: V1 로직
      if (isNumericId) {
        const channelId = parseInt(identifier, 10);
        return this.songService.getSongsByChannelId(channelId, query, viewer);
      } else {
        return this.songService.getSongsByWebPath(identifier, query, viewer);
      }
    }
  }

  @Get('channel/:identifier/export/csv')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({
    summary: '채널의 노래 목록 CSV 다운로드',
    description:
      '채널의 모든 노래 정보를 CSV 파일로 다운로드합니다. 노래가 1곡 이상 있어야 다운로드 가능합니다.',
  })
  @ApiParam({
    name: 'identifier',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
    examples: {
      channelId: { value: '123', description: '채널 ID로 조회' },
      webPath: { value: 'my_channel', description: 'webPath로 조회' },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'CSV 파일 다운로드',
    content: {
      'text/csv': {
        schema: {
          type: 'string',
          example:
            'Song Title,Artist Name,Categories,Difficulty\n"Dynamite","BTS","K-POP, 댄스",3',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: '다운로드할 노래가 없음' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 404, description: '채널을 찾을 수 없음' })
  async exportSongsCsv(
    @Param('identifier') identifier: string,
    @Req() req,
    @Res() res: Response,
  ): Promise<void> {
    const userId = Number(req.user.id);
    const ipAddress =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await this.songExportService.exportSongsAsCsv(
      identifier,
      userId,
      ipAddress,
      userAgent,
    );

    // 파일명에 채널명과 날짜 포함 (한글 등 특수문자는 encodeURIComponent로 처리)
    const date = new Date().toISOString().split('T')[0];
    const filename = `songs_${result.channelName}_${date}.csv`;
    const encodedFilename = encodeURIComponent(filename);

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`,
    );
    res.setHeader('X-Song-Count', result.songCount.toString());

    // BOM 추가 (Excel에서 UTF-8 인식을 위해)
    const bom = '\uFEFF';
    res.send(bom + result.csv);
  }

  @Get('channel/:identifier/random')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: '채널의 노래 중 랜덤 N개 조회',
    description:
      '해당 채널의 모든 노래 중에서 무작위로 N개를 반환합니다. 반환 형식은 /songs/channel/:identifier 와 동일하며, page/limit 대신 count를 사용합니다.',
  })
  @ApiParam({
    name: 'identifier',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
  })
  @ApiQuery({
    name: 'count',
    required: false,
    type: Number,
    description: '랜덤으로 반환할 개수 (기본 5)',
    example: 5,
  })
  @ApiQuery({
    name: 'categoryIds',
    required: false,
    type: String,
    description: '카테고리 ID 목록 (쉼표로 구분)',
    example: '1,2,3',
  })
  async getRandomSongs(
    @Param('identifier') identifier: string,
    @Query('count') countQuery: number | undefined,
    @Query('categoryIds') categoryIdsQuery: string | string[] | undefined,
    @Req() req,
  ): Promise<SongsListResponse> {
    const count = Number.isFinite(Number(countQuery))
      ? Math.max(1, Math.min(100, Number(countQuery)))
      : 5;
    const categoryIds =
      categoryIdsQuery === undefined
        ? []
        : (Array.isArray(categoryIdsQuery)
            ? categoryIdsQuery.join(',')
            : String(categoryIdsQuery)
          )
            .split(',')
            .map((v) => parseInt(v.trim(), 10))
            .filter((v) => Number.isFinite(v) && v > 0);
    const userId = req?.user?.id as number | undefined;
    const isNumericId = /^\d+$/.test(identifier);
    const resolvedChannelId = userId
      ? await this.channelService.resolveChannelIdByIdentifier(identifier)
      : null;
    const viewer = await this.buildViewer(
      userId,
      resolvedChannelId ?? undefined,
    );
    if (isNumericId) {
      const channelId = parseInt(identifier, 10);
      return this.songService.getRandomSongsByChannelId(
        channelId,
        count,
        categoryIds,
        viewer,
      );
    } else {
      return this.songService.getRandomSongsByWebPath(
        identifier,
        count,
        categoryIds,
        viewer,
      );
    }
  }

  @Get('favorites/by-channel/:channelId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '채널별 내가 즐겨찾기한 노래 조회',
    description:
      '특정 채널에서 현재 로그인한 사용자가 즐겨찾기한 노래만 필터링하여 반환합니다.',
  })
  @ApiParam({
    name: 'channelId',
    description: '채널 ID',
    type: 'number',
    example: 1,
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: '페이지 번호',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: '페이지당 항목 수',
    example: 20,
  })
  @ApiResponse({
    status: 200,
    description: '채널별 즐겨찾기 노래 조회 성공',
    type: Object,
  })
  @ApiResponse({
    status: 401,
    description: '인증 실패',
  })
  @ApiResponse({
    status: 404,
    description: '채널을 찾을 수 없음',
  })
  async getMyFavoriteSongsByChannel(
    @Request() req,
    @Param('channelId', ParseIntPipe) channelId: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<SongsListResponse> {
    const userId = Number(req.user.id);
    const viewer = await this.buildViewer(userId, channelId);
    return this.songService.getMyFavoriteSongsByChannel(
      userId,
      channelId,
      { page, limit },
      viewer,
    );
  }

  // ========== V2 전용: 다중 필터/고도화 검색 전용 엔드포인트 ==========
  @Version('2')
  @Get('channel/:identifier')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: '[v2] 채널의 노래 목록 조회',
    description:
      'v2 전용 엔드포인트입니다. 숫자면 채널 ID로, 문자면 webPath로 인식하여 조회하며, 다중 필터(categoryIds, artistIds, difficulties) 등을 지원합니다.',
  })
  @ApiQuery({
    name: 'categoryIds',
    required: false,
    type: String,
    description: '카테고리 ID 목록 (쉼표로 구분)',
    example: '1,2,3',
  })
  @ApiQuery({
    name: 'artistIds',
    required: false,
    type: String,
    description: '아티스트 ID 목록 (쉼표로 구분)',
    example: '1,2',
  })
  @ApiQuery({
    name: 'difficulties',
    required: false,
    type: String,
    description: '난이도 목록 (쉼표로 구분, 1-5)',
    example: '3,4,5',
  })
  @ApiQuery({
    name: 'proficiencies',
    required: false,
    type: String,
    description: '숙련도 목록 (쉼표로 구분, 1-5)',
    example: '2,3,4',
  })
  @ApiResponse({ status: 200, description: '노래 목록 반환 (v2)' })
  @ApiResponse({ status: 404, description: '채널을 찾을 수 없음' })
  async getSongsV2(
    @Param('identifier') identifier: string,
    @Query() query: SongQueryDto,
    @Req() req,
  ): Promise<SongsListResponse> {
    const userId = req?.user?.id as number | undefined;
    const isNumericId = /^\d+$/.test(identifier);
    const resolvedChannelId = userId
      ? await this.channelService.resolveChannelIdByIdentifier(identifier)
      : null;
    const viewer = await this.buildViewer(
      userId,
      resolvedChannelId ?? undefined,
    );
    if (isNumericId) {
      const channelId = parseInt(identifier, 10);
      return await this.songService.getSongsByChannelIdV2(
        channelId,
        query,
        viewer,
      );
    } else {
      return await this.songService.getSongsByWebPathV2(
        identifier,
        query,
        viewer,
      );
    }
  }

  @Get('channel/:identifier/:songId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: '채널의 특정 노래 조회',
    description:
      '숫자면 채널 ID로, 문자면 webPath로 자동 인식하여 특정 노래 조회. 채널 소유자/매니저는 lyricsText(메모) 포함.',
  })
  @ApiParam({
    name: 'identifier',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
    examples: {
      channelId: { value: '123', description: '채널 ID로 조회' },
      webPath: { value: 'my_channel', description: 'webPath로 조회' },
    },
  })
  @ApiParam({
    name: 'songId',
    description: '노래 ID',
    example: 1,
  })
  @ApiResponse({ status: 200, description: '노래 정보 반환' })
  @ApiResponse({ status: 404, description: '노래를 찾을 수 없음' })
  async getSongByChannel(
    @Param('identifier') identifier: string,
    @Param('songId', ParseIntPipe) songId: number,
    @Req() req,
  ): Promise<SongDetailResponse> {
    const userId = req?.user?.id as number | undefined;
    // 완전히 숫자면 channelId로, 그 외는 webPath로 판단
    const isNumericId = /^\d+$/.test(identifier);
    // Round 3 C5: resolve identifier → channelId ahead of the service call
    // so we can compute manager status for the permission-aware mapper.
    // 404 처리는 service에 위임 (존재하지 않으면 여기서 null이 되고
    // service가 ResourceNotFoundException을 던짐).
    const resolvedChannelId = userId
      ? await this.channelService.resolveChannelIdByIdentifier(identifier)
      : null;
    const viewer = await this.buildViewer(
      userId,
      resolvedChannelId ?? undefined,
    );
    if (isNumericId) {
      const channelId = parseInt(identifier, 10);
      // 숫자인 경우: channelId로 조회
      return this.songService.getSongByChannelId(channelId, songId, viewer);
    } else {
      // 문자인 경우: webPath로 조회
      return this.songService.getPublicSongById(identifier, songId, viewer);
    }
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('album-art/search')
  @ApiOperation({ summary: 'DB 기반 앨범 아트 검색' })
  @ApiQuery({
    name: 'title',
    required: true,
    type: String,
    description: '노래 제목',
    example: '네모의 꿈',
  })
  @ApiQuery({
    name: 'artist',
    required: true,
    type: String,
    description: '아티스트명',
    example: '아이유',
  })
  @ApiResponse({
    status: 200,
    description: '앨범 아트 검색 결과',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: {
          type: 'object',
          nullable: true,
          properties: {
            albumArt: { type: 'string' },
            title: { type: 'string' },
            artistName: { type: 'string' },
            matchType: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: '인증 실패' })
  async searchAlbumArt(
    @Query('title') title: string,
    @Query('artist') artist: string,
  ) {
    return this.songService.searchAlbumArtFromDB(title, artist);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('album-art/bulk-search')
  @ApiOperation({ summary: 'DB 기반 벌크 앨범 아트 검색 (최대 500곡)' })
  @ApiResponse({
    status: 200,
    description: '벌크 앨범 아트 검색 결과',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        totalRequested: { type: 'number' },
        successCount: { type: 'number' },
        failCount: { type: 'number' },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              requestIndex: { type: 'number' },
              requestTitle: { type: 'string' },
              requestArtist: { type: 'string' },
              result: {
                type: 'object',
                nullable: true,
                properties: {
                  albumArt: { type: 'string' },
                  title: { type: 'string' },
                  artistName: { type: 'string' },
                  matchType: {
                    type: 'string',
                    enum: ['exact', 'normalized', 'title_only', 'artist_only'],
                  },
                },
              },
              error: { type: 'string', nullable: true },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 (500곡 초과 등)' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  async bulkSearchAlbumArt(@Body() bulkSearchDto: BulkAlbumArtSearchDto) {
    return this.songService.bulkSearchAlbumArtFromDB(bulkSearchDto.songs);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Post('/channel/:identifier')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '채널에 노래 추가' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID 또는 webPath',
    examples: {
      channelId: { value: '123', description: '채널 ID로 접근' },
      webPath: { value: 'my_channel', description: 'webPath로 접근' },
    },
  })
  @ApiResponse({ status: 201, description: '노래 생성 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '채널 접근 권한 없음' })
  @ApiResponse({ status: 404, description: '채널을 찾을 수 없음' })
  @ApiResponse({ status: 409, description: '중복된 노래 (제목 + 아티스트)' })
  async createSongInChannel(
    @Param('identifier') identifier: string,
    @Body() createSongDto: CreateSongDto,
    @Req() req,
  ) {
    const isNumericId = /^\d+$/.test(identifier);
    const channelId = isNumericId
      ? parseInt(identifier, 10)
      : (await this.channelService.findByWebPath(identifier))?.id;
    if (!channelId) {
      throw new BadRequestException('채널을 찾을 수 없습니다.');
    }
    return this.songService.createSongByChannelId(
      createSongDto,
      channelId,
      req?.user?.id as number,
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Post('/channel/:identifier/bulk')
  @HttpCode(HttpStatus.CREATED)
  @ApiExtraModels(CreateSongDto, BulkCreateSongDto)
  @ApiOperation({
    summary: '채널에 여러 노래 일괄 추가',
    description:
      '한 번에 여러 개의 노래를 추가합니다. 최대 500개까지 가능하며, 트랜잭션으로 처리되어 일부 실패 시 전체 롤백됩니다.',
  })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID 또는 webPath',
    examples: {
      channelId: { value: '123', description: '채널 ID로 접근' },
      webPath: { value: 'my_channel', description: 'webPath로 접근' },
    },
  })
  @ApiBody({
    type: BulkCreateSongDto,
    description:
      '각 곡 항목은 CreateSongDto 구조를 따르며, title과 (artistId 또는 artistName 중 하나)가 필요합니다. 나머지 필드는 선택입니다.',
    examples: {
      minimal: {
        summary: '최소 필드 예시',
        value: {
          songs: [
            { title: 'Dynamite', artistName: 'BTS' },
            { title: 'Butter', artistId: 1 },
          ],
        },
      },
      full: {
        summary: '전체 필드 예시',
        value: {
          songs: [
            {
              title: 'Dynamite',
              artistName: 'BTS',
              categoryNames: ['K-POP', '댄스'],
              difficulty: 3,
              songKey: 'C#',
              bpm: 114,
              lyricsLink: 'https://lyrics.example.com/dynamite',
              lyricsText: '오늘 밤 너와 함께...',
              autoSearchAlbumArt: true,
            },
            {
              title: 'Butter',
              artistId: 1,
              categoryIds: [1, 2],
              albumArt: 'https://example.com/butter.jpg',
              karaokeUrl: 'https://youtube.com/karaoke',
              coverUrl: 'https://youtube.com/cover',
              originalUrl: 'https://youtube.com/original',
            },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: '노래 일괄 생성 성공 (중복 곡은 skippedSongs 로 반환)',
    type: BulkCreateSongsResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '채널 접근 권한 없음' })
  @ApiResponse({ status: 404, description: '채널을 찾을 수 없음' })
  async bulkCreateSongsInChannel(
    @Param('identifier') identifier: string,
    @Body() bulkCreateSongDto: BulkCreateSongDto,
    @Req() req,
  ): Promise<BulkCreateSongsResponseDto> {
    const isNumericId = /^\d+$/.test(identifier);
    const channelId = isNumericId
      ? parseInt(identifier, 10)
      : (await this.channelService.findByWebPath(identifier))?.id;
    if (!channelId) {
      throw new BadRequestException('채널을 찾을 수 없습니다.');
    }
    return this.songService.bulkCreateSongsByChannelId(
      bulkCreateSongDto,
      channelId,
      req?.user?.id as number,
    );
  }

  // ========== V2 전용: 성능개선 벌크 등록 ==========
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Version('2')
  @Post('/channel/:identifier/bulk')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '[v2] 채널에 여러 노래 일괄 추가 (성능개선)',
    description:
      '요청/응답 스펙은 v1과 동일합니다. 내부적으로 인덱스 친화 쿼리와 청크 기반 벌크 처리를 적용합니다.',
  })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID 또는 webPath',
    examples: {
      channelId: { value: '123', description: '채널 ID로 접근' },
      webPath: { value: 'my_channel', description: 'webPath로 접근' },
    },
  })
  @ApiResponse({
    status: 201,
    description: '노래 일괄 생성 성공 (v2, 중복 곡은 skippedSongs 로 반환)',
    type: BulkCreateSongsResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '채널 접근 권한 없음' })
  @ApiResponse({ status: 404, description: '채널을 찾을 수 없음' })
  async bulkCreateSongsInChannelV2(
    @Param('identifier') identifier: string,
    @Body() bulkCreateSongDto: BulkCreateSongDto,
    @Req() req,
  ): Promise<BulkCreateSongsResponseDto> {
    const isNumericId = /^\d+$/.test(identifier);
    const channelId = isNumericId
      ? parseInt(identifier, 10)
      : (await this.channelService.findByWebPath(identifier))?.id;
    if (!channelId) {
      throw new BadRequestException('채널을 찾을 수 없습니다.');
    }
    return this.songService.bulkCreateSongsByChannelIdV2(
      bulkCreateSongDto,
      channelId,
      req?.user?.id as number,
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Patch('/channel/:identifier/bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '채널의 노래 일괄 수정 (최대 300개)',
    description:
      '여러 노래의 가수, 카테고리, 난이도를 일괄 수정합니다. 각 노래별로 수정할 필드만 지정할 수 있습니다.',
  })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID 또는 webPath',
    examples: {
      channelId: { value: '123', description: '채널 ID로 접근' },
      webPath: { value: 'my_channel', description: 'webPath로 접근' },
    },
  })
  @ApiBody({
    type: BulkUpdateSongsDto,
    description: '수정할 노래 목록',
    examples: {
      sample: {
        value: {
          songs: [
            { id: 1, artistId: 2, difficulty: 3 },
            { id: 2, categoryIds: [1, 2] },
            { id: 3, artistName: 'NewArtist', categoryNames: ['팝'] },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '노래 일괄 수정 성공',
    type: BulkUpdateSongsResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '채널 접근 권한 없음' })
  @ApiResponse({ status: 404, description: '채널을 찾을 수 없음' })
  async bulkUpdateSongsInChannel(
    @Param('identifier') identifier: string,
    @Body() dto: BulkUpdateSongsDto,
  ): Promise<BulkUpdateSongsResponseDto> {
    const isNumericId = /^\d+$/.test(identifier);
    const channelId = isNumericId
      ? parseInt(identifier, 10)
      : (await this.channelService.findByWebPath(identifier))?.id;
    if (!channelId) {
      throw new BadRequestException('채널을 찾을 수 없습니다.');
    }
    return this.songService.bulkUpdateSongsByChannelId(dto.songs, channelId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Patch('/channel/:identifier/:songId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '채널의 노래 수정' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID 또는 webPath',
    examples: {
      channelId: { value: '123', description: '채널 ID로 접근' },
      webPath: { value: 'my_channel', description: 'webPath로 접근' },
    },
  })
  @ApiParam({
    name: 'songId',
    type: Number,
    description: '노래 ID',
    example: 1,
  })
  @ApiResponse({ status: 200, description: '노래 수정 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '채널 접근 권한 없음' })
  @ApiResponse({ status: 404, description: '노래 또는 채널을 찾을 수 없음' })
  async updateSongInChannel(
    @Param('identifier') identifier: string,
    @Param('songId', ParseIntPipe) songId: number,
    @Body() updateSongDto: UpdateSongDto,
  ) {
    const isNumericId = /^\d+$/.test(identifier);
    const channelId = isNumericId
      ? parseInt(identifier, 10)
      : (await this.channelService.findByWebPath(identifier))?.id;
    if (!channelId) {
      throw new BadRequestException('채널을 찾을 수 없습니다.');
    }
    return this.songService.updateSongByChannelId(
      songId,
      updateSongDto,
      channelId,
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Get('/channel/:identifier/:songId/affected-clips')
  @ApiOperation({ summary: '노래 삭제 시 함께 삭제될 클립 수 미리보기' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID 또는 webPath',
  })
  @ApiParam({ name: 'songId', type: Number, description: '노래 ID' })
  @ApiResponse({
    status: 200,
    description: '고아 클립 수 반환',
    schema: {
      type: 'object',
      properties: { orphanClipCount: { type: 'number' } },
    },
  })
  async getAffectedClips(@Param('songId', ParseIntPipe) songId: number) {
    return this.songService.getOrphanClipCount([songId]);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Post('/channel/:identifier/affected-clips')
  @ApiOperation({ summary: '노래 벌크 삭제 시 함께 삭제될 클립 수 미리보기' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID 또는 webPath',
  })
  @ApiBody({
    type: BulkDeleteSongsDto,
    description: '삭제 대상 노래 ID 목록',
  })
  @ApiResponse({
    status: 200,
    description: '고아 클립 수 반환',
    schema: {
      type: 'object',
      properties: { orphanClipCount: { type: 'number' } },
    },
  })
  async getAffectedClipsBulk(@Body() dto: BulkDeleteSongsDto) {
    return this.songService.getOrphanClipCount(dto.ids);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Delete('/channel/:identifier/bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '채널의 노래 벌크 삭제 (최대 300개)' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID 또는 webPath',
    examples: {
      channelId: { value: '123', description: '채널 ID로 접근' },
      webPath: { value: 'my_channel', description: 'webPath로 접근' },
    },
  })
  @ApiBody({
    type: BulkDeleteSongsDto,
    description: '삭제할 노래 ID 목록',
    examples: { sample: { value: { ids: [1, 2, 3] } } },
  })
  @ApiResponse({ status: 200, description: '노래 벌크 삭제 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '채널 접근 권한 없음' })
  @ApiResponse({ status: 404, description: '채널을 찾을 수 없음' })
  async bulkDeleteSongsInChannel(
    @Param('identifier') identifier: string,
    @Body() dto: BulkDeleteSongsDto,
  ) {
    const isNumericId = /^\d+$/.test(identifier);
    const channelId = isNumericId
      ? parseInt(identifier, 10)
      : (await this.channelService.findByWebPath(identifier))?.id;
    if (!channelId) {
      throw new BadRequestException('채널을 찾을 수 없습니다.');
    }
    return this.songService.bulkDeleteSongsByChannelId(dto.ids, channelId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Delete('/channel/:identifier/:songId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '채널의 노래 삭제' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID 또는 webPath',
    examples: {
      channelId: { value: '123', description: '채널 ID로 접근' },
      webPath: { value: 'my_channel', description: 'webPath로 접근' },
    },
  })
  @ApiParam({
    name: 'songId',
    type: Number,
    description: '노래 ID',
    example: 1,
  })
  @ApiResponse({ status: 200, description: '노래 삭제 성공' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '채널 접근 권한 없음' })
  @ApiResponse({ status: 404, description: '노래 또는 채널을 찾을 수 없음' })
  async deleteSongFromChannel(
    @Param('identifier') identifier: string,
    @Param('songId', ParseIntPipe) songId: number,
  ) {
    const isNumericId = /^\d+$/.test(identifier);
    const channelId = isNumericId
      ? parseInt(identifier, 10)
      : (await this.channelService.findByWebPath(identifier))?.id;
    if (!channelId) {
      throw new BadRequestException('채널을 찾을 수 없습니다.');
    }
    return this.songService.deleteSongByChannelId(songId, channelId);
  }
}
